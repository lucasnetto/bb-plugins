import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import { packetSchema, resultSchema, type Packet, type Verdict, type Result } from "./domain";

export const migrations = [
  `CREATE TABLE subjects (id TEXT PRIMARY KEY, thread_id TEXT, project_id TEXT, revision TEXT NOT NULL, cursor INTEGER NOT NULL DEFAULT 0, dirty INTEGER NOT NULL DEFAULT 1);
   CREATE TABLE evidence (subject_id TEXT NOT NULL, sequence INTEGER NOT NULL, body TEXT NOT NULL, captured INTEGER NOT NULL, PRIMARY KEY(subject_id, sequence));
   CREATE TABLE jobs (id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, revision TEXT NOT NULL, packet TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, lease INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
   CREATE TABLE results (id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, revision TEXT NOT NULL, body TEXT NOT NULL, created INTEGER NOT NULL);
   CREATE TABLE annotations (result_id TEXT PRIMARY KEY, revision TEXT NOT NULL, value TEXT NOT NULL);
   CREATE INDEX jobs_pending ON jobs(state, lease);
   CREATE INDEX results_subject ON results(subject_id, created);`,
  `ALTER TABLE jobs ADD COLUMN evaluator TEXT NOT NULL DEFAULT 'offline';
   CREATE TABLE requests (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, started INTEGER NOT NULL, outcome TEXT);
   CREATE INDEX requests_started ON requests(started);`,
];

const subjectSchema = z.object({
  id: z.string(),
  thread_id: z.string().nullable(),
  project_id: z.string().nullable(),
  revision: z.string(),
  cursor: z.number(),
  dirty: z.number(),
});

const jobSchema = z.object({
  id: z.string(),
  subject_id: z.string(),
  revision: z.string(),
  packet: z.string(),
  attempts: z.number(),
  evaluator: z.enum(["offline", "gateway"]),
});

export type Job = z.infer<typeof jobSchema>;

