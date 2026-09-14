import { z } from "zod";
import { checked } from "./task-process.ts";
import type { PersistentResource } from "./persistent-resource.ts";

export async function cleanPersistentProcesses(
  resource: PersistentResource,
  hostId: string,
  paths: string[],
  threadIds: string[],
  signal: AbortSignal,
) {
  const machines = z
    .array(z.object({ id: z.string(), name: z.string(), state: z.string() }))
    .parse(JSON.parse(await checked(["orbctl", "list", "--format", "json"], { signal })));

  if (
    !resource.vmId ||
    !machines.some(
      (vm) => vm.id === resource.vmId && vm.name === resource.name && vm.state === "running",
    )
  )
    throw new Error("Persistent VM identity or running state changed.");
  await checked(["orbctl", "run", "-m", resource.name, "python3", "-c", CLEAN_PROCESSES], {
    signal,
    timeoutMs: 15_000,
    stdin: JSON.stringify({ owner: resource.name, hostId, paths, threadIds }),
  });
}

export const CLEAN_PROCESSES = String.raw`
import json, os, pathlib, signal, time

def eligible(row, roots, threads, home):
    # BB and OrbStack infrastructure must survive even when its cwd is a workspace.
    if row['uid'] != os.getuid() or row['pid'] <= 1: return False
    infra = str(home / '.bb-machines/orbisa') + '/'
    if any(arg.startswith(infra) for arg in row['args']): return False
    if row['comm'] in {'systemd', '(sd-pam)', 'dbus-daemon', 'orbstack-agent'}: return False
    return (row['thread'] in threads or
            any(row['cwd'] == root or row['cwd'].startswith(root + '/') for root in roots))

def main():
    import sys
    payload = json.load(sys.stdin)
    home = pathlib.Path.home()
    if (home / '.config/orbisa/bb-task-owner').read_text() != payload['owner']:
        raise RuntimeError('Machine owner mismatch')
    if (home / '.bb-machines/orbisa/host-id').read_text().strip() != payload['hostId']:
        raise RuntimeError('BB host mismatch')
    roots = [str(pathlib.Path(p).resolve()) for p in payload['paths']]
    roots = [root for root in roots if root not in {'/', '/home', str(home), '/tmp', '/dev', '/proc', '/sys'}]
    protected = {os.getpid()}
    parent = os.getppid()
    while parent > 1:
        protected.add(parent)
        try: parent = int(pathlib.Path('/proc', str(parent), 'stat').read_text().rsplit(')', 1)[1].split()[1])
        except (OSError, ValueError): break
    candidates = []
    for proc in pathlib.Path('/proc').iterdir():
        if not proc.name.isdigit() or int(proc.name) in protected: continue
        fd = None
        try:
            fd = os.pidfd_open(int(proc.name))
            args = (proc / 'cmdline').read_bytes().decode(errors='replace').split('\0')
            env = (proc / 'environ').read_bytes().decode(errors='replace').split('\0')
            thread = next((v.partition('=')[2] for v in env if v.startswith('BB_THREAD_ID=')), '')
            row = dict(pid=int(proc.name), uid=proc.stat().st_uid, args=args,
                       comm=(proc / 'comm').read_text().strip(), cwd=os.readlink(proc / 'cwd'), thread=thread)
            if not eligible(row, roots, payload['threadIds'], home): continue
            # Opened before inspection: PID reuse cannot redirect these signals.
            candidates.append(fd)
            fd = None
        except (OSError, ValueError): continue
        finally:
            if fd is not None: os.close(fd)
    try:
        for fd in candidates:
            try: signal.pidfd_send_signal(fd, signal.SIGTERM)
            except ProcessLookupError: pass
        if candidates: time.sleep(2)
        for fd in candidates:
            try: signal.pidfd_send_signal(fd, signal.SIGKILL)
            except ProcessLookupError: pass
    finally:
        for fd in candidates: os.close(fd)
    print(json.dumps({'processes': len(candidates)}))

if __name__ == '__main__': main()
`;
