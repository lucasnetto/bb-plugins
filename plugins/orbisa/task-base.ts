import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { cachedSkillArchive } from "./task-skills.ts";
import type { BaseReceipts } from "./task-base-retention.ts";
export type { BaseReceipts } from "./task-base-retention.ts";
import { checked as runChecked, command as runCommand } from "./task-process.ts";
import { StartupFailure } from "./task-startup.ts";

// Increment when the reproducible base setup changes. Never snapshot task disks.
export const BASE_RECIPE = 2;
export function baseFingerprint(
  sourceId: string,
  artifact: string,
  codex: string,
  skills: string,
  recipe = BASE_RECIPE,
) {
  return createHash("sha256")
    .update(JSON.stringify([recipe, sourceId, artifact, codex, skills]))
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

export async function preparedBase(
  options: {
    owner: string;
    user: string;
    source: { name: string; id: string };
    serverUrl: string;
    signal: AbortSignal;
    report: (message: string) => void;
    receipts?: BaseReceipts;
  },
  runtime = { checked: runChecked, command: runCommand, fetch, home: homedir() },
): Promise<string> {
  const { checked, command, fetch: fetchArtifact, home } = runtime;
  const { owner, user, source, serverUrl, signal, report } = options;
  const run = (name: string, args: string[]) => ["orbctl", "run", "-m", name, "-u", user, ...args];
  const hash = (value: Buffer) => createHash("sha256").update(value).digest("hex");
  const url = new URL("/install/bb-app.tgz", serverUrl);
  const head = await fetchArtifact(url, { method: "HEAD", signal });
  const artifact = head.headers.get("x-bb-artifact-sha256") ?? "";
  if (!head.ok || !/^[a-f0-9]{64}$/.test(artifact))
    throw new StartupFailure(
      "incompatible-runtime",
      "BB did not supply a verifiable host artifact. Update the Mac BB installation, then retry.",
    );
  const codex = (await checked(["codex", "--version"], { signal }))
    .trim()
    .match(/^codex-cli (\d+\.\d+\.\d+)$/)?.[1];
  if (!codex)
    throw new StartupFailure(
      "incompatible-runtime",
      "Install a stable Codex CLI on the Mac, then retry.",
    );
  let building: string | null = null;

  try {
    const skills = await cachedSkillArchive(home, signal, options.receipts?.cacheDir);
    const skillsDigest = skills.digest;
    const fingerprint = baseFingerprint(source.id, artifact, codex, skillsDigest);
    const name = `orbisa-base-${owner}-${fingerprint}`;
    const finish = async () => {
      await options.receipts?.touch?.(name, Date.now());
      await options.receipts?.select?.(name);
      return name;
    };
    const inventory = JSON.parse(
      await checked(["orbctl", "list", "--format", "json"], { signal }),
    ) as {
      name: string;
      id: string;
      config: {
        isolated?: boolean;
        isolate_network?: boolean;
        forward_ssh_agent?: boolean;
        mounts?: unknown[];
      };
    }[];
    const existing = inventory.find((vm) => vm.name === name);
    if (existing) {
      if (
        !existing.config.isolated ||
        !existing.config.isolate_network ||
        existing.config.forward_ssh_agent ||
        existing.config.mounts?.length
      )
        throw new Error("Prepared base is no longer isolated.");
      if (((await options.receipts?.get(name)) ?? readyBases.get(name)) === existing.id) {
        report("Cloning prepared Orbisa base (BB, Codex and skills already installed).");
        return await finish();
      }
      building = name;
      await checked(["orbctl", "start", name], { signal });
      const ready = await command(run(name, ["cat", ".cache/orbisa/base-ready"]), {
        signal,
        timeoutMs: 15_000,
      });
      if (ready.exitCode === 0 && ready.stdout.trim() === fingerprint) {
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
    const response = await fetchArtifact(url, { signal });
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
    // BB's launcher shadows Babashka on PATH; pin the Clojure helpers only.
    await checked(run(name, ["python3", "-c", PIN_BABASHKA]), { signal });
    if (skills.archive)
      await checked(run(name, ["sh", "-c", 'tar -xf - -C "$HOME"']), {
        signal,
        stdinFile: skills.archive,
      });
    await checked(
      run(name, [
        "sh",
        "-c",
        "mkdir -p ~/.config/orbisa; touch ~/.config/orbisa/bb-task-skills-ready; cat > ~/.cache/orbisa/base-ready",
      ]),
      { signal, stdin: fingerprint },
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
  }
}

export const PIN_BABASHKA = String.raw`
import pathlib,subprocess
tools=[pathlib.Path.home()/'.local/bin'/name for name in ('clj-eval','clj-nrepl-eval','clj-paren-repair')]
if any(path.is_file() for path in tools):
    result=subprocess.run(['/usr/local/bin/bb','--version'],capture_output=True,text=True,check=True)
    if not result.stdout.startswith('babashka '): raise RuntimeError('Expected Babashka at /usr/local/bin/bb')
    for path in tools:
        if path.is_file():
            contents=path.read_text()
            if contents.startswith('#!/usr/bin/env bb\n'):
                path.write_text(contents.replace('#!/usr/bin/env bb\n','#!/usr/local/bin/bb\n',1))
`;
