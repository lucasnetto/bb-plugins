import { experimental_acpProviderBridge } from "@get-bb/plugin-sdk/provider-bridge/acp";
import { cursorModelListRequest } from "./cursor-model-list.ts";

export const experimental_providerBridge = {
  ...experimental_acpProviderBridge,
  handleLine(line: string) {
    experimental_acpProviderBridge.handleLine(cursorModelListRequest(line));
  },
};

import { experimental_defineHostEntry } from "@get-bb/plugin-sdk";
import { maintenanceContract } from "./refresh-contract.ts";
import { maintain } from "./refresh-host.ts";

export default experimental_defineHostEntry({
  contract: maintenanceContract,
  handlers: { maintain },
});
