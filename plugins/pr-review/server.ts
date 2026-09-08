import registerReview from "./src/server/server";
import { migrateLegacyReview } from "./src/server/legacy-migration";
import { primaryHostId } from "./listing-host";
import { createListCache } from "./list-cache";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { hostContract, rpcContract } from "./contract";

export default async function plugin(bb: BbPluginApi) {
  await migrateLegacyReview(bb);
  registerReview(bb);
  const host = bb.hosts.experimental_client({ contract: hostContract });
  bb.rpc.register(rpcContract, {
    ...createListCache(bb),
    list: async (input) => {
      return host.call("list", input, { hostId: await primaryHostId(bb) });
    },
  });
}
