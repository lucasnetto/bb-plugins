import { createIsolatedBridge } from "./isolated-bridge.js";

// The child imports this same bundled artifact, without starting another router.
export { createSdkBridge } from "./bridge.js";

export const experimental_providerBridge = createIsolatedBridge(import.meta.url);
