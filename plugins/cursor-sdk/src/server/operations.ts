import type { ProviderErrorInfo, ProviderRecoveryHint } from "@get-bb/plugin-sdk/provider-bridge";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Effect, Schema } from "effect";
import { z } from "zod";

export class SdkError extends Schema.TaggedError<SdkError>()("SdkError", {
  message: Schema.String,
  code: Schema.optional(Schema.String),
  status: Schema.optional(Schema.Number),
  isRetryable: Schema.optional(Schema.Boolean),
  requestId: Schema.optional(Schema.String),
}) {}

export const foreign = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({
    try: operation,
    catch: sdkError,
  });

const errorMessageSchema = z.unknown().transform((error) =>
  (error instanceof Error ? error.message : String(error))
    .replace(/crsr_[\w-]+/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .slice(0, 2000),
);

export const safeMessage = errorMessageSchema.parse.bind(errorMessageSchema);

const sdkErrorMetadata = z.object({
  message: z.string().optional().catch(undefined),
  code: z.string().optional().catch(undefined),
  status: z.number().int().optional().catch(undefined),
  isRetryable: z.boolean().optional().catch(undefined),
  requestId: z.string().optional().catch(undefined),
});

const sdkErrorSchema = z.unknown().transform((error) => {
  const metadata = sdkErrorMetadata.safeParse(error);
  const fields = metadata.success ? metadata.data : undefined;

  return new SdkError({
    message: safeMessage(fields?.message ?? error),
    code: fields?.code === undefined ? undefined : safeMessage(fields.code),
    status: fields?.status,
    isRetryable: fields?.isRetryable,
    requestId: fields?.requestId === undefined ? undefined : safeMessage(fields.requestId),
  });
});

export const sdkError = sdkErrorSchema.parse.bind(sdkErrorSchema);

export function sdkErrorInfo(error: SdkError): ProviderErrorInfo {
  let category: ProviderErrorInfo["category"] = "unknown";

  switch (error.status) {
    case 400:
      category = "bad-request";
      break;
    case 401:
      category = "unauthorized";
      break;
    case 403:
      category = "policy";
      break;
    case 429:
      category = "rate-limit";
      break;
    case 502:
    case 503:
    case 504:
      category = "connection-failed";
      break;
    default:
      if (error.status !== undefined && error.status >= 500) category = "internal";
  }

  return { category, httpStatusCode: error.status ?? null, providerCode: error.code ?? null };
}

export function sdkRecovery(error: SdkError): ProviderRecoveryHint | undefined {
  const category = sdkErrorInfo(error).category;

  if (category === "unauthorized")
    return { kind: "authRequired", message: error.message, retryable: false };

  if (category === "rate-limit")
    return { kind: "rateLimited", message: error.message, retryable: false };

  return undefined;
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
