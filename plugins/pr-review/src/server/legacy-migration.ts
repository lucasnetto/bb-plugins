import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { Schema } from "effect";
import { initializeReviewDatabase, NORMALIZE_LEGACY_GUIDE_JOBS } from "./database";
import { guideModelSchema } from "../shared/guide-generation";

const source = "multirepo-v1";
const tables = [
  ["linked_prs", "thread_id, url, data"],
  ["review_guides", "thread_id, url, data"],
  ["review_guide_jobs", "thread_id, url, data"],
  ["pr_auto_settled", "thread_id, fingerprint"],
] as const;
const modelRows = Schema.Array(Schema.Struct({ key: Schema.String, value: Schema.String }));

/** Import once, without modifying the retired plugin or BB's database.
 * Disable Multirepo before the first load so it cannot write after the snapshot.
 * A completed import is never replayed: removed links must stay removed.
 */
export async function migrateLegacyReview(bb: BbPluginApi) {
  const db = initializeReviewDatabase(bb);
  if (db.prepare("SELECT 1 FROM legacy_imports WHERE source = ?").get(source)) return;
  const legacyPath = join(bb.server.experimental_dataDir, "plugins", "multirepo", "data.db");
  const corePath = join(bb.server.experimental_dataDir, "bb.db");
  // Preferences live in BB's namespaced KV store, separately from review rows.
  if (existsSync(corePath)) {
    const core = new DatabaseSync(corePath, { readOnly: true });
    try {
      const hasKv = core.prepare("SELECT 1 FROM sqlite_master WHERE name = 'plugin_kv'").get();
      if (hasKv) {
        const rows = Schema.decodeUnknownSync(modelRows)(
          core
            .prepare(
              "SELECT key, value FROM plugin_kv WHERE plugin_id = 'multirepo' AND key LIKE 'guide-model:%'",
            )
            .all(),
        );
        for (const row of rows) {
          const model = Schema.decodeUnknownSync(
            Schema.fromJsonString(Schema.NullOr(guideModelSchema)),
          )(row.value);
          if ((await bb.storage.kv.get(row.key)) === undefined)
            await bb.storage.kv.set(row.key, model);
        }
      }
    } finally {
      core.close();
    }
  }
  if (existsSync(legacyPath)) {
    const legacy = new DatabaseSync(legacyPath, { readOnly: true });
    try {
      db.transaction(() => {
        for (const [table, columns] of tables) {
          if (!legacy.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(table)) continue;
          const keys = columns.split(", ");
          const rows = Schema.decodeUnknownSync(
            Schema.Array(Schema.Record(Schema.String, Schema.String)),
          )(legacy.prepare(`SELECT ${columns} FROM ${table}`).all());
          const insert = db.prepare(
            `INSERT OR IGNORE INTO ${table} (${columns}) VALUES (${keys.map(() => "?").join(", ")})`,
          );
          for (const row of rows) insert.run(...keys.map((key) => row[key]));
        }
        db.exec(NORMALIZE_LEGACY_GUIDE_JOBS);
        db.prepare("INSERT INTO legacy_imports (source) VALUES (?)").run(source);
      })();
    } finally {
      legacy.close();
    }
    bb.log.info("Imported Multirepo links, guides, jobs, and settlement history.");
  } else {
    db.prepare("INSERT INTO legacy_imports (source) VALUES (?)").run(source);
  }
}
