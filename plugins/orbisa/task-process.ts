import { createReadStream } from "node:fs";
import { spawn } from "node:child_process";

export interface CommandOptions {
  signal?: AbortSignal;
  stdin?: string | Buffer;
  stdinFile?: string;
  timeoutMs?: number;
  onOutput?: (chunk: string) => void;
}

// Credentials travel only through stdin/in-memory output. Never include argv,
// stdout or stderr in thrown errors: commands can carry private bootstrap data.
export function command(argv: string[], options: CommandOptions = {}) {
  return new Promise<{ exitCode: number; stdout: string }>((resolve, reject) => {
    options.signal?.throwIfAborted();
    const child = spawn(argv[0]!, argv.slice(1), {
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
      env: { ...process.env, ORBENV: "" },
    });
    const input = options.stdinFile ? createReadStream(options.stdinFile) : null;
    let stdout = "";
    let failed = false;
    let failureCode = "EIO";
    const stop = () => {
      failed = true;
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          /* Already exited. */
        }
      }
    };
    const timer = setTimeout(() => {
      failureCode = "ETIMEDOUT";
      stop();
    }, options.timeoutMs ?? 120_000);
    options.signal?.addEventListener("abort", stop, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > 2 * 1024 * 1024) stop();
      options.onOutput?.(chunk.toString());
    });
    child.stderr.on("data", (chunk: Buffer) => options.onOutput?.(chunk.toString()));
    child.stdin.on("error", () => {
      /* Exit status reports closed stdin. */
    });
    child.once("error", (error: NodeJS.ErrnoException) => {
      failureCode = error.code ?? "EIO";
      failed = true;
    });
    child.once("close", (code) => {
      input?.destroy();
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", stop);
      if (options.signal?.aborted) reject(options.signal.reason);
      else if (failed)
        reject(
          Object.assign(new Error(`Orbisa command could not complete (${failureCode}).`), {
            code: failureCode,
          }),
        );
      else resolve({ exitCode: code ?? 1, stdout });
    });
    if (input) input.on("error", stop).pipe(child.stdin);
    else child.stdin.end(options.stdin ?? "");
  });
}

export async function checked(argv: string[], options: CommandOptions = {}) {
  const result = await command(argv, options);
  if (result.exitCode !== 0)
    throw new Error(
      `Orbisa ${argv[0]?.split("/").at(-1)} command failed (exit ${result.exitCode}).`,
    );
  return result.stdout;
}
