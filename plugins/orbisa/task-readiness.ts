import { z } from "zod";
import { checked } from "./task-process.ts";
import { StartupFailure, retryConnection, startupStep } from "./task-startup.ts";

const category = z.enum([
  "host-unavailable",
  "unsupported-workspace",
  "authentication-failed",
  "incompatible-runtime",
]);
export const readinessSchema = z.array(
  z.object({
    name: z.string(),
    ok: z.boolean(),
    required: z.boolean(),
    category,
    detail: z.string(),
  }),
);
export type ReadinessCheck = z.infer<typeof readinessSchema>[number];
export function verifyReadiness(checks: ReadinessCheck[], report: (text: string) => void) {
  for (const check of checks)
    report(`${check.ok ? "OK" : check.required ? "FAIL" : "WARN"} ${check.name}: ${check.detail}`);
  const failure = checks.find((check) => check.required && !check.ok);
  if (failure) throw new StartupFailure(failure.category, `${failure.name}: ${failure.detail}`);
}

export async function taskReadiness(options: {
  name: string;
  user: string;
  path: string;
  catalog: boolean;
  signal: AbortSignal;
  report: (text: string) => void;
  hostConnected: () => Promise<boolean>;
}) {
  const { name, user, path, catalog, signal, report } = options;
  const output = await startupStep(
    "host-unavailable",
    "Cannot reach the task VM. Check OrbStack and the enrolled host, then retry provisioning.",
    signal,
    () =>
      retryConnection(
        () =>
          checked(
            [
              "orbctl",
              "run",
              "-m",
              name,
              "-u",
              user,
              "python3",
              "-c",
              READINESS_SCRIPT,
              path,
              catalog ? "catalog" : "git",
            ],
            { signal, timeoutMs: 120_000 },
          ),
        signal,
        report,
      ),
  );
  const checks = readinessSchema.parse(JSON.parse(output));
  const connected = await startupStep(
    "host-unavailable",
    "Cannot query the enrolled host. Restore the BB connection and retry.",
    signal,
    () => retryConnection(options.hostConnected, signal, report),
  );
  checks.push({
    name: "BB host connection",
    ok: connected,
    required: true,
    category: "host-unavailable",
    detail: connected
      ? "connected to this profile"
      : "Restore this profile's enrolled daemon connection and retry.",
  });
  verifyReadiness(checks, report);
  return checks;
}

// Deliberately return paths/capabilities and availability, never token values,
// account identifiers or raw provider output.
export const READINESS_SCRIPT = String.raw`
import json, os, pathlib, shutil, subprocess, sys
home=pathlib.Path.home(); root=pathlib.Path(sys.argv[1]); checks=[]
def check(name, ok, category, detail, required=True):
    checks.append(dict(name=name,ok=bool(ok),required=required,category=category,detail=detail))
check('workspace', root.is_dir() and os.access(root,os.W_OK) and (sys.argv[2]=='catalog' and (root/'AGENTS.md').is_file() or sys.argv[2]=='git' and (root/'.git').exists()), 'unsupported-workspace', str(root)+'; requires a writable Git checkout or the 180seg catalog')
def probe(name, executable, args, expected=None, required=True):
    path=shutil.which(str(executable))
    ok=False
    if path:
        try:
            result=subprocess.run([path,*args],capture_output=True,text=True,timeout=10)
            ok=result.returncode==0 and (expected is None or expected in result.stdout+result.stderr)
        except (OSError,subprocess.TimeoutExpired): pass
    check(name,ok,'incompatible-runtime',(path or str(executable)+' missing')+('' if ok else '; reinstall the supported template tools'),required)
for name,args in [('node',['--version']),('npm',['--version']),('git',['--version']),('curl',['--version']),('python3',['--version']),('gh',['--version']),('codex',['--version'])]:
    probe(name,name,args,'codex-cli' if name=='codex' else None)
bb=home/'.bb-machines/orbisa/npm/bin/bb'
probe('BB CLI (not Babashka)',bb,['--help'],'Manage threads')
if sys.argv[2]=='catalog':
    probe('clj-eval','clj-eval',['--help'])
    probe('clj-nrepl-eval','clj-nrepl-eval',['--help'])
    probe('clj-paren-repair','clj-paren-repair',['--help'])
    probe('gh stack','gh',['stack','--help'])
token=pathlib.Path('/dev/shm/orbisa/github-token')
check('GitHub account',token.is_file() and token.stat().st_size>0,'authentication-failed','runtime token available' if token.is_file() else 'Sign in with gh on the Mac, then resume the VM')
for name,path in [('Codex',home/'.codex/auth.json'),('Cursor',pathlib.Path('/dev/shm/orbisa/cursor-api-key'))]:
    check(name+' account',path.is_file() and path.stat().st_size>0,'authentication-failed','local account material available (session validity not checked)' if path.is_file() else 'Sign in for this profile on the Mac, then resume the VM',False)
print(json.dumps(checks))
`;
