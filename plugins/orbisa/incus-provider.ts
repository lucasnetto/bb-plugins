import type { BbPluginApi, MachineExecutor } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { incusHostContract, incusRequest } from "./incus-contract.ts";
import { checked } from "./task-process.ts";

const inputsSchema = z.object({
  runtimeHostId: z.string().min(1),
  image: z.string().default("orbisa-tooling-v2"),
});
const resourceSchema = inputsSchema.extend({
  owner: z.string(),
  key: z.string(),
  id: z
    .string()
    .regex(/^[a-f0-9]{32}$/)
    .optional(),
});
type Resource = z.infer<typeof resourceSchema>;
const responseSchema = z.object({
  version: z.literal(1),
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});

export function registerIncusProvider(
  bb: BbPluginApi,
  options: {
    prepareCredentials?: (executor: MachineExecutor, signal: AbortSignal) => Promise<void>;
  } = {},
) {
  const owner =
    "bb-" + createHash("sha256").update(bb.server.experimental_dataDir).digest("hex").slice(0, 20);
  const client = bb.hosts.experimental_client({ contract: incusHostContract });
  const owned = (value: unknown) => {
    const r = resourceSchema.parse(value);
    if (r.owner !== owner) throw new Error("Foreign Orbisa owner.");
    return r;
  };
  const call = async (
    r: Resource,
    action: z.infer<typeof incusRequest>["action"],
    signal: AbortSignal,
    extra: Partial<z.infer<typeof incusRequest>> = {},
  ) => {
    const request = incusRequest.parse({
      ...extra,
      action,
      owner: r.owner,
      key: r.key,
      ...(r.id ? { id: r.id } : {}),
      image: r.image,
    });
    const reply = await client.call("run", request, {
      hostId: r.runtimeHostId,
      signal,
      timeoutMs: Math.min(request.timeoutMs + 10_000, 1_800_000),
    });
    return reply;
  };
  const lifecycle = async (
    r: Resource,
    action: "create" | "start" | "stop" | "remove",
    signal: AbortSignal,
  ) => {
    const result = await call(r, action, signal);
    const response = responseSchema.parse(JSON.parse(result.stdout));
    if (result.exitCode !== 0 || !response.ok)
      throw new Error(
        `Orbisa ${response.error?.code ?? "failed"}: ${response.error?.message ?? "command failed"}`,
      );
    return response.data;
  };
  const executor = (r: Resource): MachineExecutor => ({
    exec: async ({ command, stdin, timeoutMs, signal, onOutput }) => {
      const result = await call(r, "exec", signal, {
        command,
        stdin,
        timeoutMs: Math.min(timeoutMs, 1_700_000),
      });
      if (result.stdout) onOutput(result.stdout);
      if (result.stderr) onOutput(result.stderr);
      return { exitCode: result.exitCode };
    },
  });
  const prepare = async (
    r: Resource,
    signal: AbortSignal,
    report: { step(text: string): void },
  ) => {
    await lifecycle(r, "start", signal);
    if (options.prepareCredentials) {
      await options.prepareCredentials(executor(r), signal);
      return;
    }
    const profile = basename(bb.server.experimental_dataDir) === ".bb-work" ? "work" : "personal";
    const authPath = join(homedir(), profile === "work" ? ".codex_work" : ".codex", "auth.json");
    const [auth, versionText, github] = await Promise.all([
      readFile(authPath, "utf8"),
      checked(["codex", "--version"], { signal }),
      checked(["gh", "auth", "token"], { signal }),
    ]);
    const version = versionText.match(/^codex-cli (\d+\.\d+\.\d+)/)?.[1];
    if (!version) throw new Error("Cannot determine the server's Codex version.");
    JSON.parse(auth);
    report.step(`Preparing Codex ${version} and profile credentials`);
    const install = await call(r, "exec", signal, {
      command: [
        "sh",
        "-ec",
        `test "$(codex --version 2>/dev/null)" = "codex-cli ${version}" || npm install -g @openai/codex@${version}`,
      ],
    });
    if (install.exitCode !== 0)
      throw new Error("Failed installing the Codex runtime in the container.");
    const credentials = await call(r, "exec", signal, {
      command: ["python3", "-c", INSTALL_AUTH],
      stdin: JSON.stringify({ auth, github: github.trim() }),
    });
    if (credentials.exitCode !== 0)
      throw new Error("Failed preparing profile credentials in the container.");
  };
  bb.experimental_machines.register({
    id: "orbisa-incus",
    displayName: "Orbisa Linux container",
    icon: "Server",
    description:
      "Dedicated Linux environment on an Incus host. Files remain until explicit removal.",
    ephemeral: false,
    inputs: inputsSchema,
    async create(context) {
      let r: Resource = { ...inputsSchema.parse(context.inputs), owner, key: context.key };
      // Save the transport destination before any remote allocation so cleanup
      // by key works even when the first checkpoint response is interrupted.
      const prior = await bb.storage.kv.get(`incus-intent/${context.key}`);
      if (prior) {
        const saved = owned(prior);
        if (saved.runtimeHostId !== r.runtimeHostId || saved.image !== r.image)
          throw new Error("Allocation inputs changed.");
        r = saved;
      }
      await bb.storage.kv.set(`incus-intent/${context.key}`, r);
      await context.checkpoint(r);
      context.report.step("Allocating Orbisa container on the Linux host");
      const allocation = z
        .object({ id: z.string(), name: z.string() })
        .parse(await lifecycle(r, "create", context.signal));
      r = { ...r, id: allocation.id };
      await bb.storage.kv.set(`incus-intent/${context.key}`, r);
      await context.checkpoint(r);
      await prepare(r, context.signal, context.report);
      await bb.experimental_machines.bootstrap({
        key: r.key,
        executor: executor(r),
        report: context.report,
        signal: context.signal,
      });
      return { status: "created", name: allocation.name, resource: r };
    },
    async reconcileCleanup(context) {
      const value = await bb.storage.kv.get(`incus-intent/${context.key}`);
      if (value) await lifecycle(owned(value), "remove", context.signal);
      return { status: "removed" };
    },
    async suspend(context) {
      const r = owned(context.resource);
      await context.checkpoint(r);
      await lifecycle(r, "stop", context.signal);
      return { resource: r };
    },
    async resume(context) {
      const r = owned(context.resource);
      await prepare(r, context.signal, context.report);
      await context.checkpoint(r);
      await bb.experimental_machines.bootstrap({
        key: r.key,
        executor: executor(r),
        report: context.report,
        signal: context.signal,
      });
      return { resource: r };
    },
    async remove(context) {
      await lifecycle(owned(context.resource), "remove", context.signal);
      return { status: "removed" };
    },
  });
  bb.experimental_environments.register({
    id: "orbisa-incus",
    displayName: "Orbisa Linux container",
    icon: "Server",
    description: "A private Linux container and project checkout.",
    machineProviderId: "orbisa-incus",
    environmentProviderId: "project-checkout",
  });
}

