import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { Effect } from "effect";
import { rpcContract, type RenameStatus } from "../shared/contract";
import { generateTitle, profileCodexHome } from "./codex";
import { readContext, titlePrompt } from "./context";
import { call, sync, createRuntime } from "./effects";

const idle: RenameStatus = { status: "idle", title: null, message: null };

export function makePlugin(generate: typeof generateTitle) {
  return function plugin(bb: BbPluginApi) {
    const runtime = createRuntime(bb);
    const jobs = new Map<string, RenameStatus>();

    const settings = bb.settings.define({
      model: {
        type: "string",
        label: "Title model",
        description: "Codex model used for isolated title generation.",
        default: "gpt-5.6-luna",
      },
    });

    const regenerate = Effect.fn("Rename.regenerate")(function* (threadId: string) {
      const before = yield* call("get thread", (signal) =>
        bb.sdk.threads.get({ threadId, signal }),
      );

      if (before.deletedAt) return;
      const context = yield* readContext(bb, threadId);

      if (!context) {
        jobs.set(threadId, {
          status: "unchanged",
          title: before.title,
          message: "No conversation text to name yet.",
        });

        return;
      }

      const codexHome = yield* sync("resolve Codex profile", () =>
        profileCodexHome(bb.server.experimental_dataDir, process.env.CODEX_HOME),
      );

      const config = yield* call("read settings", () => settings.get());
      const title = yield* generate(titlePrompt(before.title, context), config.model, codexHome);

      const latest = yield* call("recheck thread title", (signal) =>
        bb.sdk.threads.get({ threadId, signal }),
      );

      if (latest.deletedAt || latest.title !== before.title) {
        jobs.set(threadId, {
          status: "unchanged",
          title: latest.title,
          message: "The title changed during generation; kept your latest title.",
        });

        return;
      }

      if (title === latest.title) {
        jobs.set(threadId, {
          status: "unchanged",
          title,
          message: "The current title already fits.",
        });

        return;
      }

      yield* call("rename thread", () => bb.sdk.threads.update({ threadId, title }));
      jobs.set(threadId, { status: "renamed", title, message: null });
    });

    const start = (threadId: string) => {
      const existing = jobs.get(threadId);

      if (existing?.status === "running") return existing;

      // Completed status is transient UI state, bounded across long server lifetimes.
      if (jobs.size >= 500)
        for (const [id, job] of jobs) {
          if (job.status !== "running") jobs.delete(id);
        }

      const running: RenameStatus = { status: "running", title: null, message: null };
      jobs.set(threadId, running);
      runtime.runFork(
        regenerate(threadId).pipe(
          Effect.catch(() =>
            Effect.sync(() =>
              jobs.set(threadId, {
                status: "failed",
                title: null,
                message:
                  "Could not generate a title. Check this profile's Codex login and model, then retry.",
              }),
            ),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              if (jobs.get(threadId)?.status === "running")
                jobs.set(threadId, {
                  status: "failed",
                  title: null,
                  message: "Title generation was interrupted. Try again.",
                });
            }),
          ),
        ),
      );

      return running;
    };

    bb.rpc.register(rpcContract, {
      start: ({ threadId }) => start(threadId),
      status: ({ threadId }) => jobs.get(threadId) ?? idle,
    });
    bb.events.on("thread.deleted", ({ thread }) => {
      jobs.delete(thread.id);
    });
    bb.cli.register({
      name: "rename-thread",
      summary: "Regenerate a thread title with Codex",
      commands: [
        {
          name: "start",
          summary: "Start title generation",
          usage: "bb rename-thread start <thread-id>",
        },
        {
          name: "status",
          summary: "Read generation status",
          usage: "bb rename-thread status <thread-id>",
        },
      ],
      run(argv) {
        const [command, threadId] = argv;

        if (!threadId || argv.length !== 2 || (command !== "start" && command !== "status"))
          return { exitCode: 1, stderr: "Usage: bb rename-thread <start|status> <thread-id>" };

        return {
          exitCode: 0,
          stdout: JSON.stringify(
            command === "start" ? start(threadId) : (jobs.get(threadId) ?? idle),
          ),
        };
      },
    });
  };
}

export default makePlugin(generateTitle);
