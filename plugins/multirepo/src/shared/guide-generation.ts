import { Schema } from "effect";
import { guideTarget, guideRevision } from "./guide-contract";

export const guideModelSchema = Schema.Struct({
  providerId: Schema.String.check(Schema.isMinLength(1)),
  model: Schema.String.check(Schema.isMinLength(1)),
  reasoningLevel: Schema.Literals([
    "none",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
    "ultra",
    "ultracode",
  ]),
  serviceTier: Schema.optionalKey(Schema.Literals(["default", "fast"])),
});
export type GuideModel = Schema.Schema.Type<typeof guideModelSchema>;
const jobIdentity = { id: Schema.String, ...guideTarget.fields };
const workerId = Schema.String.check(Schema.isMinLength(1));
const runningJobFields = { ...jobIdentity, workerId, ...guideRevision.fields };
export const guideJobSchema = Schema.Union([
  Schema.Struct({ ...jobIdentity, status: Schema.Literal("preparing") }),
  Schema.Struct({ ...runningJobFields, status: Schema.Literal("running") }),
  Schema.Struct({ ...runningJobFields, status: Schema.Literal("complete") }),
  Schema.Struct({
    ...jobIdentity,
    status: Schema.Literal("error"),
    workerId: Schema.NullOr(workerId),
    revision: Schema.NullOr(guideRevision),
    error: Schema.String.check(Schema.isMinLength(1)),
  }),
  Schema.Struct({
    ...jobIdentity,
    status: Schema.Literal("cancelled"),
    workerId: Schema.NullOr(workerId),
    revision: Schema.NullOr(guideRevision),
  }),
]);
export type GuideJob = Schema.Schema.Type<typeof guideJobSchema>;
export type RunningGuideJob = Extract<GuideJob, { status: "running" }>;
export type ActiveGuideJob = Extract<GuideJob, { status: "preparing" | "running" }>;
export const isActiveGuideJob = (job: GuideJob | null): job is ActiveGuideJob =>
  job?.status === "preparing" || job?.status === "running";
export const guideWorkerId = (job: GuideJob) => (job.status === "preparing" ? null : job.workerId);
const jobRevision = (job: GuideJob) => {
  switch (job.status) {
    case "preparing":
      return null;
    case "running":
    case "complete":
      return { base: job.base, head: job.head };
    case "error":
    case "cancelled":
      return job.revision;
  }
};
export const cancelledGuideJob = (job: GuideJob): Extract<GuideJob, { status: "cancelled" }> => ({
  id: job.id,
  threadId: job.threadId,
  url: job.url,
  status: "cancelled",
  workerId: guideWorkerId(job),
  revision: jobRevision(job),
});
export const failedGuideJob = (
  job: GuideJob,
  error: string,
): Extract<GuideJob, { status: "error" }> => ({
  id: job.id,
  threadId: job.threadId,
  url: job.url,
  status: "error",
  workerId: guideWorkerId(job),
  revision: jobRevision(job),
  error: error || "Guide generation failed.",
});
export const guideStartInput = guideTarget.pipe(Schema.fieldsAssign({ model: guideModelSchema }));
export const guideDefaultsInput = Schema.Struct({ projectId: Schema.NullOr(Schema.String) });
export const guideDefaultsSaveInput = guideDefaultsInput.pipe(
  Schema.fieldsAssign({
    model: Schema.NullOr(guideModelSchema),
  }),
);
export const guideOptionsSchema = Schema.Struct({
  projectId: Schema.String,
  environmentId: Schema.String,
  model: Schema.NullOr(guideModelSchema),
  source: Schema.Literals(["project", "plugin", "thread"]),
});
export const guideSettingsSchema = Schema.Struct({
  model: Schema.NullOr(guideModelSchema),
  fallback: Schema.NullOr(guideModelSchema),
  projects: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
});
