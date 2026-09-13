import type { AgentOptions, RunResult, SDKAgent, SDKAgentInfo } from "@cursor/sdk";
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { z } from "zod";
import { foreign, SdkError, type Profile } from "./operations.js";
import type { SdkModule } from "./runtime.js";

const exec = promisify(execFile);

export const cloudSourceSchema = z.object({
  repository: z
    .string()
    .url()
    .refine((value) => {
      try {
        return githubRepository(value) === value;
      } catch {
        return false;
      }
    }, "Expected a canonical GitHub repository URL"),
  ref: z.string().regex(/^[a-f0-9]{40,64}$/),
});

export type CloudSource = z.infer<typeof cloudSourceSchema>;

const recordSchema = z.object({
  threadId: z.string(),
  source: cloudSourceSchema,
  created: z.boolean(),
});

const agentIdSchema = z
  .string()
  .regex(/^bc-[a-zA-Z0-9-]+$/)
  .max(128);

export function githubRepository(value: string): string {
  const normalized = value
    .replace(/^github\.com\//, "https://github.com/")
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/^ssh:\/\/git@github\.com\//, "https://github.com/");

  const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)\/?$/.exec(normalized);

  if (!match)
    throw new SdkError({
      message: "Cursor Cloud requires an origin remote on github.com without embedded credentials.",
    });
  const repo = match[2].replace(/\.git$/, "");

  if (!repo || repo === "." || repo === ".." || match[1] === "." || match[1] === "..")
    throw new SdkError({ message: "Invalid GitHub repository." });

  return `https://github.com/${match[1]}/${repo}`;
}

const git = (cwd: string, args: string[]) =>
  Effect.tryPromise({
    try: (signal) =>
      exec("git", ["-C", cwd, ...args], {
        signal,
        timeout: 30_000,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      }).then((result) => result.stdout.trim()),
    // Git errors can contain credential-bearing remotes; keep diagnostics bounded and credential-free.
    catch: () =>
      new SdkError({
        message:
          "Could not verify the Git checkout for Cursor Cloud. Check origin access and fetch its latest branches.",
      }),
  });

export const readCloudSource = Effect.fn("CursorCloud.readSource")(function* (
  cwd: string,
  runGit: (cwd: string, args: string[]) => Effect.Effect<string, SdkError> = git,
) {
  const dirty = yield* runGit(cwd, ["status", "--porcelain", "--untracked-files=normal"]);

  if (dirty)
    return yield* Effect.fail(
      new SdkError({
        message:
          "Cursor Cloud starts from committed code. Commit or stash local changes, then push the starting commit before launching.",
      }),
    );
  const origin = yield* runGit(cwd, ["remote", "get-url", "origin"]);

  const repository = yield* Effect.try({
    try: () => githubRepository(origin),
    catch: () =>
      new SdkError({
        message: "Cursor Cloud requires a valid GitHub origin without embedded credentials.",
      }),
  });

  const ref = yield* runGit(cwd, ["rev-parse", "HEAD"]);
  const remote = yield* runGit(cwd, ["ls-remote", "--heads", "origin"]);

  const tips = [
    ...new Set(
      remote
        .split("\n")
        .map((line) => line.split(/\s+/)[0])
        .filter((sha) => /^[a-f0-9]{40,64}$/.test(sha)),
    ),
  ];

  let pushed = tips.includes(ref);

  for (const tip of tips) {
    if (pushed) break;
    pushed = yield* runGit(cwd, ["merge-base", "--is-ancestor", ref, tip]).pipe(
      Effect.map(() => true),
      Effect.catch(() => Effect.succeed(false)),
    );
  }

  if (!pushed)
    return yield* Effect.fail(
      new SdkError({
        message:
          "Cursor Cloud cannot verify HEAD on origin. Push this commit, or fetch origin if it was pushed from another checkout, then retry.",
      }),
    );

  return yield* Effect.try({
    try: () => cloudSourceSchema.parse({ repository, ref }),
    catch: () =>
      new SdkError({ message: "Cursor Cloud requires a valid repository and commit SHA." }),
  });
});

export const cloudAgentUrl = (agentId: string) =>
  `https://cursor.com/agents/${encodeURIComponent(agentIdSchema.parse(agentId))}`;

export interface CloudSession {
  agent: SDKAgent;
  source?: CloudSource;
  markCreated: () => Effect.Effect<void, SdkError>;
}

