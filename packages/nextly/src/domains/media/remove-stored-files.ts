import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { WhereClause } from "@nextlyhq/adapter-drizzle/types";

import { isTransientError, withRetry } from "../../storage/retry";

import { storedFilesOf, type MediaFilesRecord } from "./stored-files";

/**
 * Removing a media item's stored files, once its record is gone: the one way
 * every delete does it, of one item or of a folder's.
 */

/** The storage surface removal uses: a delete by stored path, per collection. */
export interface StoredFileRemover {
  delete(filePath: string, collection?: string): Promise<void>;
}

/**
 * A stored path or URL as a log may show it: without the credentials before
 * a host, the query and the fragment, any of which a signed or tokenized URL
 * can carry. What is left still finds the file.
 */
export function storedPathForLog(pathOrUrl: string): string {
  const withoutQuery = pathOrUrl.replace(/[?#].*$/, "");
  // A stored path keeps its spelling; only a URL has credentials to drop.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(withoutQuery)) return withoutQuery;
  try {
    const url = new URL(withoutQuery);
    return `${url.origin}${url.pathname}`;
  } catch {
    return withoutQuery.replace(/\/\/[^/]*@/, "//");
  }
}

/**
 * What a storage failure said, as a log may show it: an error's message with
 * every URL in it shortened as {@link storedPathForLog} shortens one, and
 * nothing of a thrown value that is not an error, which can hold anything.
 */
export function errorForLog(error: unknown): string {
  if (!(error instanceof Error)) return "the storage failed without an error";
  return error.message.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, url =>
    storedPathForLog(url)
  );
}

/** A stored file that could not be removed, by its path, so it can be found. */
export function warnNotRemoved(
  filePath: string,
  mediaId: string,
  error: unknown
): void {
  console.warn(
    `[MediaService] Could not remove ${storedPathForLog(filePath)} of media ${mediaId}:`,
    errorForLog(error)
  );
}

/**
 * A thumbnail whose stored location the record does not show, by its URL,
 * the one identifier there is: nothing was removed in its place.
 */
export function warnUnlocated(url: string, mediaId: string): void {
  console.warn(
    `[MediaService] Left the thumbnail of media ${mediaId} at ${storedPathForLog(url)}: its stored location could not be worked out from the record.`
  );
}

/**
 * The media rows that may share a stored file with `records`: by the
 * original's stored path, or by a URL either names as its original or its
 * thumbnail. Nothing makes a stored path one item's alone, since an import
 * can copy a record and a content-addressed adapter gives one file one key.
 * Asked after the records' own rows are gone, so it finds only others.
 */
function rowsSharingFilesWith(
  records: readonly MediaFilesRecord[]
): WhereClause {
  const urls = [
    ...new Set(
      records.flatMap(record =>
        record.thumbnailUrl ? [record.url, record.thumbnailUrl] : [record.url]
      )
    ),
  ];
  return {
    or: [
      {
        column: "filename",
        op: "IN",
        value: [...new Set(records.map(record => record.filename))],
      },
      { column: "url", op: "IN", value: urls },
      { column: "thumbnailUrl", op: "IN", value: urls },
    ],
  };
}

/** The columns {@link storedFilesOf} reads, for a query that only needs them. */
const STORED_FILE_COLUMNS = ["filename", "url", "thumbnailUrl", "sizes"];

/** Every stored path the given rows refer to. */
function pathsReferencedBy(rows: readonly MediaFilesRecord[]): Set<string> {
  return new Set(rows.flatMap(row => storedFilesOf(row).paths));
}

/**
 * The stored files other media rows still refer to, of those `records` had:
 * what a removal of their files must keep. Asked once the change that left
 * the files unreferenced has committed, never inside it: two deletes of
 * copies at once, each reading inside its own transaction on PostgreSQL,
 * would each still see the other's row and both keep the files. Read after
 * its own commit, the later of the two finds the other row gone.
 */
export async function filesKeptByOthers(
  adapter: Pick<DrizzleAdapter, "select">,
  records: readonly MediaFilesRecord[]
): Promise<Set<string>> {
  if (records.length === 0) return new Set();
  return pathsReferencedBy(
    await adapter.select<MediaFilesRecord>("media", {
      columns: STORED_FILE_COLUMNS,
      where: rowsSharingFilesWith(records),
    })
  );
}

/**
 * Removes every file stored for a deleted item: the original, every image
 * size and the thumbnail made at upload, except any of them in `kept`, the
 * files another item still refers to. Each is removed on its own, retried
 * on a transient failure, so one that fails leaves the others to go, and is
 * named in the log with its item, so the leftover can be found. Never throws:
 * the record is already gone, and a storage failure must not fail its delete.
 */
export async function removeStoredFiles(
  storage: StoredFileRemover,
  record: MediaFilesRecord,
  mediaId: string,
  kept: ReadonlySet<string> = new Set()
): Promise<void> {
  const { paths, unlocated } = storedFilesOf(record);
  for (const url of unlocated) warnUnlocated(url, mediaId);
  await Promise.all(
    paths
      .filter(filePath => !kept.has(filePath))
      .map(async filePath => {
        try {
          await withRetry(() => storage.delete(filePath, "media"), {
            maxAttempts: 3,
            baseDelayMs: 500,
            shouldRetry: isTransientError,
            onRetry: (err, attempt) => {
              console.warn(
                `[MediaService] Delete retry ${attempt} for ${storedPathForLog(filePath)}:`,
                errorForLog(err)
              );
            },
          });
        } catch (error) {
          warnNotRemoved(filePath, mediaId, error);
        }
      })
  );
}
