/**
 * The count of registry writes the database has seen (`seq`, in the stored
 * schema version `domains/schema/schema-version` keeps), as this process
 * last read it.
 *
 * Every write of registry rows moves `seq` in that write's own transaction,
 * whoever made it: this process, another copy of the app, `nextly migrate`
 * or a migration file. So a `seq` read here that differs from the one
 * something was read at says the registry may have changed since, and one
 * that is the same says it has not.
 *
 * - **One read per database per interval, for everyone.** It is read at most
 *   once every {@link SCHEMA_VERSION_READ_INTERVAL_MS} per database, by the
 *   first caller to find the last read too old; callers arriving while that
 *   read runs share it. Every other caller reads nothing. The served schema
 *   version (`route-handler/schema-version`) and the cached registry rows
 *   (`collection-row-cache`) both ask here, so a server copy makes one such
 *   read per interval for both.
 * - **A change made here is read at once.** {@link markSchemaChanged}, called
 *   once a registry write in this process has committed, makes the next caller
 *   read again rather than answer with the count from before it.
 * - **Unknown is said, not guessed.** Where it cannot be read (a database
 *   `nextly migrate` has not prepared, a dropped connection, or a database
 *   handle that is not an adapter), the answer is undefined, kept for the
 *   interval like a read, so a failing read is tried again after it rather
 *   than by every caller.
 *
 * - **Followed once read.** A caller may ask only where the count is already
 *   followed (`followedOnly`): one that has never been read for a database is
 *   then not read for it, and the caller treats it as unknown. The served
 *   schema version reads it on every server request, so a server copy follows
 *   it from its first request on, while a start, a CLI command or a script
 *   that never serves a request reads nothing it did not read before.
 *
 * Reads only. Nothing is reloaded here: the served schema version decides
 * what a moved count means for the definitions, and the row cache for the
 * rows it holds.
 *
 * @module domains/schema/stored-schema-seq
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import {
  followedState,
  followValue,
  markFollowedChanged,
  type FollowedState,
} from "../../shared/lib/followed-value";

/**
 * How long one read of the stored count is reused by this process: the bound,
 * with the reload or re-read after it, on how long another copy's registry
 * change goes unseen here.
 */
export const SCHEMA_VERSION_READ_INTERVAL_MS = 2000;

/** What a database handle must offer for its stored count to be read. */
type VersionSource = Pick<DrizzleAdapter, "getDrizzle" | "getCapabilities">;

/**
 * This process's readings of each database's count, followed as every
 * install-wide value is (`shared/lib/followed-value`). Kept on `globalThis`
 * under the name the readings have always had, with the followed value's
 * version added to it: the readings kept before they moved onto it had
 * another shape, and a dev server reloaded across the change still holds
 * them under the bare name.
 */
function seqState(): FollowedState<number> {
  return followedState<number>("__nextly_storedSchemaSeq");
}

/** Whether `database` is a handle the stored count can be read through. */
function isVersionSource(database: object): database is VersionSource {
  const candidate = database as Partial<VersionSource>;
  return (
    typeof candidate.getDrizzle === "function" &&
    typeof candidate.getCapabilities === "function"
  );
}

/**
 * Say a registry write in this process has committed: every database's count
 * is read again by the next caller, so it answers with the count that write
 * stored rather than the one read before it.
 */
export function markSchemaChanged(): void {
  markFollowedChanged(seqState());
}

/**
 * The count `database` stores, as last read: read again where that read is
 * older than {@link SCHEMA_VERSION_READ_INTERVAL_MS}, where a change was
 * marked since it began, or where `fresh` asks for a read now (one already
 * under way, begun after the last mark, is shared rather than repeated). 0
 * where no registry write has stored a version yet; undefined where it cannot
 * be read, and, with `followedOnly`, where it has never been read for
 * `database`. Never throws.
 */
export async function storedSchemaSeq(
  database: object,
  options: { fresh?: boolean; followedOnly?: boolean } = {}
): Promise<number | undefined> {
  if (!isVersionSource(database)) return undefined;
  return followValue(seqState(), database, () => readStoredSeq(database), {
    intervalMs: SCHEMA_VERSION_READ_INTERVAL_MS,
    ...options,
  });
}

/** One read of the stored count, or undefined where it cannot be read. */
async function readStoredSeq(
  database: VersionSource
): Promise<number | undefined> {
  try {
    // Imported when first needed: the version's module reaches the registry
    // row cache, which asks here.
    const { readSchemaVersion } = await import("./schema-version");
    const stored = await readSchemaVersion(
      database.getDrizzle(),
      database.getCapabilities().dialect
    );
    // No stored version: no registry write has recorded one yet.
    return stored.present ? (stored.version?.seq ?? 0) : 0;
  } catch {
    return undefined;
  }
}
