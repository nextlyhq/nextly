/**
 * A migration's snapshot file in the migrations' `meta` directory, read as
 * `nextly migrate` reads it.
 *
 * A module of its own, apart from `rollback-to-record.ts`, because the
 * deletion of an entity's shared rows reads snapshots too: importing the
 * reader from here loads the snapshot parser rather than the rollback's
 * service and permission bookkeeping.
 *
 * @module domains/schema/migrate/migration-snapshot-file
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { NextlyError } from "../../../errors/nextly-error";
import {
  parseSnapshotFile,
  type SnapshotFile,
} from "../migrate-create/snapshot-io";

/** `content` parsed as JSON, or undefined where it is not JSON. */
function jsonOf(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return undefined;
  }
}

/** A migration's snapshot, or null where it has none or it is not a migration snapshot. */
export async function readMigrationSnapshot(
  metaDir: string,
  name: string
): Promise<SnapshotFile | null> {
  const file = `${name}.snapshot.json`;
  let content: string;
  try {
    content = await readFile(resolve(metaDir, file), "utf-8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return null;
    throw NextlyError.internal({ cause: error as Error });
  }
  // A template's own metadata file (collections and Singles, no migration
  // hash) is no migration snapshot, as `nextly migrate` reads it.
  const parsed = jsonOf(content);
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    !("migrationHash" in parsed) &&
    ("collections" in parsed || "singles" in parsed)
  ) {
    return null;
  }
  return parseSnapshotFile(content, file);
}
