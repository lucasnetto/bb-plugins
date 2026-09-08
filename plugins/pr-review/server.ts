import { primaryHostId } from "./listing-host";
import { createListCache } from "./list-cache";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { hostContract, rpcContract, reviewOutput } from "./contract";

export default function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract });
  bb.rpc.register(rpcContract, {
    ...createListCache(bb),
    list: async (input) => {
      return host.call("list", input, { hostId: await primaryHostId(bb) });
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
