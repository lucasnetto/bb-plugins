import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { NewThreadRequest } from "@get-bb/plugin-sdk/app";
import { Effect } from "effect";
import { call, createRuntime, handler } from "./server-effects";

export function createProjectThreadHandlers(bb: BbPluginApi) {
  const runtime = createRuntime(bb);

  const create = Effect.fn("ProjectThread.create")(function* ({
    request,
  }: {
    request: NewThreadRequest;
  }) {
    const thread = yield* call("threads.spawn", () => bb.sdk.threads.spawn(request));

    return { id: thread.id };
  });

  return { project_thread_create: handler(runtime, create) };
}
