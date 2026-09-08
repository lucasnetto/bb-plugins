import type { BbPluginApi } from "@get-bb/plugin-sdk";

export async function primaryHostId(bb: BbPluginApi): Promise<string> {
  const { primaryHostId } = await bb.sdk.system.config();
  if (!primaryHostId) throw new Error("Connect a primary machine to BB to load pull requests.");
  return primaryHostId;
}
