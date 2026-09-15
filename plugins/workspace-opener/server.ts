import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { hostContract, resolveInput, openCursorInput } from "./contract.ts";

export default function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract });
  bb.http.route("POST", "/open-cursor", async (context) => {
    const input = openCursorInput.safeParse(await context.req.json());
    if (!input.success) return context.json({ error: "Invalid Cursor target" }, 400);
    const { hostId, ...target } = input.data;
    return context.json(await host.call("openCursor", target, { hostId }));
  });
  bb.http.route("POST", "/resolve", async (context) => {
    const input = resolveInput.safeParse(await context.req.json());
    if (!input.success) return context.json({ error: "Invalid path or host" }, 400);
    const { path, hostId } = input.data;
    const workspace = await host.call(
      "resolve",
      { path },
      {
        hostId,
        signal: AbortSignal.timeout(2000),
      },
    );
    return context.json({ path: workspace });
  });
}
