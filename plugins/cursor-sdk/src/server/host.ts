import { createIsolatedBridge } from "./isolated-bridge.js";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk";
import { diagnosticsHostContract } from "../shared/diagnostics.js";
import { readDiagnostics } from "./diagnostics.js";
import { bridgeDirectoryFromRuntime } from "./runtime.js";

// The child imports this same bundled artifact, without starting another router.
export { createSdkBridge } from "./bridge.js";

export const experimental_providerBridge = createIsolatedBridge(import.meta.url);

export default experimental_defineHostEntry({
  contract: diagnosticsHostContract,
  handlers: {
    diagnostics: ({ threadId, runtimePackagePath }) =>
      readDiagnostics(bridgeDirectoryFromRuntime(runtimePackagePath), threadId),
  },
});
