import { registerLinks } from "./links-server";
import { reasonSchema } from "./links-contract";
import { PLUGIN_CLI_OUTPUT_MAX_BYTES, type BbPluginApi } from "@get-bb/plugin-sdk";
import { hostContract, rpcContract } from "./contract";
export default function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    project: {
      type: "project",
      label: "Workspace project",
      description: "The project whose default source contains your repositories.",
    },
  });
  const host = bb.hosts.experimental_client({ contract: hostContract });
  async function workspace() {
    const { project } = await settings.get();
    if (!project) throw new Error("Select a Workspace project in Multirepo settings.");
    const p = await bb.sdk.projects.get({ projectId: project });
    const source = p.sources.find((s) => s.isDefault) ?? p.sources[0];
    if (!source || source.type !== "local_path")
      throw new Error("The workspace needs a local-path project source.");
    return {
      root: source.path,
      hostId: source.hostId,
      projectId: p.id,
      name: p.name,
    };
  }
  const links = registerLinks(bb);
  const handlers = {
    ...links,
    workspace,
    discover: async () => {
      const w = await workspace();
      return host.call("discover", { root: w.root }, { hostId: w.hostId });
    },
    changes: async (input: { repo: string }) => {
      const w = await workspace();
      return host.call("changes", { ...input, root: w.root }, { hostId: w.hostId });
    },
    files: async (input: { repo: string }) => {
      const w = await workspace();
      return host.call("files", { ...input, root: w.root }, { hostId: w.hostId });
    },
    detail: async (input: {
      repo: string;
      path: string;
      mode: "staged" | "worktree" | "source";
    }) => {
      const w = await workspace();
      return host.call("detail", { ...input, root: w.root }, { hostId: w.hostId });
    },
    prs: async (input: { repo: string }) => {
      const w = await workspace();
      return host.call("prs", { ...input, root: w.root }, { hostId: w.hostId });
    },
    prFiles: async (input: { repo: string; number: number }) => {
      const w = await workspace();
      return host.call("prFiles", { ...input, root: w.root }, { hostId: w.hostId });
    },
    review: async (input: { repo: string; number: number }) => {
      const w = await workspace();
      const target = await host.call(
        "reviewTarget",
        { ...input, root: w.root },
        { hostId: w.hostId },
      );
      const thread = await bb.sdk.threads.spawn({
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
      });
      return { threadId: thread.id };
    },
  };
  bb.rpc.register(rpcContract, handlers);
  bb.cli.register({
    name: "multirepo",
    summary: "Browse repositories in the configured workspace",
    commands: [
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
    async run(argv, ctx) {
      try {
        const [verb, repo, path, flag] = argv.filter((a) => a !== "--json");
        let result: unknown;
        if (["links", "link", "unlink"].includes(verb)) {
          if (!ctx.threadId) throw new Error("Run this command inside a BB thread.");
          if (verb === "links") result = await links.linkedList({ threadId: ctx.threadId });
          else if (!repo) throw new Error("A pull request URL is required.");
          else if (verb === "unlink")
            result = await links.linkedUnlink({ threadId: ctx.threadId, url: repo });
          else
            result = await links.linkedLink({
              threadId: ctx.threadId,
              url: repo,
              reason: reasonSchema.parse(path ?? "manual"),
            });
        } else if (verb === "status") result = await handlers.discover();
        else if (repo && (verb === "changes" || verb === "files" || verb === "prs"))
          result = await handlers[verb]({ repo });
        else if (verb === "diff" && repo && path)
          result = await handlers.detail({
            repo,
            path,
            mode: flag === "--staged" ? "staged" : "worktree",
          });
        else
          return {
            exitCode: verb && verb !== "--help" ? 1 : 0,
            stdout:
              "Usage: bb multirepo status | changes <repo> | files <repo> | prs <repo> | diff <repo> <path> [--staged]",
          };
        const stdout = JSON.stringify(result, null, 2);
        if (Buffer.byteLength(stdout) > PLUGIN_CLI_OUTPUT_MAX_BYTES)
          throw new Error(
            "Result exceeds bb's CLI output limit. Use the Repos panel or a narrower file query.",
          );
        return { exitCode: 0, stdout };
      } catch (error) {
        return {
          exitCode: 1,
          stderr: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });
}
