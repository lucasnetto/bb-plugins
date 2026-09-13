import { githubReviewHandlers } from "./github-review-server";
import { registerWorkspace } from "./workspace-server";
import { reviewDraftHandlers } from "./standalone-review";
import { registerGuideGeneration } from "./guide-generation";
import { createRuntime, handler } from "./server-effects";
import { registerLinks } from "./links-server";
import { registerGuides } from "./guides-server";
import { registerPrReviewCli } from "./cli";
import { type BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcContract } from "../shared/contract";

export default function plugin(bb: BbPluginApi) {
  const runtime = createRuntime(bb);
  const links = registerLinks(bb, runtime);
  registerWorkspace(bb, runtime, links);
  const guides = registerGuides(bb, runtime, links);
  const generation = registerGuideGeneration(bb, runtime, guides);
  links.onUnlink(generation.guideCancel);
  const github = githubReviewHandlers(bb, links);

  const operations = {
    ...links,
    ...reviewDraftHandlers(bb),
  };

  bb.rpc.register(rpcContract, {
    githubReview: handler(runtime, github.githubReview),
    githubReviewMutate: handler(runtime, github.githubReviewMutate),
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
    reviewDraftDetail: handler(runtime, operations.reviewDraftDetail),
    reviewDraftContents: handler(runtime, operations.reviewDraftContents),
  });
  registerPrReviewCli(bb, runtime, links, guides);
}
