import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { test, expect } from "vite-plus/test";
import { migrateLegacyReview } from "../../src/server/legacy-migration";
import { initializeReviewDatabase } from "../../src/server/database";

const url = "https://github.com/org/repo/pull/1";
function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), "pr-review-migration-"));
  mkdirSync(join(dataDir, "plugins", "multirepo"), { recursive: true });
  const legacy = new Database(join(dataDir, "plugins", "multirepo", "data.db"));
  legacy.exec(`
    CREATE TABLE linked_prs (thread_id TEXT, url TEXT, data TEXT, PRIMARY KEY(thread_id, url));
    CREATE TABLE review_comments (id TEXT PRIMARY KEY, thread_id TEXT, context TEXT);
    CREATE TABLE review_guides (thread_id TEXT, url TEXT, data TEXT, PRIMARY KEY(thread_id, url));
    CREATE TABLE review_guide_jobs (thread_id TEXT, url TEXT, data TEXT, PRIMARY KEY(thread_id, url));
    CREATE TABLE pr_auto_settled (thread_id TEXT PRIMARY KEY, fingerprint TEXT);
  `);
  legacy.prepare("INSERT INTO linked_prs VALUES (?, ?, ?)").run("t1", url, '{"title":"old"}');
  legacy
    .prepare("INSERT INTO review_comments VALUES (?, ?, ?)")
    .run("comment", "t1", "Exact selected code");
  legacy
    .prepare("INSERT INTO review_guides VALUES (?, ?, ?)")
    .run("t1", url, '{"reviewed":["chapter"]}');
  legacy.prepare("INSERT INTO review_guide_jobs VALUES (?, ?, ?)").run(
    "t1",
    url,
    JSON.stringify({
      id: "job",
      threadId: "t1",
      url,
      status: "cancelled",
      workerId: null,
      revision: null,
    }),
  );
  legacy.prepare("INSERT INTO pr_auto_settled VALUES (?, ?)").run("t1", JSON.stringify([[url, 1]]));
  const core = new Database(join(dataDir, "bb.db"));
  core.exec("CREATE TABLE plugin_kv (plugin_id TEXT, key TEXT, value TEXT)");
  const model = { providerId: "codex", model: "saved-model", reasoningLevel: "high" };
  core
    .prepare("INSERT INTO plugin_kv VALUES (?, ?, ?)")
    .run("multirepo", "guide-model:default", JSON.stringify(model));
  core
    .prepare("INSERT INTO plugin_kv VALUES (?, ?, ?)")
    .run("multirepo", "guide-model:project", JSON.stringify(model));
  core.close();
  const host = createFakePluginHost({ pluginId: "pr-review", dataDir });
  return {
    ...host,
    legacy,
    model,
    async dispose() {
      await host.harness.lifecycle.dispose();
      legacy.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

test("imports review data and preferences while preserving the shipped list cache and destination values", async () => {
  const h = fixture();
  try {
    const db = h.bb.storage.database();
    // The original PR Review installation has only this shipped migration.
    h.bb.storage.migrate(db, [
      "CREATE TABLE list_snapshots (scope TEXT PRIMARY KEY, data TEXT NOT NULL)",
    ]);
    db.prepare("INSERT INTO list_snapshots VALUES (?, ?)").run("saved", "cached PRs");
    await h.bb.storage.kv.set("guide-model:default", null);
    initializeReviewDatabase(h.bb);
    db.prepare("INSERT INTO linked_prs VALUES (?, ?, ?)").run("t1", url, '{"title":"newer"}');
    await migrateLegacyReview(h.bb);
    expect(db.prepare("SELECT data FROM list_snapshots").get()).toEqual({ data: "cached PRs" });
    expect(db.prepare("SELECT data FROM linked_prs").get()).toEqual({ data: '{"title":"newer"}' });
    for (const table of ["review_guides", "review_guide_jobs", "pr_auto_settled"])
      expect(db.prepare(`SELECT * FROM ${table}`).all()).toEqual(
        h.legacy.prepare(`SELECT * FROM ${table}`).all(),
      );
    expect(db.prepare("SELECT * FROM review_comments").all()).toEqual([]);
    expect(await h.bb.storage.kv.get("guide-model:default")).toBeNull();
    expect(await h.bb.storage.kv.get("guide-model:project")).toEqual(h.model);
    db.exec("DELETE FROM linked_prs; DELETE FROM review_comments");
    await migrateLegacyReview(h.bb);
    expect(db.prepare("SELECT * FROM linked_prs").all()).toEqual([]);
    expect(db.prepare("SELECT * FROM review_comments").all()).toEqual([]);
    expect(h.legacy.prepare("SELECT * FROM linked_prs").all()).toHaveLength(1);
    expect(h.legacy.prepare("SELECT * FROM review_comments").all()).toHaveLength(1);
  } finally {
    await h.dispose();
  }
});

test("normalizes older imported guide jobs before recovery and rolls back an incomplete migration", async () => {
  const h = fixture();
  try {
    h.legacy.prepare("UPDATE review_guide_jobs SET data = ?").run(
      JSON.stringify({
        id: "old-job",
        threadId: "t1",
        url,
        status: "error",
        workerId: null,
        base: "",
        head: "",
        error: "Offline",
      }),
    );
    // Force a failure after some rows have been copied.
    h.legacy.exec("ALTER TABLE pr_auto_settled RENAME COLUMN fingerprint TO broken");
    await expect(migrateLegacyReview(h.bb)).rejects.toThrow(/fingerprint/);
    const db = h.bb.storage.database();
    expect(db.prepare("SELECT * FROM linked_prs").all()).toEqual([]);
    expect(db.prepare("SELECT * FROM legacy_imports").all()).toEqual([]);
    h.legacy.exec("ALTER TABLE pr_auto_settled RENAME COLUMN broken TO fingerprint");
    await migrateLegacyReview(h.bb);
    const row = db.prepare<[], { data: string }>("SELECT data FROM review_guide_jobs").get();
    expect(JSON.parse(row!.data)).toEqual({
      id: "old-job",
      threadId: "t1",
      url,
      status: "error",
      workerId: null,
      revision: null,
      error: "Offline",
    });
  } finally {
    await h.dispose();
  }
});
