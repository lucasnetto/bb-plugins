import { homedir } from "node:os";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk";
import { hostContract as listingContract } from "./contract";
import reviewHost from "./src/server/host";
import { ghClient, listPullRequests } from "./github";

export default experimental_defineHostEntry({
  contract: { ...listingContract, ...reviewHost.contract },
  handlers: {
    ...reviewHost.handlers,
    list: (input, ctx) => listPullRequests(ghClient(homedir(), ctx.signal), input),
  },
});
