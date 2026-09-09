import { githubReview, githubReviewMutate } from "./github-review-host";
import { homedir } from "node:os";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk";
import { hostContract } from "../shared/contract";
import { linkedContents, linkedSummary, linkedDetail } from "./links-host";
import { runHost } from "./host-effects";
export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    githubReview: ({ root, url }, ctx) => runHost(githubReview(root ?? homedir(), url), ctx.signal),
    githubReviewMutate: ({ root, url, action }, ctx) =>
      runHost(githubReviewMutate(root ?? homedir(), url, action), ctx.signal),
    linkedContents: ({ root, ...input }, ctx) =>
      runHost(linkedContents(root ?? homedir(), input), ctx.signal),
    linkedSummary: ({ root, url }, ctx) =>
      runHost(linkedSummary(root ?? homedir(), url), ctx.signal),
    linkedDetail: ({ root, url }, ctx) => runHost(linkedDetail(root ?? homedir(), url), ctx.signal),
  },
});
