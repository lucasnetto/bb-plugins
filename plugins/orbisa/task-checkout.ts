import { taskReadiness } from "./task-readiness.ts";
import { StartupFailure } from "./task-startup.ts";
import { concurrently, CATALOG_CONCURRENCY } from "./task-concurrency.ts";
import { timed } from "./task-timing.ts";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { discoverCatalog } from "./task-catalog.ts";
import { dirname, join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { checked } from "./task-process.ts";
import { normalizeRemote, withGitBundle } from "./task-git-cache.ts";
import { ownedResource, type TaskResource, TASK_PROVIDER } from "./task-vms.ts";

export const CHECKOUT_PROVIDER = "orbisa-checkout";
export const checkoutInputs = z.object({
  branch: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("existing"), name: z.string().min(1) }),
      z.object({ kind: z.literal("new"), baseBranch: z.string().min(1) }),
    ])
    .optional(),
});
export function checkoutPath(user: string, key: string) {
  if (!/^[a-z_][a-z0-9_-]*$/.test(user)) throw new Error("Invalid Orbisa remote user.");
  return `/home/${user}/orbisa-workspaces/${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
}

export function registerTaskCheckout(bb: BbPluginApi, owner: string) {
  const user = process.env.ORBISA_REMOTE_USER ?? "lucas_netto";
  const cache = join(dirname(bb.storage.database().name), "git-cache");
  async function machine(hostId: string, signal: AbortSignal) {
    const resource = ownedResource(owner, await bb.storage.kv.get(`task-resource/${hostId}`));
    const inventory = JSON.parse(
      await checked(["orbctl", "list", "--format", "json"], { signal }),
    ) as {
      id: string;
      name: string;
      config: {
        isolated?: boolean;
        isolate_network?: boolean;
        forward_ssh_agent?: boolean;
        mounts?: unknown[];
      };
    }[];
    const vm = inventory.find((item) => item.name === resource.name);
    if (
      !vm ||
      vm.id !== resource.vmId ||
      !vm.config.isolated ||
      !vm.config.isolate_network ||
      vm.config.forward_ssh_agent ||
      vm.config.mounts?.length
    )
      throw new Error("Task VM identity or isolation changed.");
    return resource;
  }
  const run = (resource: TaskResource, args: string[]) => [
    "orbctl",
    "run",
    "-m",
    resource.name,
    "-u",
    user,
    ...args,
  ];
  const catalogRoot = join(homedir(), "Developer/180seg");
  async function isCatalog(projectId: string) {
    const project = await bb.sdk.projects.get({ projectId });
    return (
      project.gitRemoteUrl === null && project.sources.some((source) => source.path === catalogRoot)
    );
  }
  bb.experimental_environments.register({
    id: CHECKOUT_PROVIDER,
    displayName: "Orbisa checkout",
    description: "Create a task checkout from a cached Git bundle on an Orbisa VM.",
    icon: "FolderGit",
    requires: {},
    inputs: checkoutInputs,
    policy: { retireGraceMs: null },
    async availability({ host, project }) {
      return host.machineProviderId === TASK_PROVIDER &&
        (project.gitRemoteUrl !== null || (await isCatalog(project.id)))
        ? { status: "available" }
        : { status: "unavailable", message: "Requires an Orbisa task VM." };
    },
    async validate({ host, project }) {
      if (host.machineProviderId !== TASK_PROVIDER)
        return { action: "refuse", message: "Requires an Orbisa task VM." };
      try {
        if (project.gitRemoteUrl === null) {
          if (await isCatalog(project.id)) return { action: "accept" };
          return {
            action: "refuse",
            message:
              "[unsupported-workspace] Choose a project with a Git remote or the configured 180seg workspace.",
          };
        }
        normalizeRemote(project.gitRemoteUrl);
        return { action: "accept" };
      } catch {
        return {
          action: "refuse",
          message: "Use a credential-free HTTPS Git remote (GitHub SSH URLs are also accepted).",
        };
      }
    },
    async create(context) {
      const path = checkoutPath(user, context.pathKey);
      if (!(await context.experimental_claimPath(path)))
        return { status: "failed", message: "Checkout path belongs to another environment." };
      const resource = await machine(context.host.id, context.signal);
      const timings = z
        .array(z.string().max(300))
        .max(10)
        .safeParse(await bb.storage.kv.get(`task-timings/${context.host.id}`));
      if (timings.success) context.report.log(`${timings.data.join("\n")}\n`);
      const readiness = async (catalog: boolean) => {
        const checks = await timed(
          (text) => context.report.log(`${text}\n`),
          "Task readiness",
          () =>
            taskReadiness({
              name: resource.name,
              user,
              path,
              catalog,
              signal: context.signal,
              report: (text) => context.report.log(`${text}\n`),
              hostConnected: async () =>
                (await bb.sdk.hosts.get({ hostId: context.host.id })).status === "connected",
            }),
        );
        await bb.storage.kv.set(`task-readiness/${context.host.id}`, {
          at: Date.now(),
          path,
          checks,
        });
      };
      if (context.project.gitRemoteUrl === null) {
        if (!(await isCatalog(context.project.id)))
          throw new StartupFailure(
            "unsupported-workspace",
            "Choose a project with a Git remote or the configured 180seg workspace.",
          );
        if (context.inputs.branch)
          return {
            status: "failed",
            message: "Choose branches inside the individual 180seg repositories.",
          };
        context.report.step("Discovering 180seg repository catalog");
        const repositories = await discoverCatalog(catalogRoot, context.signal);
        context.report.step(
          `Preparing ${repositories.length} repositories (${CATALOG_CONCURRENCY} at a time)`,
        );
        await timed(
          (text) => context.report.log(`${text}\n`),
          "180seg repository preparation",
          () =>
            concurrently(
              repositories,
              CATALOG_CONCURRENCY,
              context.signal,
              async (repository, signal) => {
                context.report.log(
                  `Seeding ${repository.relative} from committed local Git state\n`,
                );
                await withGitBundle(
                  cache,
                  repository.source,
                  signal,
                  async (bundle, defaultBranch) => {
                    await checked(
                      run(resource, [
                        "python3",
                        "-c",
                        CHECKOUT_SCRIPT,
                        JSON.stringify({
                          path: `${path}/${repository.relative}`,
                          remote: repository.remote,
                          key: `${context.pathKey}/${repository.relative}`,
                          defaultBranch,
                        }),
                      ]),
                      { signal, timeoutMs: 300_000, stdinFile: bundle },
                    );
                  },
                  (text) => context.report.log(`${repository.relative}: ${text}\n`),
                );
              },
            ),
        );
        const instructions = (
          await readFile(join(homedir(), ".local/libexec/orbisa-agents.md"), "utf8")
        ).replaceAll("/workspace/180seg", path);
        await checked(
          run(resource, [
            "python3",
            "-c",
            "import pathlib,sys; p=pathlib.Path(sys.argv[1]); p.write_text(sys.stdin.read())",
            `${path}/AGENTS.md`,
          ]),
          { signal: context.signal, stdin: instructions },
        );
        const topology = await readFile(
          join(homedir(), ".local/libexec/orbisa-topology.md"),
          "utf8",
        ).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
          return null;
        });
        if (topology)
          await checked(
            run(resource, [
              "python3",
              "-c",
              "import pathlib,sys; pathlib.Path(sys.argv[1]).write_text(sys.stdin.read())",
              `${path}/VM-TOPOLOGY.md`,
            ]),
            { signal: context.signal, stdin: topology },
          );
        await readiness(true);
        return {
          status: "created",
          path,
          ownsPath: true,
          resource: { key: context.pathKey, machine: resource },
        };
      }
      const remote = normalizeRemote(context.project.gitRemoteUrl);
      context.report.step("Refreshing project Git cache");
      await withGitBundle(
        cache,
        remote,
        context.signal,
        async (bundle, defaultBranch) => {
          context.report.step("Creating checkout directly in Orbisa VM");
          await checked(
            run(resource, [
              "python3",
              "-c",
              CHECKOUT_SCRIPT,
              JSON.stringify({
                path,
                remote,
                key: context.pathKey,
                defaultBranch,
                branch: context.inputs.branch,
                suggestedBranch: context.suggestedBranchName,
              }),
            ]),
            { signal: context.signal, timeoutMs: 300_000, stdinFile: bundle },
          );
        },
        (text) => context.report.log(`${text}\n`),
      );
      await readiness(false);
      return {
        status: "created",
        path,
        ownsPath: true,
        resource: { key: context.pathKey, machine: resource },
      };
    },
    async remove(context) {
      if (!context.path) return { status: "removed" };
      if (context.path !== checkoutPath(user, context.pathKey))
        return { status: "failed", message: "Refusing to remove an unexpected checkout path." };
      if (!context.hostId) return { status: "failed", message: "Checkout machine is missing." };
      const resource = await machine(context.hostId, context.signal);
      await checked(run(resource, ["python3", "-c", REMOVE_SCRIPT, context.path]), {
        signal: context.signal,
      });
      return { status: "removed" };
    },
  });
}

export const CHECKOUT_SCRIPT = String.raw`
import json, os, pathlib, shutil, subprocess, sys, tempfile
p=json.loads(sys.argv[1]); path=pathlib.Path(p['path']); staging=path.with_name(path.name+'.preparing')
identity={'key':p['key'],'remote':p['remote']}
if path.resolve()!=path: raise RuntimeError('Checkout path contains a symlink')
env=dict(os.environ, GIT_TERMINAL_PROMPT='0', GIT_LFS_SKIP_SMUDGE='1')
token=pathlib.Path('/dev/shm/orbisa/github-token')
if token.exists(): env['GH_TOKEN']=token.read_text().strip()
def git(*args, cwd=None, capture=False):
    return subprocess.run(['git','-c','credential.helper=','-c','credential.helper=!gh auth git-credential',*args],cwd=cwd,env=env,check=True,stdout=subprocess.PIPE if capture else subprocess.DEVNULL,stderr=subprocess.DEVNULL).stdout
if path.exists() or path.is_symlink():
    marker=path/'.git/orbisa-owner.json'
    if path.is_symlink() or not marker.is_file() or json.loads(marker.read_text())!=identity: raise RuntimeError('Foreign checkout at claimed path')
    # Consume input so the transport does not fail with a broken pipe on recovery.
    shutil.copyfileobj(sys.stdin.buffer, open(os.devnull,'wb'))
    sys.exit(0)
path.parent.mkdir(parents=True,exist_ok=True)
if staging.is_symlink(): raise RuntimeError('Unexpected staging symlink')
if staging.exists(): shutil.rmtree(staging)
fd,bundle=tempfile.mkstemp(prefix='orbisa-',suffix='.bundle',dir=path.parent)
try:
    with os.fdopen(fd,'wb') as f: shutil.copyfileobj(sys.stdin.buffer,f)
    git('clone','--no-checkout','--',bundle,str(staging))
    if p['remote']: git('remote','set-url','origin',p['remote'],cwd=staging)
    else: git('remote','remove','origin',cwd=staging)
    branch=p.get('branch') or {'kind':'existing','name':p['defaultBranch']}
    if branch['kind']=='new':
        base=branch['baseBranch']
        if base.startswith('-'): raise RuntimeError('Invalid Git ref')
        git('checkout','-b',p['suggestedBranch'],base,'--',cwd=staging)
    else:
        name=branch['name']
        if name.startswith('-'): raise RuntimeError('Invalid Git branch')
        git('checkout',name,'--',cwd=staging)
    # LFS is fetched only for repositories which use it, after setting the real remote.
    if shutil.which('git-lfs') and git('lfs','ls-files',cwd=staging,capture=True).strip(): git('lfs','pull',cwd=staging)
    (staging/'.git/orbisa-owner.json').write_text(json.dumps(identity))
    os.rename(staging,path)
finally:
    os.unlink(bundle)
`;
export const REMOVE_SCRIPT = String.raw`
import pathlib,shutil,sys
p=pathlib.Path(sys.argv[1])
if p.resolve()!=p: raise RuntimeError('Checkout path contains a symlink')
for path in (p,p.with_name(p.name+'.preparing')):
    if path.is_symlink(): raise RuntimeError('Refusing checkout symlink')
    if path.exists(): shutil.rmtree(path)
`;
