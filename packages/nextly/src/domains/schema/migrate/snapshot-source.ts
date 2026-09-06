/**
 * Reading the migration snapshots, once, for everything that needs them.
 *
 * Two callers ask the same question of `migrations/meta`: registration, which
 * decides what to insert, and the pending sweep, which decides what shape a row
 * is waiting for. They read the same files, pair them with the same ledger and
 * resolve later-wins the same way — so the reader lives here rather than in
 * either of them, and neither can drift from the other's idea of what a
 * snapshot is or which migration it belongs to.
 *
 * @module domains/schema/migrate/snapshot-source
 */

import { readdir, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";

/**
 * Collection definition from migration snapshot
 */
export interface SnapshotCollection {
  slug: string;
  tableName: string;
  labels?: {
    singular?: string;
    plural?: string;
  };
  description?: string;
  fields: unknown[];
  admin?: unknown;
  dbName?: string;
  status?: boolean;
  timestamps?: boolean;
}

/**
 * Single definition from migration snapshot
 */
export interface SnapshotSingle {
  slug: string;
  tableName: string;
  labels?: {
    singular?: string;
    plural?: string;
  };
  description?: string;
  fields: unknown[];
  admin?: unknown;
  dbName?: string;
  status?: boolean;
}

/**
 * Migration snapshot file structure
 */
export interface MigrationSnapshot {
  version?: number;
  collections?: SnapshotCollection[];
  singles?: SnapshotSingle[];
}

/**
 * Whether the migration a snapshot belongs to has actually been applied.
 *
 * Called with the LEDGER filename, which is the migration group's `.sql` name
 * rather than a dialect variant: `runFileMigrations` records `0001_x.sql`
 * whether it executed `0001_x.sql` or `0001_x.mysql.sql`, and the snapshot
 * beside it is `meta/0001_x.snapshot.json`.
 */
export type IsAppliedFn = (ledgerFilename: string) => Promise<boolean>;

/**
 * One snapshot file, with whether the migration it belongs to has run.
 *
 * The flag travels WITH the snapshot rather than filtering the list, because
 * both decisions it feeds are per entity: which slugs may be registered, and
 * which shape a slug's migrations have actually reached. Finding the newest
 * snapshot describing a slug means looking at unapplied ones too.
 */
export interface LoadedSnapshot {
  file: string;
  snapshot: MigrationSnapshot;
  applied: boolean;
}

export interface LoadSnapshotsOptions {
  migrationsDir: string;
  logger?: { warn?: (msg: string) => void; debug?: (msg: string) => void };
  /** Omit to treat every snapshot as applied. */
  isApplied?: IsAppliedFn;
}

/**
 * Every `*.snapshot.json` under `migrations/meta`, in lexicographic order.
 *
 * Ordering is the contract: callers resolve later-wins by iterating this list,
 * so a reader that returned them unsorted would make "the newest snapshot
 * describing a slug" mean whatever the filesystem felt like.
 */
export async function loadSnapshots(
  options: LoadSnapshotsOptions
): Promise<LoadedSnapshot[]> {
  const { migrationsDir, logger, isApplied } = options;
  const metaDir = resolve(migrationsDir, "meta");

  let files: string[];
  try {
    files = await readdir(metaDir);
  } catch {
    // Meta directory doesn't exist or isn't readable
    return [];
  }

  // Sort files lexicographically to ensure deterministic "later snapshot wins" behavior
  const snapshotFiles = files.filter(f => f.endsWith(".snapshot.json")).sort();

  if (snapshotFiles.length === 0) {
    return [];
  }

  const loaded: LoadedSnapshot[] = [];

  for (const file of snapshotFiles) {
    /*
     * 🔴 The ledger read sits OUTSIDE the parse guard below, and outside the
     * directory guard above. Both exist for a file that cannot be read, and a
     * ledger that cannot be queried is neither: it fails identically for every
     * snapshot, so swallowing it drops the whole set and returns the empty
     * list that means "nothing to register". The caller then reports an
     * up-to-date database while none of the metadata was written. Left to
     * throw, it reaches the phase-level handler, which records the pass as
     * unreadable and tells the operator to run `nextly migrate` again.
     */
    let applied = true;
    if (isApplied) {
      const ledgerFilename = `${file.replace(/\.snapshot\.json$/, "")}.sql`;
      applied = await isApplied(ledgerFilename);
    }

    try {
      const filePath = join(metaDir, file);
      const content = await readFile(filePath, "utf-8");
      const snapshot = JSON.parse(content) as MigrationSnapshot;
      loaded.push({ file, snapshot, applied });
    } catch (err) {
      // Skip invalid snapshot files but continue processing others
      logger?.warn?.(`Could not read snapshot file ${file}: ${String(err)}`);
    }
  }

  return loaded;
}

/**
 * The newest entry per slug, dropped when the snapshot it came from has not
 * been applied.
 *
 * 🔴 The drop is decided on the WINNER, after later-wins resolution, not on
 * each entry as it is read. A slug described by an applied snapshot and again
 * by a pending one is withheld entirely: registration inserts once and never
 * revisits a row, so writing the earlier shape now is writing it permanently.
 */
export function newestApplied<T extends { slug: string }>(
  loaded: LoadedSnapshot[],
  entriesOf: (snapshot: MigrationSnapshot) => T[] | undefined,
  logger?: { debug?: (msg: string) => void }
): T[] {
  const winners = newestBySlug(loaded, entriesOf);

  const registrable: T[] = [];
  for (const [slug, winner] of winners) {
    if (!winner.applied) {
      logger?.debug?.(
        `[Migration Metadata] Not registering "${slug}": its newest snapshot ${winner.file} has not been applied`
      );
      continue;
    }
    registrable.push(winner.entry);
  }

  return registrable;
}

/**
 * The last entry describing each slug, applied or not, with its provenance.
 *
 * Separate from {@link newestApplied} because the two callers want opposite
 * halves of the same resolution: registration wants the winners it may write,
 * the sweep wants the newest APPLIED shape regardless of what a later pending
 * snapshot says.
 */
export function newestBySlug<T extends { slug: string }>(
  loaded: LoadedSnapshot[],
  entriesOf: (snapshot: MigrationSnapshot) => T[] | undefined
): Map<string, { entry: T; applied: boolean; file: string }> {
  const winners = new Map<
    string,
    { entry: T; applied: boolean; file: string }
  >();

  for (const { snapshot, applied, file } of loaded) {
    for (const entry of entriesOf(snapshot) ?? []) {
      if (entry.slug) {
        winners.set(entry.slug, { entry, applied, file });
      }
    }
  }

  return winners;
}
