import { overlap } from "./task-concurrency.ts";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { MachineExecutor } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { checked, command } from "./task-process.ts";
import { preparedBase, serializeBase, type BaseReceipts } from "./task-base.ts";

export const TASK_PROVIDER = "orbisa-task";
export const resourceSchema = z.object({
  key: z.string().min(1),
  owner: z.string().min(1),
  name: z.string().regex(/^bb-task-[a-f0-9]{10}-[a-f0-9]{20}$/),
  vmId: z.string().nullable(),
});
export type TaskResource = z.infer<typeof resourceSchema>;
const digest = (value: string, length: number) =>
  createHash("sha256").update(value).digest("hex").slice(0, length);
export const taskOwner = (dataDir: string) => digest(dataDir, 10);
export function taskResource(owner: string, key: string): TaskResource {
  return { key, owner, name: `bb-task-${owner}-${digest(key, 20)}`, vmId: null };
}
export function ownedResource(owner: string, value: unknown): TaskResource {
  const resource = resourceSchema.parse(value);
  if (resource.owner !== owner || resource.name !== taskResource(owner, resource.key).name) {
    throw new Error("Refusing to operate on a VM owned by another BB instance.");
  }
  return resource;
}

const machinesSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    state: z.string(),
    config: z.object({
      isolated: z.boolean().optional(),
      isolate_network: z.boolean().optional(),
      forward_ssh_agent: z.boolean().optional(),
      mounts: z.array(z.unknown()).optional(),
    }),
  }),
);
type Vm = z.infer<typeof machinesSchema>[number];
function isolated(vm: Vm) {
  return (
    vm.config.isolated === true &&
    vm.config.isolate_network === true &&
    vm.config.forward_ssh_agent === false &&
    (vm.config.mounts?.length ?? 0) === 0
  );
}

export interface TaskDriver {
  available(template: string): Promise<boolean>;
  allocate(
    resource: TaskResource,
    template: string,
    signal: AbortSignal,
    report?: (message: string) => void,
  ): Promise<TaskResource>;
  prepare(
    resource: TaskResource,
    signal: AbortSignal,
    report: (text: string) => void,
    forRemoval?: boolean,
  ): Promise<void>;
  executor(resource: TaskResource): MachineExecutor;
  startDaemon?(resource: TaskResource, hostId: string, signal: AbortSignal): Promise<boolean>;
  stop(resource: TaskResource, signal: AbortSignal): Promise<void>;
  remove(resource: TaskResource, signal: AbortSignal): Promise<void>;
}

