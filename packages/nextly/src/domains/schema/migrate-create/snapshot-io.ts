// F11 PR 3: snapshot file I/O for `migrate:create` and `migrate:check`.
//
// Each migration ships with a paired snapshot file capturing the schema
// state AFTER the migration is applied. The next `migrate:create` reads
// the latest snapshot to know "where the schema is now", diffs against
// the new desired schema, and emits ALTER statements for the difference.
//
// On-disk format (per spec §8.1) — superset of NextlySchemaSnapshot:
//
//   {
//     "version": 1,
//     "migrationHash": "<sha256 of paired .sql file content>",
//     "snapshot": { "tables": [ ... ] }
//   }
//
// JSON is written deterministically (sorted keys + 2-space indent) so
// file content is reproducible across machines. `migrationHash` is the
// canonical store for `migrate:check`'s offline integrity verification.

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { NextlySchemaSnapshot } from "../pipeline/diff/types.js";

export interface SnapshotFile {
  version: 1;
  migrationHash: string;
  snapshot: NextlySchemaSnapshot;
}

/** Empty snapshot used for "first migration" (no prior state). */
export const EMPTY_SNAPSHOT: NextlySchemaSnapshot = { tables: [] };

/**
 * Read the latest snapshot file from `migrations/meta/`.
 *
 * "Latest" = alphabetically last, which corresponds to the highest
 * timestamp because filenames start with `YYYYMMDD_HHMMSS_mmm_`.
 *
 * Returns `null` if the directory doesn't exist or contains no
 * `.snapshot.json` files. Callers treat that as "first migration"
 * and use `EMPTY_SNAPSHOT`.
 */
export async function loadLatestSnapshot(
  metaDir: string
): Promise<{ filename: string; data: SnapshotFile } | null> {
  let files: string[] = [];
  try {
    files = await readdir(metaDir);
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return null;
    throw err;
  }
  const snapshots = files.filter(f => f.endsWith(".snapshot.json")).sort();
  if (snapshots.length === 0) return null;
  const latest = snapshots[snapshots.length - 1];
  const content = await readFile(resolve(metaDir, latest), "utf-8");
  return { filename: latest, data: JSON.parse(content) as SnapshotFile };
}

/**
 * Write a snapshot file paired with a migration `.sql` file.
 *
 * The `migrationHash` is computed from the `.sql` file content so
 * `migrate:check` can verify integrity offline (no DB connection).
 */
export async function writeSnapshot(
  metaDir: string,
  baseName: string,
  snapshot: NextlySchemaSnapshot,
  sqlContent: string
): Promise<string> {
  await mkdir(metaDir, { recursive: true });
  const file: SnapshotFile = {
    version: 1,
    migrationHash: computeMigrationHash(sqlContent),
    // Sort tables by name for reproducibility across machines.
    snapshot: {
      tables: [...snapshot.tables]
        .map(t => ({
          name: t.name,
          columns: [...t.columns].sort((a, b) => a.name.localeCompare(b.name)),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    },
  };
  const json = JSON.stringify(file, sortedKeysReplacer, 2);
  const path = resolve(metaDir, `${baseName}.snapshot.json`);
  await writeFile(path, json + "\n", "utf-8");
  return path;
}

/**
 * SHA-256 of the SQL file content (hex-encoded). Used as
 * `nextly_migrations.sha256` in the DB and as `migrationHash` in
 * the paired snapshot file.
 */
export function computeMigrationHash(sqlContent: string): string {
  return createHash("sha256").update(sqlContent).digest("hex");
}

/**
 * Verify a SQL file's hash matches the paired snapshot's
 * `migrationHash`. Used by `migrate:check` (PR 4).
 */
export async function verifyMigrationHash(
  metaDir: string,
  sqlFilename: string,
  sqlContent: string
): Promise<{ ok: boolean; expected?: string; actual: string }> {
  const baseName = sqlFilename.replace(/\.sql$/, "");
  const snapshotPath = resolve(metaDir, `${baseName}.snapshot.json`);
  const actual = computeMigrationHash(sqlContent);
  let raw: string;
  try {
    raw = await readFile(snapshotPath, "utf-8");
  } catch {
    return { ok: false, expected: undefined, actual };
  }
  const data = JSON.parse(raw) as SnapshotFile;
  return {
    ok: data.migrationHash === actual,
    expected: data.migrationHash,
    actual,
  };
}

// JSON.stringify replacer that sorts object keys alphabetically. Arrays
// pass through as-is (their element order is meaningful — preserved by
// the caller via .sort() in writeSnapshot).
function sortedKeysReplacer(_key: string, value: unknown): unknown {
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  ) {
    // After narrowing, Object.keys accepts `value` directly.
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}
