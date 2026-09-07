import { createGuideModels } from "./guide-models";
import { createGuideJobStore } from "./guide-job-store";
import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { Effect } from "effect";
import { call, sync, fail, type createRuntime } from "./server-effects";
import {
  isActiveGuideJob,
  guideWorkerId,
  cancelledGuideJob,
  failedGuideJob,
  type RunningGuideJob,
  type GuideJob,
  type GuideModel,
} from "../shared/guide-generation";
import {
  buildGuideWorkerPrompt,
  decodeGuideContext,
  guideJsonFromWorkerOutput,
} from "./guide-worker-prompt";
import type { registerGuides } from "./guides-server";

type Target = { threadId: string; url: string };

export function registerGuideGeneration(
  bb: BbPluginApi,
  runtime: ReturnType<typeof createRuntime>,
  guides: ReturnType<typeof registerGuides>,
) {
  const models = createGuideModels(bb);
  const { guideOptions } = models;
  const jobs = createGuideJobStore(bb);
  const { read, write, isCurrentActiveJob } = jobs;
  const archiveAndStopWorker = Effect.fn("Guide.cleanup")(function* (workerId: string | null) {
    if (!workerId) return;
    // Archive does not terminate hidden agents.
    yield* call("archive guide worker", () => bb.sdk.threads.archive({ threadId: workerId })).pipe(
      Effect.ensuring(
        call("stop guide worker", () => bb.sdk.threads.stop({ threadId: workerId })).pipe(
          Effect.orDie,
        ),
      ),
    );
  });
  const finishingJobIds = new Set<string>();
  const finishGuideJob = Effect.fn("Guide.finish")(function* (
    job: RunningGuideJob,
    output: string | null,
    error?: string,
  ) {
    // Completion can arrive from polling and events; only one save may own this job.
    if (finishingJobIds.has(job.id) || !isCurrentActiveJob(job)) return;
    finishingJobIds.add(job.id);
    yield* Effect.gen(function* () {
      if (error) return yield* fail(error);
      yield* guides.guideSave({
        ...job,
        guideJson: guideJsonFromWorkerOutput(output),
        isCurrent: () => isCurrentActiveJob(job),
      });
      yield* sync("guide complete", () => {
        if (isCurrentActiveJob(job)) write({ ...job, status: "complete" });
      });
    }).pipe(
      Effect.catchTag("BackendError", (error) =>
        sync("guide failed", () => {
          if (isCurrentActiveJob(job)) write(failedGuideJob(job, error.message));
        }),
      ),
      Effect.ensuring(archiveAndStopWorker(job.workerId).pipe(Effect.orDie)),
      Effect.ensuring(Effect.sync(() => finishingJobIds.delete(job.id))),
    );
  });
  const reconcileGuideJob = Effect.fn("Guide.job")(function* (input: Target) {
    const job = yield* sync("guide job", () => read(input));
    if (job?.status === "running") {
      const worker = yield* call("guide worker", () =>
        bb.sdk.threads.get({ threadId: job.workerId }),
      );
      if (worker.status === "idle") {
        const { output } = yield* call("guide output", () =>
          bb.sdk.threads.output({ threadId: worker.id }),
        );
        yield* finishGuideJob(job, output);
      } else if (worker.status === "error" || worker.archivedAt || worker.deletedAt) {
        yield* finishGuideJob(
          job,
          null,
          "Guide generation stopped or failed. Try again with another model.",
        );
      }
    }
    return yield* sync("guide job", () => read(input));
  });
  const cancelGuideJob = Effect.fn("Guide.cancel")(function* (input: Target) {
    const job = yield* sync("cancel guide", () => {
      const job = read(input);
      if (job && isActiveGuideJob(job)) write(cancelledGuideJob(job));
      return job;
    });
    if (job) yield* archiveAndStopWorker(guideWorkerId(job));
    return null;
  });
  const spawnAndRecordGuideWorker = Effect.fnUntraced(function* (
    job: Extract<GuideJob, { status: "preparing" }>,
    input: {
      projectId: string;
      environmentId: string;
      model: GuideModel;
      prompt: string;
      base: string;
      head: string;
    },
  ) {
    // Once spawning begins, interruption must not strand an unrecorded worker.
    // Cancellation during spawn still archives/stops it before this block returns.
    const worker = yield* call("spawn guide", () =>
      bb.sdk.threads.spawn({
        projectId: input.projectId,
        environment: { type: "reuse", environmentId: input.environmentId },
        ...input.model,
        visibility: "hidden",
        title: "Generate PR guide",
        prompt: input.prompt,
      }),
    );
    if (!isCurrentActiveJob(job)) {
      yield* archiveAndStopWorker(worker.id);
      return cancelledGuideJob(job);
    }
    return yield* sync("guide worker save", () =>
      write({
        ...job,
        base: input.base,
        head: input.head,
        workerId: worker.id,
        status: "running",
      }),
    );
  }, Effect.uninterruptible);
  const startGuideJob = Effect.fn("Guide.start")(function* (input: Target & { model: GuideModel }) {
    const job = yield* sync("start guide", () => {
      if (isActiveGuideJob(read(input)))
        throw new Error("A guide is already being generated for this PR.");
      return write({
        threadId: input.threadId,
        url: input.url,
        id: randomUUID(),
        status: "preparing",
      });
    });
    return yield* Effect.gen(function* () {
      const options = yield* guideOptions(input);
      const context = yield* guides.guideContext(input);
      const parsed = yield* decodeGuideContext(context);
      if (!isCurrentActiveJob(job)) return cancelledGuideJob(job);
      const prompt = buildGuideWorkerPrompt(parsed);
      return yield* spawnAndRecordGuideWorker(job, {
        projectId: options.projectId,
        environmentId: options.environmentId,
        model: input.model,
        prompt,
        base: parsed.base,
        head: parsed.head,
      });
    }).pipe(
      Effect.catchTag("BackendError", (error) =>
        sync("guide start failed", () => {
          if (!isCurrentActiveJob(job)) return cancelledGuideJob(job);
          return write(failedGuideJob(job, error.message));
        }),
      ),
    );
  });
  const { forWorker } = jobs;
  bb.events.on("thread.idle", ({ thread, lastAssistantText }) => {
    const job = forWorker(thread.id);
    if (job) return runtime.runPromise(finishGuideJob(job, lastAssistantText));
  });
  bb.events.on("thread.failed", ({ thread, error }) => {
    const job = forWorker(thread.id);
    if (job)
      return runtime.runPromise(finishGuideJob(job, null, error ?? "Guide generation failed."));
  });
  bb.events.on("interaction.pending", ({ thread }) => {
    const job = forWorker(thread.id);
    if (job)
      return runtime.runPromise(
        finishGuideJob(
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
        for (const job of ownedJobs) yield* cancelGuideJob(job);
        yield* jobs.deleteForThread(thread.id);
      }),
    ),
  );
  function recoverGuideJobs() {
    // Recover persisted work after a plugin/server restart, including missed completion events.
    for (const job of jobs.all()) {
      if (job.status === "preparing")
        write(failedGuideJob(job, "Generation was interrupted before starting. Try again."));
      if (job.status === "running")
        void runtime
          .runPromise(reconcileGuideJob(job))
          .catch((error) => bb.log.warn(`Guide recovery: ${String(error)}`));
    }
  }
  recoverGuideJobs();
  return {
    ...models,
    guideStart: startGuideJob,
    guideJob: reconcileGuideJob,
    guideCancel: cancelGuideJob,
  };
}
