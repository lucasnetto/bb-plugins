import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join, normalize } from "node:path";
import { Effect } from "effect";
import { z } from "zod";
import type { ModelSelection } from "../shared/contract";
import { call, sync } from "./effects";

const resultSchema = z.object({ title: z.string().min(1).max(500) }).strict();

export function normalizeTitle(raw: string): string {
  const title = raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (
    !title ||
    title.toLowerCase() === "new thread" ||
    title.length > 80 ||
    title.split(" ").length > 12
  )
    throw new Error("The helper returned an invalid title. Try again.");

  return title;
}

export function profileCodexHome(dataDir: string, inherited: string | undefined): string {
  // Both local profiles run under the same OS user; never let Work fall back to Personal auth.
  const profile = basename(normalize(dataDir));

  if (profile === ".bb-work") return join(homedir(), ".codex_work");

  if (profile === ".bb") return join(homedir(), ".codex");

  if (inherited) return inherited;
  throw new Error("Set CODEX_HOME for this BB server before generating titles.");
}

export const generateTitle = Effect.fn("Rename.generateTitle")(function* (
  prompt: string,
  selection: ModelSelection,
  codexHome: string,
) {
  return yield* Effect.acquireUseRelease(
    call("temporary directory", () => mkdtemp(join(tmpdir(), "bb-rename-"))),
    (directory) =>
      Effect.gen(function* () {
        const schemaPath = join(directory, "schema.json");
        const outputPath = join(directory, "title.json");
        yield* call("output schema", () =>
          writeFile(
            schemaPath,
            JSON.stringify({
              type: "object",
              properties: { title: { type: "string" } },
              required: ["title"],
              additionalProperties: false,
            }),
            { mode: 0o600 },
          ),
        );
        yield* call(
          "Codex title generation",
          (signal) =>
            new Promise<void>((resolve, reject) => {
              const child = execFile(
                "codex",
                [
                  "exec",
                  "--ephemeral",
                  "--skip-git-repo-check",
                  "--sandbox",
                  "read-only",
                  "--model",
                  selection.model,
                  "-c",
                  `model_reasoning_effort="${selection.reasoningLevel}"`,
                  ...(selection.serviceTier === "fast" ? ["-c", 'service_tier="fast"'] : []),
                  "--output-schema",
                  schemaPath,
                  "--output-last-message",
                  outputPath,
                  "-",
                ],
                {
                  cwd: directory,
                  env: { ...process.env, CODEX_HOME: codexHome },
                  signal,
                  timeout: 60000,
                  killSignal: "SIGKILL",
                  maxBuffer: 1024 * 1024,
                },
                (error) => {
                  // CLI output can echo conversation/authentication data; do not relay it to logs or UI.
                  if (error)
                    reject(
                      new Error(
                        "Codex title generation failed. Check this profile's Codex login and model, then retry.",
                      ),
                    );
                  else resolve();
                },
              );

              child.stdin?.on("error", () => {});
              child.stdin?.end(prompt);
            }),
        );
        const output = yield* call("read title", () => readFile(outputPath, "utf8"));

        return yield* sync("validate title", () =>
          normalizeTitle(resultSchema.parse(JSON.parse(output)).title),
        );
      }),
    (directory) =>
      call("remove temporary files", () => rm(directory, { recursive: true, force: true })).pipe(
        Effect.orDie,
      ),
  );
});
