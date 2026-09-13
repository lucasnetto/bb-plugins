import { createGuideModels } from "./guide-models";
import { createGuideJobStore } from "./guide-job-store";
import { createGuideLifecycle } from "./guide-lifecycle";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { Effect } from "effect";
import type { createRuntime } from "./server-effects";
import { failedGuideJob } from "../shared/guide-generation";
import type { registerGuides } from "./guides-server";

export function registerGuideGeneration(
  bb: BbPluginApi,
  runtime: ReturnType<typeof createRuntime>,
  guides: ReturnType<typeof registerGuides>,
) {
  const models = createGuideModels(bb);
  const jobs = createGuideJobStore(bb);
  const lifecycle = createGuideLifecycle(bb, jobs, models, guides);
  const { forWorker } = jobs;
  bb.events.on("thread.idle", ({ thread, lastAssistantText }) => {
    const job = forWorker(thread.id);

    if (job) return runtime.runPromise(lifecycle.finish(job, lastAssistantText));
  });
  bb.events.on("thread.failed", ({ thread, error }) => {
    const job = forWorker(thread.id);

    if (job)
      return runtime.runPromise(lifecycle.finish(job, null, error ?? "Guide generation failed."));
  });
  bb.events.on("interaction.pending", ({ thread }) => {
    const job = forWorker(thread.id);

    if (job)
      return runtime.runPromise(
        lifecycle.finish(
          job,
          null,
          "The model requested input instead of returning a guide. Try another model.",
        ),
      );
  });
  bb.events.on("thread.deleted", ({ thread }) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const ownedJobs = yield* jobs.forThread(thread.id);

        for (const job of ownedJobs) yield* lifecycle.cancel(job);
        yield* jobs.deleteForThread(thread.id);
      }),
    ),
  );

  function recoverGuideJobs() {
    // Recover persisted work after a plugin/server restart, including missed completion events.
    for (const job of jobs.all()) {
      if (job.status === "preparing")
        jobs.write(failedGuideJob(job, "Generation was interrupted before starting. Try again."));

      if (job.status === "running")
        void runtime
          .runPromise(lifecycle.reconcile(job))
          .catch((error) => bb.log.warn(`Guide recovery: ${String(error)}`));
    }
  }

  recoverGuideJobs();

  return {
    ...models,
    guideStart: lifecycle.start,
    guideJob: lifecycle.reconcile,
    guideCancel: lifecycle.cancel,
  };
}
