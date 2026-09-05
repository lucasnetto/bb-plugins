import { experimental_defineHostEntry } from "@get-bb/plugin-sdk";
import { hostContract } from "./contract";
import { linkedContents, linkedSummary, linkedDetail } from "./links-host";
import * as git from "./git";
export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    linkedContents: ({root,...input},ctx) => linkedContents(root,input,ctx.signal),
    linkedSummary: ({ root, url }, ctx) => linkedSummary(root, url, ctx.signal),
    linkedDetail: ({ root, url }, ctx) => linkedDetail(root, url, ctx.signal),
    discover: ({ root }, ctx) => git.discover(root, ctx.signal),
    changes: async ({ root, repo }, ctx) =>
      git.changes(await git.repository(root, repo), ctx.signal),
    files: async ({ root, repo }, ctx) =>
      git.files(await git.repository(root, repo), ctx.signal),
    detail: async ({ root, repo, path, mode }, ctx) =>
      git.detail(await git.repository(root, repo), path, mode, ctx.signal),
    prs: async ({ root, repo }, ctx) =>
      git.prs(await git.repository(root, repo), ctx.signal),
    prFiles: async ({ root, repo, number }, ctx) =>
      git.prFiles(await git.repository(root, repo), number, ctx.signal),
    reviewTarget: async ({ root, repo, number }, ctx) =>
      git.reviewTarget(await git.repository(root, repo), number, ctx.signal),
  },
});
