import { homedir } from "node:os";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk";
import { hostContract } from "../shared/contract";
import { linkedContents, linkedSummary, linkedDetail } from "./links-host";
import { runHost } from "./host-effects";
export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    linkedContents: ({ root, ...input }, ctx) =>
      runHost(linkedContents(root ?? homedir(), input), ctx.signal),
    linkedSummary: ({ root, url }, ctx) =>
      runHost(linkedSummary(root ?? homedir(), url), ctx.signal),
    linkedDetail: ({ root, url }, ctx) => runHost(linkedDetail(root ?? homedir(), url), ctx.signal),
  },
});
