import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { Schema } from "effect";
import { sync } from "./server-effects";
import { GUIDE_CHANGED } from "../shared/guide-contract";
import { guideJobSchema, isActiveGuideJob, type GuideJob } from "../shared/guide-generation";

type Target = { threadId: string; url: string };
const rowSchema = Schema.Struct({ data: Schema.fromJsonString(guideJobSchema) });

/** Synchronous reads and writes keep each current-job check adjacent to its mutation.
 * Callers wrap these critical sections in sync; startup may call them directly.
 */
export function createGuideJobStore(bb: BbPluginApi) {
  const db = bb.storage.database();
  const read = (input: Target): GuideJob | null => {
    const row = db
      .prepare("SELECT data FROM review_guide_jobs WHERE thread_id = ? AND url = ?")
      .get(input.threadId, input.url);
    return row ? Schema.decodeUnknownSync(rowSchema)(row).data : null;
  };
  const write = <J extends GuideJob>(job: J): J => {
    db.prepare(
      "INSERT INTO review_guide_jobs (thread_id, url, data) VALUES (?, ?, ?) ON CONFLICT(thread_id, url) DO UPDATE SET data = excluded.data",
    ).run(job.threadId, job.url, JSON.stringify(job));
    bb.realtime.publish(GUIDE_CHANGED, { threadId: job.threadId, url: job.url });
    return job;
  };
  const all = () =>
    Schema.decodeUnknownSync(Schema.Array(rowSchema))(
      db.prepare("SELECT data FROM review_guide_jobs").all(),
    ).map(({ data }) => data);
  // Always read again after an await: cancellation or a newer run can replace the row.
  const isCurrentActiveJob = (job: GuideJob) => {
    const current = read(job);
    return current?.id === job.id && isActiveGuideJob(current);
  };
  const forWorker = (workerId: string) =>
    all().find(
      (job): job is Extract<GuideJob, { status: "running" }> =>
        job.status === "running" && job.workerId === workerId,
    );
  const forThread = (threadId: string) =>
    sync("owner guide jobs", () =>
      Schema.decodeUnknownSync(Schema.Array(rowSchema))(
        db.prepare("SELECT data FROM review_guide_jobs WHERE thread_id = ?").all(threadId),
      ).map(({ data }) => data),
    );
  const deleteForThread = (threadId: string) =>
    sync("delete guide jobs", () => {
      db.prepare("DELETE FROM review_guide_jobs WHERE thread_id = ?").run(threadId);
    });
  return { read, write, all, isCurrentActiveJob, forWorker, forThread, deleteForThread };
}