const INSTALL_AUTH = String.raw`
import json, os, pathlib, subprocess, sys
p=json.load(sys.stdin)
os.umask(0o077)
secrets=pathlib.Path('/dev/shm/orbisa'); secrets.mkdir(exist_ok=True)
(secrets/'codex-auth.json').write_text(p['auth'])
(secrets/'github-token').write_text(p['github'])
for name in ('.codex', '.codex_work'):
 d=pathlib.Path('/root')/name; d.mkdir(exist_ok=True)
 target=d/'auth.json'
 if target.is_symlink() or target.exists(): target.unlink()
 target.symlink_to(secrets/'codex-auth.json')
helper=pathlib.Path('/usr/local/bin/orbisa-git-credential')
helper.write_text('''#!/usr/bin/python3
import pathlib,sys
if len(sys.argv)>1 and sys.argv[1]=="get":
 fields=dict(line.rstrip("\\n").split("=",1) for line in sys.stdin if "=" in line)
 if fields.get("host")=="github.com" and fields.get("protocol")=="https":
  print("username=x-access-token\\npassword="+pathlib.Path("/dev/shm/orbisa/github-token").read_text()+"\\n")
''')
helper.chmod(0o700)
subprocess.run(['git','config','--global','credential.helper',str(helper)],check=True)
subprocess.run(['git','config','--global','url.https://github.com/.insteadOf','git@github.com:'],check=True)
`;
