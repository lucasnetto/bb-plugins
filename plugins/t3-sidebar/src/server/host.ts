import { experimental_defineHostEntry } from "@get-bb/plugin-sdk";
import { Effect } from "effect";
import { projectHostContract } from "../shared/project-host-contract";
import { pullCleanDefaultBranch, pullGitLive } from "./lib/project-auto-pull";
export default experimental_defineHostEntry({
  contract: projectHostContract,
  handlers: {
    pull: ({ path }, context) => {
      if (context.signal.aborted) return Promise.reject(context.signal.reason);
      return Effect.runPromise(pullCleanDefaultBranch(path).pipe(Effect.provide(pullGitLive)), {
        signal: context.signal,
      });
    },
  },
});
