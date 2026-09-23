import { localHostContract } from "./src/local-changes/contract";
import { localSnapshot, localDiff, localCheckoutDiff } from "./src/local-changes/git";
import { homedir } from "node:os";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk";
import { hostContract as listingContract } from "./contract";
import reviewHost from "./src/server/host";
import { ghClient, listPullRequests } from "./github";

export default experimental_defineHostEntry({
  contract: { ...listingContract, ...reviewHost.contract, ...localHostContract },
  handlers: {
    ...reviewHost.handlers,
    localCheckoutDiff: ({ root, checkout }, ctx) => localCheckoutDiff(root, checkout, ctx.signal),
    localSnapshot: ({ root }, ctx) => localSnapshot(root, ctx.signal),
    localDiff: ({ root, ...target }, ctx) => localDiff(root, target, ctx.signal),
    list: (input, ctx) => listPullRequests(ghClient(homedir(), ctx.signal), input),
  },
});
