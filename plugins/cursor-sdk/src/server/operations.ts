import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Effect, Schema } from "effect";
import { z } from "zod";

export class SdkError extends Schema.TaggedError<SdkError>()("SdkError", {
  message: Schema.String,
}) {}

export const foreign = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({
    try: operation,
    catch: (error) => new SdkError({ message: safeMessage(error) }),
  });

export function safeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/crsr_[\w-]+/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .slice(0, 2000);
}

export const profileSchema = z.enum(["personal", "work"]);
export type Profile = z.infer<typeof profileSchema>;
export const optionsSchema = z.object({
  profile: profileSchema,
  runtime: z.enum(["local", "cloud"]).default("local"),
});
const exec = promisify(execFile);

const command = (file: string, args: string[], cwd?: string) =>
  Effect.tryPromise({
    try: (signal) => exec(file, args, { cwd, signal, timeout: 20_000, maxBuffer: 1024 * 1024 }),
    catch: () =>
      new SdkError({
        message: "Credential lookup failed. Check this profile's Cursor API key.",
      }),
  });

// Match the existing ACP launchers. Never fall back to another profile's login.
export const readApiKey = Effect.fn("CursorSdk.readApiKey")(function* (profile: Profile) {
  const key =
    process.platform === "darwin"
      ? (yield* command("/usr/bin/security", [
          "find-generic-password",
          "-s",
          `bb.cursor.${profile}.api-key`,
          "-a",
          `lucas-${profile}`,
          "-w",
        ])).stdout.trim()
      : (yield* foreign(() =>
          readFile(join(homedir(), ".config/orbisa", `cursor-${profile}-api-key`), "utf8"),
        )).trim();
  if (!key)
    return yield* Effect.fail(
      new SdkError({ message: `The ${profile} Cursor API key is missing.` }),
    );
  return key;
});
