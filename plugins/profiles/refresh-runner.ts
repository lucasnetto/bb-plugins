import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { maintenanceRequest } from "./refresh-contract.ts";
import type { z } from "zod";

export function runRefresh(
  script: string,
  args: string[],
  settings: Readonly<Record<string, string>>,
  hosts: Record<string, string>,
  dispatch: (request: z.infer<typeof maintenanceRequest>) => Promise<string>,
) {
  return new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve) => {
    const child = spawn("python3", [script, ...args], {
      env: {
        ...process.env,
        BB_PROFILES_CONFIG: JSON.stringify(settings),
        BB_PROFILES_HOSTS: JSON.stringify(hosts),
        BB_PROFILES_HOST_TRANSPORT: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let result = "",
      errors = "",
      failed = false;

    const timer = setTimeout(() => {
      failed = true;
      child.kill();
    }, 3_600_000);

    const lines = createInterface({ input: child.stdout });
    child.stderr.on("data", (data) => {
      if (errors.length < 8192) errors += String(data).slice(0, 8192 - errors.length);
    });
    child.stdin.on("error", () => {});
    lines.on("line", (line) => {
      void (async () => {
        try {
          const message = JSON.parse(line);

          if (message.result) {
            result = JSON.stringify(message.result, null, 2);

            return;
          }

          const request = maintenanceRequest.parse(message.request);
          let reply;

          try {
            reply = { value: await dispatch(request) };
          } catch {
            reply = {
              error: `Profile ${request.profile}: ${request.action} failed on its configured machine; check connection, CLI path, data directory and plugin logs.`,
            };
          }

          if (!child.stdin.destroyed) child.stdin.write(JSON.stringify(reply) + "\n");
        } catch {
          failed = true;
          child.kill();
        }
      })();
    });
    child.on("error", () => {
      failed = true;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      lines.close();
      resolve({
        exitCode: failed || !result ? 1 : (code ?? 1),
        stdout: result,
        stderr: failed ? "Profile maintenance transport failed." : errors,
      });
    });
  });
}
