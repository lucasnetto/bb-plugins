import { experimental_acpProviderBridge } from "@get-bb/plugin-sdk/provider-bridge/acp";
import { cursorModelListRequest } from "./cursor-model-list.ts";

export const experimental_providerBridge = {
  ...experimental_acpProviderBridge,
  handleLine(line: string) {
    experimental_acpProviderBridge.handleLine(cursorModelListRequest(line));
  },
};
