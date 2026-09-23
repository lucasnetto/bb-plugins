import { experimental_defineHostEntry } from "@get-bb/plugin-sdk";
import { spawn } from "node:child_process";
import { incusHostContract } from "./incus-contract.ts";

export default experimental_defineHostEntry({
  contract: incusHostContract,
  handlers: {
    run: async (input, context) => {
      if (process.platform !== "linux")
        throw new Error("Orbisa Incus requires a Linux runtime host.");
      const args: string[] = [input.action];
      if (input.action !== "version") {
        args.push("--owner", input.owner, "--key", input.key, "--timeout", `${input.timeoutMs}ms`);
        if (input.id) args.push("--id", input.id);
        if (input.action === "create") args.push("--image", input.image);
        if (input.action === "exec") args.push("--raw", "--", ...input.command);
      }
      const signal = AbortSignal.any([
        context.signal,
        context.lifecycle.signal,
        AbortSignal.timeout(input.timeoutMs),
      ]);
      return await new Promise<{ exitCode: number; stdout: string; stderr: string }>(
        (resolve, reject) => {
          const child = spawn("orbisa", args, { signal, stdio: ["pipe", "pipe", "pipe"] });
          let stdout = "",
            stderr = "",
            bytes = 0;
          let failure: Error | undefined;
          const collect = (stream: "stdout" | "stderr", chunk: string) => {
            bytes += Buffer.byteLength(chunk);
            if (bytes > 4 * 1024 * 1024) {
              failure = new Error("Orbisa output exceeded 4 MiB.");
              child.kill("SIGTERM");
              return;
            }
            if (stream === "stdout") stdout += chunk;
            else stderr += chunk;
          };
          child.stdout.setEncoding("utf8").on("data", (b: string) => collect("stdout", b));
          child.stderr.setEncoding("utf8").on("data", (b: string) => collect("stderr", b));
          child.on("error", reject);
          child.stdin.on("error", (error: NodeJS.ErrnoException) => {
            if (error.code !== "EPIPE") reject(error);
          });
          child.on("close", (code) =>
            failure ? reject(failure) : resolve({ exitCode: code ?? 125, stdout, stderr }),
          );
          // The enrollment payload is private stdin; never log or persist it.
          child.stdin.end(input.stdin);
        },
      );
    },
  },
});