// This adapter manages only bb-task-* clones. Stable Orbisa slots, SSH aliases,
// Cursor registration and the original Orbisa commands remain independent.
export function createTaskDriver(
  dataDir: string,
  serverUrl?: () => string,
  receipts?: BaseReceipts,
): TaskDriver {
  const owner = taskOwner(dataDir);
  const profile = basename(dataDir) === ".bb-work" ? "work" : "personal";
  const user = process.env.ORBISA_REMOTE_USER ?? "lucas_netto";
  if (!/^[a-z_][a-z0-9_-]*$/.test(user)) throw new Error("Invalid Orbisa remote user.");
  const run = (name: string, argv: string[]) => ["orbctl", "run", "-m", name, "-u", user, ...argv];
  const list = async (signal?: AbortSignal) =>
    machinesSchema.parse(
      JSON.parse(await checked(["orbctl", "list", "--format", "json"], { signal })),
    );
  async function lookup(value: TaskResource, signal: AbortSignal) {
    const resource = ownedResource(owner, value);
    const vm = (await list(signal)).find((item) => item.name === resource.name);
    if (vm && resource.vmId !== null && vm.id !== resource.vmId)
      throw new Error("Task VM identity changed; refusing to touch its replacement.");
    return vm;
  }
  const optionalRead = async (path: string) => {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  };
  return {
    async available(template) {
      if (process.platform !== "darwin") return false;
      try {
        return (await list()).some((vm) => vm.name === template && isolated(vm));
      } catch {
        return false;
      }
    },
    async allocate(value, template, signal, report = () => {}) {
      const resource = ownedResource(owner, value);
      let vm = await lookup(resource, signal);
      if (!vm) {
        const base = (await list(signal)).find((item) => item.name === template);
        if (!base || !isolated(base) || /^(bb-task-|orbisa-base-|180seg-orbisa-)/.test(template)) {
          throw new Error(
            "Choose an isolated clean Orbisa template, not a shared slot or another task VM.",
          );
        }
        await serializeBase(async () => {
          const source = serverUrl
            ? await preparedBase({
                owner,
                user,
                source: base,
                serverUrl: serverUrl(),
                signal,
                report,
                receipts,
              })
            : template;
          await checked(["orbctl", "clone", source, resource.name], { signal });
        });
        vm = await lookup(resource, signal);
      }
      if (!vm || !isolated(vm))
        throw new Error("Task VM is missing or its isolation settings are unsafe.");
      return { ...resource, vmId: vm.id };
    },
    async prepare(resource, signal, report, forRemoval = false) {
      const vm = await lookup(resource, signal);
      if (!vm || !isolated(vm)) throw new Error("Task VM is missing or no longer isolated.");
      const boot = async (signal: AbortSignal) => {
        await checked(["orbctl", "start", resource.name], { signal });
        await checked(
          run(resource.name, [
            "sh",
            "-c",
            "test ! -e /mnt/mac && command -v node >/dev/null && command -v curl >/dev/null && command -v python3 >/dev/null",
          ]),
          { signal },
        );
      };
      // BB may briefly resume a persistent machine to finish workspace teardown.
      // Expired user credentials must not prevent disposal of a finished task.
      if (forRemoval) {
        await boot(signal);
        return;
      }
      // Read independent local credentials and tool versions concurrently.
      const [guestCodex, [localCodex, githubToken, aws, cursor, codex, signing]] = await overlap(
        signal,
        async (signal) => {
          await boot(signal);
          return command(run(resource.name, ["codex", "--version"]), { signal }).catch(() => null);
        },
        async (signal) =>
          Promise.all([
            command(["codex", "--version"], { signal }).catch(() => null),
            checked(["gh", "auth", "token"], { signal }),
            command(["aws", "configure", "export-credentials", "--format", "process"], {
              signal,
            }).catch(() => null),
            command(
              [
                "/usr/bin/security",
                "find-generic-password",
                "-s",
                `bb.cursor.${profile}.api-key`,
                "-a",
                profile === "work" ? "lucas-work" : "lucas-personal",
                "-w",
              ],
              { signal },
            ),
            optionalRead(
              join(homedir(), profile === "work" ? ".codex_work" : ".codex", "auth.json"),
            ),
            optionalRead(
              process.env.ORBISA_SIGNING_KEY ?? join(homedir(), ".config/orbisa/signing_key"),
            ),
          ]),
      );
      const codexVersion = localCodex?.stdout.trim().match(/^codex-cli (\d+\.\d+\.\d+)$/)?.[1];
      if (codexVersion && guestCodex?.stdout.trim() !== `codex-cli ${codexVersion}`) {
        report(`Installing Codex ${codexVersion} to match this server.`);
        await checked(
          [
            "orbctl",
            "run",
            "-m",
            resource.name,
            "-u",
            "root",
            "npm",
            "install",
            "-g",
            `@openai/codex@${codexVersion}`,
          ],
          { signal, timeoutMs: 300_000 },
        );
      }
      const github = githubToken.trim();
      const payload = {
        owner: resource.name,
        github,
        aws: aws?.exitCode === 0 ? JSON.parse(aws.stdout) : null,
        cursor: cursor.exitCode === 0 ? cursor.stdout.trim() : null,
        codex,
        signing,
        profile,
        region: process.env.ORBISA_AWS_REGION ?? "us-east-2",
      };
      await checked(
        run(resource.name, [
          "sh",
          "-c",
          "test -f ~/.config/orbisa/bb-task-owner || test ! -d ~/.bb-machines",
        ]),
        { signal },
      );
      await checked(run(resource.name, ["python3", "-c", INSTALL_CREDENTIALS]), {
        signal,
        stdin: JSON.stringify(payload),
      });
      const skillsReady = await command(
        run(resource.name, ["test", "-f", ".config/orbisa/bb-task-skills-ready"]),
        { signal },
      );
      if (skillsReady.exitCode !== 0) {
        const roots: string[] = [];
        for (const path of [
          ".cursor/skills",
          ".agents/skills",
          ".claude/skills",
          ".codex/skills",
        ]) {
          try {
            await access(join(homedir(), path));
            roots.push(path);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        }
        const staging = await mkdtemp(join(tmpdir(), "bb-orbisa-skills-"));
        try {
          if (roots.length) {
            const archive = join(staging, "skills.tgz");
            // Follow skill symlinks: Mac absolute symlinks do not resolve on Linux.
            await checked(["tar", "-czhf", archive, "-C", homedir(), ...roots], { signal });
            await checked(run(resource.name, ["sh", "-c", 'tar -xzf - -C "$HOME"']), {
              signal,
              stdin: await readFile(archive),
            });
          }
          await checked(run(resource.name, ["touch", ".config/orbisa/bb-task-skills-ready"]), {
            signal,
          });
        } finally {
          await rm(staging, { recursive: true, force: true });
        }
      }
      if (payload.cursor && profile === "personal") {
        const path = join(homedir(), ".local/bin/cursor-agent-personal-acp");
        await checked(
          [
            "orbctl",
            "run",
            "-m",
            resource.name,
            "-u",
            "root",
            "python3",
            "-c",
            "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.parent.mkdir(parents=True,exist_ok=True); p.unlink(missing_ok=True); p.symlink_to(sys.argv[2])",
            path,
            `/home/${user}/.local/bin/cursor-agent-personal-acp`,
          ],
          { signal },
        );
      }
      if (!payload.aws) report("AWS session unavailable; GitHub and provider setup continue.");
      if (!codex)
        report(
          "No local Codex login for this profile; sign in on the task machine before using Codex.",
        );
      report("Task VM credentials refreshed.");
    },
    executor(value) {
      const resource = ownedResource(owner, value);
      return {
        exec: async (request) => {
          // Seed software only. Each clone enrolls independently into this directory.
          const cached = await command(
            run(resource.name, ["test", "-f", ".cache/orbisa/base-ready"]),
            { signal: request.signal },
          );
          if (cached.exitCode !== 0) return command(run(resource.name, request.command), request);
          await checked(
            run(resource.name, [
              "sh",
              "-c",
              'if [ ! -d "$HOME/.bb-machines/orbisa" ]; then mkdir -p "$HOME/.bb-machines"; mv "$HOME/.cache/orbisa/bootstrap" "$HOME/.bb-machines/orbisa"; fi',
            ]),
            { signal: request.signal },
          );
          return command(
            run(resource.name, [
              "env",
              `BB_DATA_DIR=/home/${user}/.bb-machines/orbisa`,
              ...request.command,
            ]),
            request,
          );
        },
      };
    },
    async startDaemon(resource, hostId, signal) {
      if (!/^host_[a-z0-9]+$/.test(hostId)) return false;
      const vm = await lookup(resource, signal);
      if (!vm || !isolated(vm)) throw new Error("Task VM is missing or no longer isolated.");
      const result = await command(
        run(resource.name, ["python3", "-c", START_DAEMON_SCRIPT, hostId]),
        { signal, timeoutMs: 10_000 },
      );
      return result.exitCode === 0;
    },
    async stop(resource, signal) {
      if (await lookup(resource, signal))
        await checked(["orbctl", "stop", resource.name], { signal });
    },
    async remove(resource, signal) {
      const vm = await lookup(resource, signal);
      if (vm) await checked(["orbctl", "delete", "--force", vm.name], { signal });
    },
  };
}

const INSTALL_CREDENTIALS = String.raw`
import json, os, pathlib, sys, tempfile
p = json.load(sys.stdin)
home = pathlib.Path.home()
root = pathlib.Path('/dev/shm/orbisa')
root.mkdir(mode=0o700, parents=True, exist_ok=True)
os.chmod(root, 0o700)
marker = home/'.config/orbisa/bb-task-owner'
owned = marker.exists() and marker.read_text() == p['owner']
if marker.exists() and not owned: raise RuntimeError('Task template belongs to another machine')
def write(path, contents, mode=0o600):
    path = pathlib.Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as f: f.write(contents)
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)
def link(path, target):
    path = pathlib.Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.is_symlink(): path.unlink()
    elif path.exists() and not owned:
        # A new task must never silently inherit another account from its template.
        raise RuntimeError('Template contains persistent credentials: ' + str(path))
    elif path.exists(): path.unlink()
    path.symlink_to(target)
write(root/'github-token', p['github'])
if p['aws']:
    a = p['aws']
    write(root/'credentials', '[default]\naws_access_key_id = '+a['AccessKeyId']+'\naws_secret_access_key = '+a['SecretAccessKey']+'\naws_session_token = '+a.get('SessionToken','')+'\n')
    link(home/'.aws/credentials', root/'credentials')
    write(home/'.aws/config', '[default]\nregion = '+p['region']+'\n')
if p['signing']: write(root/'signing_key', p['signing'])
if p['codex']:
    write(root/'codex-auth.json', p['codex'])
    link(home/'.codex/auth.json', root/'codex-auth.json')
    link(home/'.codex_work/auth.json', root/'codex-auth.json')
if p['cursor']:
    write(root/'cursor-api-key', p['cursor'])
    link(home/('.config/orbisa/cursor-'+p['profile']+'-api-key'), root/'cursor-api-key')
    launcher = '#!/usr/bin/env python3\nimport os,sys,pathlib\nk=pathlib.Path("/dev/shm/orbisa/cursor-api-key").read_text().strip()\nif not k: raise SystemExit("Cursor key unavailable")\nos.environ["CURSOR_API_KEY"]=k\na=["--list-models"] if "--list-models" in sys.argv[1:] else ["acp"]\nos.execvp("cursor-agent",["cursor-agent",*a])\n'
    write(home/'.local/bin/bb-cursor-work-acp', launcher, 0o700)
    write(home/'.local/bin/cursor-agent-personal-acp', launcher, 0o700)
write(marker, p['owner'])
`;

export const START_DAEMON_SCRIPT = String.raw`
import pathlib,subprocess,sys
units=list((pathlib.Path.home()/'.config/systemd/user').glob('bb-host-daemon-*-'+sys.argv[1]+'.service'))
if len(units)!=1 or units[0].is_symlink(): sys.exit(1)
data=pathlib.Path.home()/'.bb-machines/orbisa'
if data.resolve()!=data or (data/'host-id').read_text().strip()!=sys.argv[1]: sys.exit(1)
if 'Environment="BB_DATA_DIR='+str(data)+'"' not in units[0].read_text(): sys.exit(1)
# Match BB's enrolled-machine --start lifecycle: release its suspension marker.
marker=data/'machine-suspended'
if marker.is_symlink(): sys.exit(1)
marker.unlink(missing_ok=True)
subprocess.run(['systemctl','--user','reset-failed',units[0].name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True)
sys.exit(subprocess.run(['systemctl','--user','start',units[0].name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode)
`;
