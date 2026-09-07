import { createReviewThread } from "./review-thread";
import { registerGuideGeneration } from "./guide-generation";
import { Effect } from "effect";
import { call, sync, createRuntime, handler } from "./server-effects";
import { registerLinks } from "./links-server";
import { registerGuides } from "./guides-server";
import { registerMultirepoCli } from "./cli";
import { type BbPluginApi } from "@get-bb/plugin-sdk";
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
    reviewUrl: createReviewThread(bb, workspace, links),
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
    reviewUrl: handler(runtime, operations.reviewUrl),
  });
  registerMultirepoCli(bb, runtime, operations, links, guides);
}