export const openCloudSession = Effect.fn("CursorCloud.openSession")(function* (args: {
  sdk: SdkModule;
  dataDir: string;
  profile: Profile;
  threadId: string;
  options: Pick<AgentOptions, "apiKey" | "model" | "mode">;
  source: () => Effect.Effect<CloudSource, SdkError>;
  providerThreadId?: string;
}): Effect.fn.Return<CloudSession, SdkError> {
  const directory = join(args.dataDir, "cloud-sessions", args.profile);
  const recordPath = (id: string) => join(directory, `${agentIdSchema.parse(id)}.json`);
  let record: z.infer<typeof recordSchema> | undefined;
  let remote: SDKAgentInfo | undefined;

  if (args.providerThreadId) {
    const id = yield* Effect.try({
      try: () => agentIdSchema.parse(args.providerThreadId),
      catch: () => new SdkError({ message: "Invalid Cursor Cloud agent ID." }),
    });

    record = yield* foreign(async () => {
      try {
        return recordSchema.parse(JSON.parse(await readFile(recordPath(id), "utf8")));
      } catch (error) {
        if (z.object({ code: z.literal("ENOENT") }).safeParse(error).success) return undefined;
        throw error;
      }
    });

    if (record && record.threadId !== args.threadId)
      return yield* Effect.fail(
        new SdkError({ message: "The saved cloud session belongs to a different BB thread." }),
      );
    remote = yield* foreign(async () => {
      try {
        return await args.sdk.Agent.get(id, { apiKey: args.options.apiKey });
      } catch (error) {
        const parsed = z
          .object({ code: z.string().optional(), status: z.number().optional() })
          .safeParse(error);

        if (
          parsed.success &&
          (parsed.data.status === 404 ||
            ["not_found", "agent_not_found"].includes(parsed.data.code ?? ""))
        )
          return undefined;
        throw error;
      }
    });

    if (!remote && (!record || record.created))
      return yield* Effect.fail(
        new SdkError({
          message:
            "This Cursor Cloud agent is no longer available. Start a new cloud thread instead of replacing its history.",
        }),
      );

    if (remote?.archived)
      return yield* Effect.fail(
        new SdkError({
          message: `This cloud agent is archived. Restore it at ${cloudAgentUrl(id)} before sending a follow-up.`,
        }),
      );

    if (remote?.status === "running")
      return yield* Effect.fail(
        new SdkError({
          message: `The cloud agent is still running. Monitor it at ${cloudAgentUrl(id)}, then retry this follow-up when it finishes.`,
        }),
      );
  }

  if (!remote && !record)
    record = { threadId: args.threadId, source: yield* args.source(), created: false };

  const agent =
    remote && args.providerThreadId
      ? yield* foreign(() => args.sdk.Agent.resume(args.providerThreadId ?? "", args.options))
      : yield* foreign(() => {
          const options: AgentOptions = {
            ...args.options,
            cloud: {
              repos: record
                ? [{ url: record.source.repository, startingRef: record.source.ref }]
                : [],
              workOnCurrentBranch: false,
              autoCreatePR: false,
              skipReviewerRequest: true,
              metadata: { bb_thread_id: args.threadId },
            },
          };

          if (args.providerThreadId) options.agentId = args.providerThreadId;

          return args.sdk.Agent.create(options);
        });

  const save = (created: boolean) =>
    foreign(async () => {
      if (!record) return;
      await mkdir(directory, { recursive: true });
      const target = recordPath(agent.agentId);
      const temporary = `${target}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify({ ...record, created }), { mode: 0o600 });
      await rename(temporary, target);
      record.created = created;
    });

  yield* save(Boolean(remote) || Boolean(record?.created)).pipe(
    Effect.onError(() =>
      foreign(() => agent[Symbol.asyncDispose]()).pipe(Effect.catch(() => Effect.void)),
    ),
  );

  return { agent, source: record?.source, markCreated: () => save(true) };
});

export function cloudRunSummary(agentId: string, source?: CloudSource, result?: RunResult): string {
  const lines = [`*Cursor Cloud:* [Open agent](${cloudAgentUrl(agentId)})`];

  if (!result && source)
    lines.push(
      `Repository base: [${source.ref.slice(0, 12)}](${source.repository}/commit/${source.ref}) in ${source.repository}. Changes run remotely on an isolated branch.`,
    );

  for (const branch of result?.git?.branches ?? []) {
    let repository: string;

    try {
      repository = githubRepository(branch.repoUrl);
    } catch {
      continue;
    }

    if (branch.branch)
      lines.push(
        `[Remote branch](${repository}/tree/${encodeURIComponent(branch.branch).replace(/[()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)})`,
      );

    if (branch.prUrl && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(branch.prUrl))
      lines.push(`[Pull request](${branch.prUrl})`);
  }

  return result && lines.length === 1 ? "" : lines.join("\n\n");
}
