import { registerGuideGeneration } from "./guide-generation";
import { Effect } from "effect";
import { call, sync, createRuntime, handler, fail, decodeSchema } from "./server-effects";
import { registerLinks } from "./links-server";
import { registerGuides } from "./guides-server";
import { reasonSchema } from "../shared/links-contract";
import { PLUGIN_CLI_OUTPUT_MAX_BYTES, type BbPluginApi } from "@get-bb/plugin-sdk";
import { hostContract, rpcContract } from "../shared/contract";
export default function plugin(bb: BbPluginApi) {
  const runtime = createRuntime(bb);
  const settings = bb.settings.define({
    project: {
      type: "project",
      label: "Workspace project",
      description: "The project whose default source contains your repositories.",
    },
  });
  const host = bb.hosts.experimental_client({ contract: hostContract });
  const workspace = Effect.fn("Multirepo.workspace")(function* () {
    const { project } = yield* call("settings.get", () => settings.get());
    if (!project)
      return yield* sync("workspace", () => {
        throw new Error("Select a Workspace project in Multirepo settings.");
      });
    const p = yield* call("projects.get", () => bb.sdk.projects.get({ projectId: project }));
    const source = p.sources.find((s) => s.isDefault) ?? p.sources[0];
    if (!source || source.type !== "local_path")
      return yield* sync("workspace", () => {
        throw new Error("The workspace needs a local-path project source.");
      });
    return {
      root: source.path,
      hostId: source.hostId,
      projectId: p.id,
      name: p.name,
    };
  });
  const links = registerLinks(bb, runtime);
  const guides = registerGuides(bb, runtime, links);
  const generation = registerGuideGeneration(bb, runtime, guides);
  links.onUnlink(generation.guideCancel);
  const operations = {
    ...links,
    workspace,
    discover: () =>
      Effect.gen(function* () {
        const w = yield* workspace();
        return yield* call("host.read", (signal) =>
          host.call("discover", { root: w.root }, { hostId: w.hostId, signal }),
        );
      }),
    changes: (input: { repo: string }) =>
      Effect.gen(function* () {
        const w = yield* workspace();
        return yield* call("host.read", (signal) =>
          host.call("changes", { ...input, root: w.root }, { hostId: w.hostId, signal }),
        );
      }),
    files: (input: { repo: string }) =>
      Effect.gen(function* () {
        const w = yield* workspace();
        return yield* call("host.read", (signal) =>
          host.call("files", { ...input, root: w.root }, { hostId: w.hostId, signal }),
        );
      }),
    detail: (input: { repo: string; path: string; mode: "staged" | "worktree" | "source" }) =>
      Effect.gen(function* () {
        const w = yield* workspace();
        return yield* call("host.read", (signal) =>
          host.call("detail", { ...input, root: w.root }, { hostId: w.hostId, signal }),
        );
      }),
    prs: (input: { repo: string }) =>
      Effect.gen(function* () {
        const w = yield* workspace();
        return yield* call("host.read", (signal) =>
          host.call("prs", { ...input, root: w.root }, { hostId: w.hostId, signal }),
        );
      }),
    prFiles: (input: { repo: string; number: number }) =>
      Effect.gen(function* () {
        const w = yield* workspace();
        return yield* call("host.read", (signal) =>
          host.call("prFiles", { ...input, root: w.root }, { hostId: w.hostId, signal }),
        );
      }),
    review: (input: { repo: string; number: number }) =>
      Effect.gen(function* () {
        const w = yield* workspace();
        const target = yield* call("host.reviewTarget", (signal) =>
          host.call("reviewTarget", { ...input, root: w.root }, { hostId: w.hostId, signal }),
        );
        const thread = yield* call("threads.spawn", () =>
          bb.sdk.threads.spawn({
            projectId: w.projectId,
            environment: {
              type: "host",
              hostId: w.hostId,
              workspace: { type: "unmanaged", path: w.root },
            },
            title: `${target.remote}#${input.number}: ${target.pr.title}`,
            prompt: [
              `Review ${target.pr.url}.`,
              `The local repository is ${JSON.stringify(target.path)} inside the umbrella workspace ${JSON.stringify(w.root)}.`,
              `Read the PR using gh pr view ${input.number} -R ${target.remote} --comments and gh pr diff ${input.number} -R ${target.remote}.`,
              `The PR head is ${JSON.stringify(target.pr.headRefName)} and its base is ${JSON.stringify(target.pr.baseRefName)}. The local checkout may differ: inspect the exact PR revision, not unrelated local changes.`,
              "Review correctness, regressions, and missing tests. Return findings with file/line references. Preserve all existing work; do not switch the shared checkout, edit files, push, or post to GitHub unless the user asks.",
            ].join("\n"),
          }),
        );
        return { threadId: thread.id };
      }),
  };
  bb.rpc.register(rpcContract, {
    guideStart: handler(runtime, generation.guideStart),
    guideJob: handler(runtime, generation.guideJob),
    guideCancel: handler(runtime, generation.guideCancel),
    guideOptions: handler(runtime, generation.guideOptions),
    guideSettings: handler(runtime, generation.guideSettings),
    guideDefaultsSave: handler(runtime, generation.guideDefaultsSave),
    guideGet: handler(runtime, guides.guideGet),
    guideRequest: handler(runtime, guides.guideRequest),
    guideProgress: handler(runtime, guides.guideProgress),
    stageReviewComment: handler(runtime, operations.stageReviewComment),
    linkedContents: handler(runtime, operations.linkedContents),
    linkedList: handler(runtime, operations.linkedList),
    linkedLink: handler(runtime, operations.linkedLink),
    linkedUnlink: handler(runtime, operations.linkedUnlink),
    linkedDetail: handler(runtime, operations.linkedDetail),
    workspace: handler(runtime, operations.workspace),
    discover: handler(runtime, operations.discover),
    changes: handler(runtime, operations.changes),
    files: handler(runtime, operations.files),
    detail: handler(runtime, operations.detail),
    prs: handler(runtime, operations.prs),
    prFiles: handler(runtime, operations.prFiles),
    review: handler(runtime, operations.review),
  });
  const cli = Effect.fn("Multirepo.cli")(function* (
    argv: string[],
    ctx: { threadId?: string | null },
  ) {
    const [verb, repo, path, flag] = argv.filter((a) => a !== "--json");
    let result: unknown;
    if (verb === "guide-context" || verb === "guide-save") {
      if (!ctx.threadId || !repo)
        return yield* fail("Run inside a BB thread and provide a PR URL.");
      if (verb === "guide-context")
        return {
          exitCode: 0,
          stdout: yield* guides.guideContext({ threadId: ctx.threadId, url: repo }),
        };
      const guideJson = argv[4];
      if (!path || !flag || !guideJson)
        return yield* fail("Usage: bb multirepo guide-save <url> <base> <head> '<JSON>'");
      result = yield* guides.guideSave({
        threadId: ctx.threadId,
        url: repo,
        base: path,
        head: flag,
        guideJson,
      });
    } else if (["links", "link", "unlink"].includes(verb)) {
      if (!ctx.threadId) return yield* fail("Run this command inside a BB thread.");
      if (verb === "links") result = yield* links.linkedList({ threadId: ctx.threadId });
      else if (!repo) return yield* fail("A pull request URL is required.");
      else if (verb === "unlink")
        result = yield* links.linkedUnlink({ threadId: ctx.threadId, url: repo });
      else
        result = yield* links.linkedLink({
          threadId: ctx.threadId,
          url: repo,
          reason: yield* decodeSchema("link reason", reasonSchema, path ?? "manual"),
        });
    } else if (verb === "status") result = yield* operations.discover();
    else if (repo && (verb === "changes" || verb === "files" || verb === "prs"))
      result = yield* operations[verb]({ repo });
    else if (verb === "diff" && repo && path)
      result = yield* operations.detail({
        repo,
        path,
        mode: flag === "--staged" ? "staged" : "worktree",
      });
    else
      return {
        exitCode: verb && verb !== "--help" ? 1 : 0,
        stdout:
          "Usage: bb multirepo status | changes <repo> | files <repo> | prs <repo> | diff <repo> <path> [--staged] | links | link <url> [reason] | unlink <url> | guide-context <url> | guide-save <url> <base> <head> '<JSON>'",
      };
    const stdout = yield* sync("CLI output", () => JSON.stringify(result, null, 2));
    if (Buffer.byteLength(stdout) > PLUGIN_CLI_OUTPUT_MAX_BYTES)
      return yield* fail(
        "Result exceeds bb's CLI output limit. Use the Repos panel or a narrower file query.",
      );
    return { exitCode: 0, stdout };
  });

  bb.cli.register({
    name: "multirepo",
    summary: "Browse repositories in the configured workspace",
    commands: [
      {
        name: "guide-context",
        summary: "Get a linked PR's guided review context",
        usage: "bb multirepo guide-context <url>",
      },
      {
        name: "guide-save",
        summary: "Save a guided review",
        usage: "bb multirepo guide-save <url> <base> <head> '<JSON>'",
      },
      {
        name: "link",
        summary: "Link a PR to the current thread",
        usage: "bb multirepo link <url> <created-here|requested-review|requested-work|manual>",
      },
      {
        name: "unlink",
        summary: "Unlink a PR from the current thread",
        usage: "bb multirepo unlink <url>",
      },
      {
        name: "links",
        summary: "List the current thread’s linked PRs",
        usage: "bb multirepo links",
      },
      {
        name: "status",
        summary: "List repositories and change counts",
        usage: "bb multirepo status",
      },
      {
        name: "changes",
        summary: "List changed files",
        usage: "bb multirepo changes <repo>",
      },
      {
        name: "files",
        summary: "List repository files",
        usage: "bb multirepo files <repo>",
      },
      {
        name: "prs",
        summary: "List open pull requests",
        usage: "bb multirepo prs <repo>",
      },
      {
        name: "diff",
        summary: "Read a file diff",
        usage: "bb multirepo diff <repo> <path> [--staged]",
      },
    ],
    run: (argv, ctx) =>
      runtime.runPromise(
        cli(argv, ctx).pipe(
          Effect.catchTag("BackendError", (error) =>
            Effect.succeed({ exitCode: 1, stderr: error.message }),
          ),
        ),
      ),
  });
}
