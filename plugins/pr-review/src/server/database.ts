import type { BbPluginApi } from "@get-bb/plugin-sdk";

export const NORMALIZE_LEGACY_GUIDE_JOBS = `UPDATE review_guide_jobs SET data = CASE json_extract(data, '$.status')
      WHEN 'preparing' THEN json_remove(data, '$.workerId', '$.base', '$.head', '$.error')
      WHEN 'running' THEN json_remove(data, '$.error')
      WHEN 'complete' THEN json_remove(data, '$.error')
      WHEN 'cancelled' THEN json_set(json_remove(data, '$.base', '$.head', '$.error'), '$.revision',
        CASE WHEN json_extract(data, '$.base') = '' THEN json('null')
        ELSE json_object('base', json_extract(data, '$.base'), 'head', json_extract(data, '$.head')) END)
      WHEN 'error' THEN json_set(json_remove(data, '$.base', '$.head'), '$.error',
        coalesce(nullif(json_extract(data, '$.error'), ''), 'Guide generation failed.'), '$.revision',
        CASE WHEN json_extract(data, '$.base') = '' THEN json('null')
        ELSE json_object('base', json_extract(data, '$.base'), 'head', json_extract(data, '$.head')) END)
      ELSE data END WHERE json_type(data, '$.base') IS NOT NULL`;

/** Shared review database. Migration order is persisted; append new migrations only. */
export function initializeReviewDatabase(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    // Keep PR Review's shipped first migration at its original index.
    "CREATE TABLE list_snapshots (scope TEXT PRIMARY KEY, data TEXT NOT NULL)",
    "CREATE TABLE linked_prs (thread_id TEXT NOT NULL, url TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(thread_id, url))",
    "CREATE TABLE review_comments (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, context TEXT NOT NULL)",
    "CREATE TABLE review_guides (thread_id TEXT NOT NULL, url TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(thread_id, url))",
    "CREATE TABLE review_guide_jobs (thread_id TEXT NOT NULL, url TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(thread_id, url))",
    // Remove the legacy placeholders before the status-specific decoder reads jobs.
    NORMALIZE_LEGACY_GUIDE_JOBS,
    "CREATE TABLE pr_auto_settled (thread_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL)",
    "CREATE TABLE legacy_imports (source TEXT PRIMARY KEY)",
  ]);
  return db;
}
