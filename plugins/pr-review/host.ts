import { homedir } from "node:os";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk";
import { hostContract } from "./contract";
import { ghClient, listPullRequests } from "./github";

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    list: (input, ctx) => listPullRequests(ghClient(homedir(), ctx.signal), input),
  },
});
