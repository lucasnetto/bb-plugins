import { experimental_defineHostEntry } from "@get-bb/plugin-sdk";
import { hostContract } from "./contract.ts";
import { resolveWorkspace } from "./resolve.ts";
import { openCursor } from "./cursor.ts";

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: { resolve: ({ path }) => resolveWorkspace(path), openCursor },
});
