import { experimental_defineHostEntry } from "@get-bb/plugin-sdk";
import { hostContract } from "../shared/contract";
import { linkedContents, linkedSummary, linkedDetail } from "./links-host";
import * as git from "./git";
import { Effect } from "effect";
import { runHost } from "./host-effects";
export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    linkedContents: ({ root, ...input }, ctx) => runHost(linkedContents(root, input), ctx.signal),
    linkedSummary: ({ root, url }, ctx) => runHost(linkedSummary(root, url), ctx.signal),
    linkedDetail: ({ root, url }, ctx) => runHost(linkedDetail(root, url), ctx.signal),
    discover: ({ root }, ctx) => runHost(git.discover(root), ctx.signal),
    changes: ({ root, repo }, ctx) =>
      runHost(git.repository(root, repo).pipe(Effect.flatMap(git.changes)), ctx.signal),
    files: ({ root, repo }, ctx) =>
      runHost(git.repository(root, repo).pipe(Effect.flatMap(git.files)), ctx.signal),
    detail: ({ root, repo, path, mode }, ctx) =>
      runHost(
        git
          .repository(root, repo)
          .pipe(Effect.flatMap((repoPath) => git.detail(repoPath, path, mode))),
        ctx.signal,
      ),
  },
});
