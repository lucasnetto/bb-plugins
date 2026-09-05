import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { Effect } from "effect";

export default function plugin(bb: BbPluginApi) {
  return Effect.runPromise(Effect.sync(() => bb.log.info("Cursor account labels loaded")));
}
