/**
 * The registry source: what `nextly migrate` brings the registry rows of
 * collections, Singles and field groups to after its migrations apply.
 *
 * It is the snapshot of the newest app migration the ledger records as
 * applied, among those that have one, where that snapshot records every
 * entity's declaration (`SnapshotFile.entities`). A snapshot written before
 * declarations were recorded says nothing about them, so it is no source:
 * its missing record is never read as an empty registry. A plugin's own
 * migration modules carry only tables, never registry rows, and a plugin's
 * collection is recorded in the app's snapshot like any other, so the app's
 * migrations are the only stream read here.
 *
 * @module domains/schema/migrate/registry-source
 */
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { EntitySettingsRecord } from "../migrate-create/entity-settings";
import { parseSnapshotFile } from "../migrate-create/snapshot-io";

import { ledgerNameOfSnapshot, type IsAppliedFn } from "./snapshot-source";

/** The registry source at the newest applied point, or why there is none. */
export type RegistrySource =
  | { kind: "snapshot"; file: string; entities: EntitySettingsRecord }
  | {
      kind: "none";
      /**
       * `no-snapshot`: no applied migration has one. `no-record`: the newest
       * applied snapshot predates recorded declarations. `unreadable`: it
       * could not be read, so nothing is written from it.
       */
      reason: "no-snapshot" | "no-record" | "unreadable";
      file?: string;
    };

const SNAPSHOT_SUFFIX = ".snapshot.json";

/**
 * The registry source of the migrations folder, as the ledger stands now.
 *
 * The snapshots are walked newest first in run order (a migration's name
 * sorts in the order it runs), and the first whose migration is applied is
 * the point's. An earlier applied snapshot never stands in for a newest one
 * that records nothing: the newest applied snapshot is the whole expected
 * state, so reading an older record would undo what the migrations since
 * changed.
 */
export async function readRegistrySource(args: {
  migrationsDir: string;
  isApplied: IsAppliedFn;
}): Promise<RegistrySource> {
  const metaDir = resolve(args.migrationsDir, "meta");
  let names: string[];
  try {
    names = await readdir(metaDir);
  } catch (error) {
    // No `meta` folder is a project with no snapshot yet; any other failure
    // to list it is not the same as an empty one, so it travels.
    if ((error as { code?: string }).code === "ENOENT") {
      return { kind: "none", reason: "no-snapshot" };
    }
    throw error;
  }
  const newestFirst = names
    .filter(name => name.endsWith(SNAPSHOT_SUFFIX))
    .sort()
    .reverse();
  for (const file of newestFirst) {
    if (!(await args.isApplied(ledgerNameOfSnapshot(file)))) continue;
    return sourceIn(join(metaDir, file), file);
  }
  return { kind: "none", reason: "no-snapshot" };
}

/** The source one snapshot file gives: its recorded declarations, or none. */
async function sourceIn(path: string, file: string): Promise<RegistrySource> {
  let entities: EntitySettingsRecord | undefined;
  try {
    entities = parseSnapshotFile(await readFile(path, "utf-8"), file).entities;
  } catch {
    // Written from nothing is safer than written from a guess: the rows stay
    // as they are, and the run says why.
    return { kind: "none", reason: "unreadable", file };
  }
  return entities === undefined
    ? { kind: "none", reason: "no-record", file }
    : { kind: "snapshot", file, entities };
}
