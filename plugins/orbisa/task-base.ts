import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { skillArchiveFingerprint } from "./task-skills.ts";
import { prunePreparedBases, type BaseReceipts, type CachedBase } from "./task-base-retention.ts";
export type { BaseReceipts } from "./task-base-retention.ts";
import { checked, command } from "./task-process.ts";

// Increment when the reproducible base setup changes. Never snapshot task disks.
const RECIPE = 1;
export function baseFingerprint(sourceId: string, artifact: string, codex: string, skills: string) {
  return createHash("sha256")
    .update(JSON.stringify([RECIPE, sourceId, artifact, codex, skills]))
    .digest("hex")
    .slice(0, 16);
}
const readyBases = new Map<string, string>();
let queue: Promise<unknown> = Promise.resolve();
export function serializeBase<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => {});
  return next;
}

export async function preparedBase(options: {
  owner: string;
  user: string;
  source: { name: string; id: string };
  serverUrl: string;
  signal: AbortSignal;
  report: (message: string) => void;
  receipts?: BaseReceipts;
}): Promise<string> {
  const { owner, user, source, serverUrl, signal, report } = options;
  const run = (name: string, args: string[]) => ["orbctl", "run", "-m", name, "-u", user, ...args];
  const hash = (value: Buffer) => createHash("sha256").update(value).digest("hex");
  const url = new URL("/install/bb-app.tgz", serverUrl);
  const head = await fetch(url, { method: "HEAD", signal });
  const artifact = head.headers.get("x-bb-artifact-sha256") ?? "";
  if (!head.ok || !/^[a-f0-9]{64}$/.test(artifact))
    throw new Error("BB did not supply a verifiable host artifact.");
  const codex = (await checked(["codex", "--version"], { signal }))
    .trim()
    .match(/^codex-cli (\d+\.\d+\.\d+)$/)?.[1];
  if (!codex) throw new Error("Could not determine the server's stable Codex version.");
  let building: string | null = null;
  const staging = await mkdtemp(join(tmpdir(), "orbisa-base-"));
  try {
    const roots: string[] = [];
    for (const root of [".cursor/skills", ".agents/skills", ".claude/skills", ".codex/skills"]) {
      try {
        await access(join(homedir(), root));
        roots.push(root);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    let skills = Buffer.alloc(0);
    let skillsDigest = hash(skills);
    if (roots.length) {
      const archive = join(staging, "skills.tar");
      await checked(["tar", "-chf", archive, "-C", homedir(), ...roots], { signal });
      skills = await readFile(archive);
      skillsDigest = await skillArchiveFingerprint(archive, signal);
    }
    const fingerprint = baseFingerprint(source.id, artifact, codex, skillsDigest);
    const name = `orbisa-base-${owner}-${fingerprint}`;
    const finish = async () => {
      if (options.receipts) {
        try {
          await prunePreparedBases({
            owner,
            current: name,
            receipts: options.receipts,
            list: async () =>
              JSON.parse(
                await checked(["orbctl", "list", "--format", "json"], { signal }),
              ) as CachedBase[],
            remove: async (vm) => {
              await checked(["orbctl", "delete", "-f", vm.name], { signal });
            },
          });
        } catch {
          signal.throwIfAborted();
          report("Old base cache cleanup deferred until a later launch.");
        }
      }
      return name;
    };
    const inventory = JSON.parse(
      await checked(["orbctl", "list", "--format", "json"], { signal }),
    ) as {
      name: string;
      id: string;
      config: { isolated?: boolean; isolate_network?: boolean; forward_ssh_agent?: boolean };
    }[];
    const existing = inventory.find((vm) => vm.name === name);
    if (existing) {
      if (
        !existing.config.isolated ||
        !existing.config.isolate_network ||
        existing.config.forward_ssh_agent
      )
        throw new Error("Prepared base is no longer isolated.");
      if (((await options.receipts?.get(name)) ?? readyBases.get(name)) === existing.id) {
        report("Cloning prepared Orbisa base (BB, Codex and skills already installed).");
        return await finish();
      }
      building = name;
      await checked(["orbctl", "start", name], { signal });
      const ready = await command(run(name, ["test", "-f", ".cache/orbisa/base-ready"]), {
        signal,
        timeoutMs: 15_000,
      });
      if (ready.exitCode === 0) {
        await checked(["orbctl", "stop", name], { signal });
        readyBases.set(name, existing.id);
        await options.receipts?.set(name, existing.id);
        report("Cloning prepared Orbisa base (BB, Codex and skills already installed).");
        return await finish();
      }
      // An interrupted build contains no credentials or work; rebuild it.
      await checked(["orbctl", "delete", "-f", name], { signal });
    }
    report("Updating clean Orbisa base for this BB build, Codex and skills.");
    await checked(["orbctl", "clone", source.name, name], { signal });
    building = name;
    await checked(["orbctl", "start", name], { signal });
    await checked(
      run(name, [
        "sh",
        "-c",
        "test ! -e /mnt/mac && test ! -d ~/.bb-machines && test ! -e ~/.codex/auth.json && test ! -e ~/.codex_work/auth.json && test ! -e ~/.config/orbisa/bb-task-owner",
      ]),
      { signal },
    );
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error("Could not download BB host artifact for the base.");
    const packageBytes = Buffer.from(await response.arrayBuffer());
    if (hash(packageBytes) !== artifact)
      throw new Error("BB changed during base preparation; retry with its new artifact.");
    await checked(
      run(name, ["sh", "-c", "mkdir -p ~/.cache/orbisa; cat > ~/.cache/orbisa/bb-app.tgz"]),
      { signal, stdin: packageBytes },
    );
    await checked(
      run(name, [
        "sh",
        "-c",
        'npm install -g --allow-scripts=better-sqlite3,node-pty,@parcel/watcher --prefix "$HOME/.cache/orbisa/bootstrap/npm" "$HOME/.cache/orbisa/bb-app.tgz" && rm "$HOME/.cache/orbisa/bb-app.tgz"',
      ]),
      { signal, timeoutMs: 300_000 },
    );
    await checked(
      run(name, ["sh", "-c", "cat > ~/.cache/orbisa/bootstrap/host-artifact.sha256"]),
      { signal, stdin: artifact },
    );
    await checked(
      ["orbctl", "run", "-m", name, "-u", "root", "npm", "install", "-g", `@openai/codex@${codex}`],
      { signal, timeoutMs: 300_000 },
    );
    if (skills.length)
      await checked(run(name, ["sh", "-c", 'tar -xf - -C "$HOME"']), { signal, stdin: skills });
    await checked(
      run(name, [
        "sh",
        "-c",
        "mkdir -p ~/.config/orbisa; touch ~/.config/orbisa/bb-task-skills-ready ~/.cache/orbisa/base-ready",
      ]),
      { signal },
    );
    await checked(["orbctl", "stop", name], { signal });
    const built = (
      JSON.parse(await checked(["orbctl", "list", "--format", "json"], { signal })) as {
        name: string;
        id: string;
      }[]
    ).find((vm) => vm.name === name);
    if (!built) throw new Error("Prepared base disappeared before it was recorded.");
    readyBases.set(name, built.id);
    await options.receipts?.set(name, built.id);
    return await finish();
  } finally {
    if (building)
      await checked(["orbctl", "stop", building], { timeoutMs: 30_000 }).catch(() => {});
    await rm(staging, { recursive: true, force: true });
  }
}
