import { createListCache } from "./list-cache";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { hostContract, rpcContract, reviewOutput, workspaceSchema } from "./contract";

export default function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract });
  bb.rpc.register(rpcContract, {
    ...createListCache(bb),
    list: async (input) => {
      const workspace = await bb.sdk.plugins.callRpc({
        pluginId: "multirepo",
        method: "workspace",
        input: null,
        outputSchema: workspaceSchema,
      });
      return host.call("list", { ...input, root: workspace.root }, { hostId: workspace.hostId });
    },
    review: (input) =>
      bb.sdk.plugins.callRpc({
        pluginId: "multirepo",
        method: "reviewUrl",
        input,
        outputSchema: reviewOutput,
      }),
  });
}
