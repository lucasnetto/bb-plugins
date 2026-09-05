import { experimental_defineHostEntry } from "@get-bb/plugin-sdk";
import { projectHostContract } from "./lib/project-host-contract";
import { pullCleanDefaultBranch } from "./lib/project-auto-pull";
export default experimental_defineHostEntry({
  contract: projectHostContract,
  handlers: {
    pull: ({ path }, context) => pullCleanDefaultBranch(path, context.signal),
  },
});
