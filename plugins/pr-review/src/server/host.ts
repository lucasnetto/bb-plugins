import { editorTarget } from "./editor-target";
import { githubReview, githubReviewMutate } from "./github-review-host";
import { homedir } from "node:os";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk";
import { hostContract } from "../shared/contract";
import { linkedContents, linkedSummary, linkedDetail } from "./links-host";
import { runHost } from "./host-effects";
import { workspaceHostContract } from "../shared/workspace-contract";
import { prOverview, prTimeline, prStack, prCandidates } from "./workspace-github";
import { prAction, prMergeStatus } from "./workspace-actions";

export default experimental_defineHostEntry({
  contract: { ...hostContract, ...workspaceHostContract },
  handlers: {
    prEditorTarget: ({ roots, repository, branch }, ctx) =>
      runHost(editorTarget(roots, repository, branch), ctx.signal),
    prOverview: ({ root, url }, ctx) => runHost(prOverview(root ?? homedir(), url), ctx.signal),
    prTimeline: ({ root, url, page }, ctx) =>
      runHost(prTimeline(root ?? homedir(), url, page), ctx.signal),
    prStack: ({ root, url }, ctx) => runHost(prStack(root ?? homedir(), url), ctx.signal),
    prCandidates: ({ root, url }, ctx) => runHost(prCandidates(root ?? homedir(), url), ctx.signal),
    prAction: ({ root, url, head, base, action }, ctx) =>
      runHost(prAction(root ?? homedir(), url, head, base, action), ctx.signal),
    prMergeStatus: ({ root, url, id }, ctx) =>
      runHost(prMergeStatus(root ?? homedir(), url, id), ctx.signal),
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
