/**
 * A media record's fingerprint when something needs it now.
 *
 * Records stored before fingerprints existed get theirs from the background
 * fill (`backfill-job`), which may not have reached a given record yet. A
 * caller that needs the fingerprint at once, such as an export that stores
 * each file once by its fingerprint, asks here: the record's own when it has
 * one, otherwise the hash of what storage holds, kept on the record so the
 * next caller does not read the file again. The background fill asks the
 * same question the same way, so the two can never give one file two
 * fingerprints.
 *
 * @module domains/media/hash-backfill/hash-when-missing
 */
import type { WhereClause } from "@nextlyhq/adapter-drizzle/types";

import {
  hashOfStoredFile,
  isContentHash,
  type StoredFileReading,
} from "./content-hash";

/** What a fingerprint is looked up from: the record's id, file and own value. */
export interface MediaHashSubject {
  id: string;
  /** The stored path of the record's file, as the record names it. */
  filename: string;
  /** The byte count the record says is stored, which caps the read. */
  size?: number | null;
  sha256?: unknown;
}

/** The database the fingerprint is kept in and the storage the file is in. */
/** The one write the fingerprint needs: an update of the media table. */
export interface MediaHashWriter {
  update(
    table: string,
    data: Record<string, unknown>,
    where: WhereClause
  ): Promise<unknown>;
}

export interface MediaHashDeps {
  db: MediaHashWriter;
  storage: StoredFileReading;
  /** When the read must be done, in epoch ms (`hashOfStoredFile`). */
  deadline?: number;
  /** The wall clock the deadline is judged by. */
  clock?: () => number;
}

/**
 * The record's fingerprint: its own when it has one, otherwise that of the
 * file storage holds, written to the record. `null` when storage holds no
 * file at the record's path, with nothing written, so the caller can say the
 * file is missing instead of storing a hash of nothing.
 *
 * The write is kept to this record while it still names the file that was
 * read and still has no fingerprint, so a Replace or an upload that wrote
 * one in the meantime keeps its own.
 */
export async function mediaHashWhenMissing(
  deps: MediaHashDeps,
  item: MediaHashSubject
): Promise<string | null> {
  if (isContentHash(item.sha256)) return item.sha256;
  const hash = await hashOfStoredFile(deps.storage, item.filename, {
    ...(typeof item.size === "number" ? { size: item.size } : {}),
    ...(deps.deadline === undefined ? {} : { deadline: deps.deadline }),
    ...(deps.clock === undefined ? {} : { clock: deps.clock }),
  });
  if (hash === null) return null;
  await deps.db.update(
    "media",
    { sha256: hash },
    {
      and: [
        { column: "id", op: "=", value: item.id },
        { column: "filename", op: "=", value: item.filename },
        { column: "sha256", op: "IS NULL" },
      ],
    }
  );
  return hash;
}