export class Store {
  constructor(readonly db: Database.Database) {}
  subject(id: string) {
    const row = this.db.prepare("SELECT * FROM subjects WHERE id=?").get(id);

    return row ? subjectSchema.parse(row) : null;
  }
  touch(id: string, projectId: string | null, revision: string, threadId: string | null = id) {
    if (!this.subject(id) && this.subjects().length >= 100)
      throw new Error("Jev subject limit reached; clear data before selecting more threads.");
    this.db
      .prepare(
        "INSERT INTO subjects(id,thread_id,project_id,revision) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, dirty=1",
      )
      .run(id, threadId, projectId, revision);
    this.db
      .prepare(
        "UPDATE jobs SET state='superseded' WHERE subject_id=? AND revision<>? AND state IN ('pending','running')",
      )
      .run(id, revision);
  }
  wake(id: string) {
    this.db.prepare("UPDATE subjects SET dirty=1 WHERE id=?").run(id);
  }
  settled(id: string) {
    this.db.prepare("UPDATE subjects SET dirty=0 WHERE id=?").run(id);
  }
  invalidate(id: string) {
    const s = this.subject(id);

    if (s) this.touch(id, s.project_id, `invalid:${Date.now()}`, s.thread_id);
  }
  forget(id: string) {
    this.db.transaction(() => {
      this.db
        .prepare(
          "DELETE FROM annotations WHERE result_id IN (SELECT id FROM results WHERE subject_id=?)",
        )
        .run(id);

      for (const table of ["jobs", "results", "evidence"])
        this.db.prepare(`DELETE FROM ${table} WHERE subject_id=?`).run(id);
      this.db.prepare("DELETE FROM subjects WHERE id=?").run(id);
    })();
  }
  subjects() {
    return z
      .array(subjectSchema)
      .parse(this.db.prepare("SELECT * FROM subjects ORDER BY id LIMIT 100").all());
  }
  capture(id: string, revision: string, cursor: number, evidence: Packet["evidence"]) {
    this.db.transaction(() => {
      if (this.subject(id)?.revision !== revision) return;

      const insert = this.db.prepare(
        "INSERT OR IGNORE INTO evidence(subject_id,sequence,body,captured) VALUES(?,?,?,?)",
      );

      for (const e of evidence) insert.run(id, e.sequence, JSON.stringify(e), Date.now());
      this.db
        .prepare(
          "DELETE FROM evidence WHERE subject_id=? AND sequence NOT IN (SELECT sequence FROM evidence WHERE subject_id=? ORDER BY sequence DESC LIMIT 100)",
        )
        .run(id, id);
      this.db.prepare("UPDATE subjects SET cursor=? WHERE id=?").run(cursor, id);
    })();
  }
  evidence(id: string): Packet["evidence"] {
    const rows = z
      .array(z.object({ body: z.string() }))
      .parse(
        this.db.prepare("SELECT body FROM evidence WHERE subject_id=? ORDER BY sequence").all(id),
      );

    return rows.map((r) => packetSchema.shape.evidence.element.parse(JSON.parse(r.body)));
  }
  enqueue(packet: Packet, evaluator: "offline" | "gateway" = "offline", requireZdr = true) {
    const body = JSON.stringify(packetSchema.parse(packet));

    const id = createHash("sha256")
      .update(
        evaluator === "gateway" ? `gateway-attention-2:zdr=${requireZdr}:` : "offline-fixture-v1:",
      )
      .update(body)
      .digest("hex");

    this.db.transaction(() => {
      if (this.subject(packet.subjectId)?.revision !== packet.revision) return;

      const count = z
        .object({ n: z.number() })
        .parse(
          this.db.prepare("SELECT count(*) n FROM jobs WHERE state IN ('pending','running')").get(),
        ).n;

      if (count >= 100) throw new Error("Jev queue is full; try again after queued checks finish.");
      this.db
        .prepare(
          "INSERT OR IGNORE INTO jobs(id,subject_id,revision,packet,created,evaluator) VALUES(?,?,?,?,?,?)",
        )
        .run(id, packet.subjectId, packet.revision, body, Date.now(), evaluator);
      this.db.prepare("UPDATE subjects SET dirty=0 WHERE id=?").run(packet.subjectId);
    })();

    return id;
  }
  claim(now = Date.now()): Job | null {
    return this.db.transaction(() => {
      this.db
        .prepare(
          "UPDATE jobs SET state='failed' WHERE state IN ('pending','running') AND (attempts>=3 OR created<?)",
        )
        .run(now - 86400000);

      const row = this.db
        .prepare(
          "SELECT * FROM jobs WHERE state='pending' OR (state='running' AND lease<?) ORDER BY created LIMIT 1",
        )
        .get(now);

      if (!row) return null;
      const job = jobSchema.parse(row);
      this.db
        .prepare("UPDATE jobs SET state='running',attempts=attempts+1,lease=? WHERE id=?")
        .run(now + 30000, job.id);

      return job;
    })();
  }
  requestsToday() {
    const start = new Date().setUTCHours(0, 0, 0, 0);

    return z
      .object({ n: z.number() })
      .parse(this.db.prepare("SELECT count(*) n FROM requests WHERE started>=?").get(start)).n;
  }
  reserve(job: Job, limit: number): string | null {
    return this.db.transaction(() => {
      if (this.requestsToday() >= limit) return null;
      const id = randomUUID();

      const inserted = this.db
        .prepare("INSERT OR IGNORE INTO requests(id,job_id,started) VALUES(?,?,?)")
        .run(id, job.id, Date.now());

      return inserted.changes ? id : null;
    })();
  }
  recordRequest(id: string, verdict: Verdict) {
    this.db.prepare("UPDATE requests SET outcome=? WHERE id=?").run(JSON.stringify(verdict), id);
  }
  recover() {
    // An interrupted paid request may have reached Gateway. Never blindly replay it.
    const interrupted = z
      .array(jobSchema)
      .parse(
        this.db.prepare("SELECT * FROM jobs WHERE state='running' AND evaluator='gateway'").all(),
      );

    for (const job of interrupted)
      this.complete(job, {
        execution: "error",
        label: null,
        uncertainty:
          "Interrupted Gateway request: delivery and usage are unknown. It was not automatically retried.",
        evidenceIds: [],
        model: "typesafe-ai/jev",
        usage: null,
      });
    this.db.prepare("UPDATE jobs SET state='pending',lease=0 WHERE state='running'").run();
  }
  complete(job: Job, verdict: Verdict): boolean {
    return this.db.transaction(() => {
      if (this.subject(job.subject_id)?.revision !== job.revision) {
        this.db.prepare("UPDATE jobs SET state='superseded' WHERE id=?").run(job.id);

        return false;
      }

      const result: Result = {
        id: job.id,
        packet: packetSchema.parse(JSON.parse(job.packet)),
        verdict,
        annotation: null,
        current: true,
        createdAt: Date.now(),
      };

      this.db
        .prepare(
          "INSERT OR IGNORE INTO results(id,subject_id,revision,body,created) VALUES(?,?,?,?,?)",
        )
        .run(job.id, job.subject_id, job.revision, JSON.stringify(result), result.createdAt);
      this.db.prepare("UPDATE jobs SET state='done' WHERE id=?").run(job.id);

      return true;
    })();
  }
  retry(job: Job) {
    this.db.prepare("UPDATE jobs SET state='pending' WHERE id=? AND state='running'").run(job.id);
  }
  list(threadId?: string): Result[] {
    const rows = z
      .array(
        z.object({
          body: z.string(),
          current_revision: z.string(),
          annotation: z.string().nullable(),
          latest: z.number(),
        }),
      )
      .parse(
        this.db
          .prepare(
            `SELECT r.body,s.revision current_revision,a.value annotation, (r.rowid=(SELECT max(r2.rowid) FROM results r2 WHERE r2.subject_id=r.subject_id)) latest FROM results r JOIN subjects s ON s.id=r.subject_id LEFT JOIN annotations a ON a.result_id=r.id ${threadId ? "WHERE s.thread_id=?" : ""} ORDER BY r.created DESC,r.id LIMIT 100`,
          )
          .all(...(threadId ? [threadId] : [])),
      );

    return rows.map((row) => {
      const result = resultSchema.parse(JSON.parse(row.body));

      return resultSchema.parse({
        ...result,
        current: result.packet.revision === row.current_revision && row.latest === 1,
        annotation: row.annotation,
      });
    });
  }
  annotate(id: string, revision: string, value: "dismissed" | "incorrect") {
    const row = this.db
      .prepare(
        "SELECT r.id FROM results r JOIN subjects s ON s.id=r.subject_id WHERE r.id=? AND r.revision=? AND s.revision=?",
      )
      .get(id, revision, revision);

    if (!row) return false;
    this.db
      .prepare(
        "INSERT INTO annotations VALUES(?,?,?) ON CONFLICT(result_id) DO UPDATE SET value=excluded.value",
      )
      .run(id, revision, value);

    return true;
  }
  clear() {
    this.db.transaction(() => {
      for (const table of ["annotations", "results", "jobs", "evidence", "subjects"])
        this.db.prepare(`DELETE FROM ${table}`).run();
    })();
  }
  prune(days: number) {
    const before = Date.now() - days * 86400000;
    this.db.prepare("DELETE FROM evidence WHERE captured<?").run(before);
    this.db
      .prepare(
        "DELETE FROM annotations WHERE result_id IN (SELECT id FROM results WHERE created<?)",
      )
      .run(before);
    this.db.prepare("DELETE FROM results WHERE created<?").run(before);
    this.db
      .prepare("DELETE FROM jobs WHERE created<? AND state NOT IN ('pending','running')")
      .run(before);
  }
}
