import { like, or, sql, type AnyColumn, type SQL } from "drizzle-orm";

import { isTransientError, withRetry } from "../../storage/retry";

import { canonicalStoredPath } from "./orphan-thumbnails";
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
 * What a failure said, as a log may show it: an error's message with
 * every URL in it shortened as {@link storedPathForLog} shortens one, any
 * query parameter outside one dropped, and nothing of a thrown value that is
 * not an error, which can hold anything.
 */
export function errorForLog(error: unknown): string {
  if (!(error instanceof Error))
    return "a value that is not an error was thrown";
  return (
    error.message
      // Every URL, with a scheme or without one (`//host/...`).
      .replace(/(?:[a-z][a-z0-9+.-]*:)?\/\/[^\s"'<>]+/gi, url =>
        url.startsWith("//")
          ? storedPathForLog(`https:${url}`).slice(6)
          : storedPathForLog(url)
      )
      // A query outside a URL: every parameter after a `?` or `&`, and a
      // credential's own name anywhere (`X-Amz-Credential=...`, `token=...`).
      .replace(/[?&][^\s=&?#]+=[^\s&#]*/g, "")
      .replace(
        /\b(x-amz-[\w-]+|[\w-]*(?:token|signature|secret|password|credential|key|sig))=[^\s&"'<>]*/gi,
        "$1=[redacted]"
      )
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

/** The media columns a search for files another item refers to reads. */
export interface StoredFileColumns {
  filename: AnyColumn;
  url: AnyColumn;
  thumbnailUrl: AnyColumn;
  sizes: AnyColumn;
}

/** How a search for files another item refers to reads the media table. */
export interface StoredFileSearch {
  columns: StoredFileColumns;
  dialect: "postgresql" | "mysql" | "sqlite";
  /** The rows matching `where`, with the columns `storedFilesOf` reads. */
  read: (where: SQL) => Promise<MediaFilesRecord[]>;
}

/** Names searched per query, so a large folder's chunk stays one bounded statement each. */
const NAMES_PER_QUERY = 50;

/** A stored path's last segment, the part every spelling and URL of it ends in. */
function lastSegment(path: string): string {
  const located = canonicalStoredPath(path).replace(/[?#].*$/, "");
  return located.slice(located.lastIndexOf("/") + 1);
}

/** `char` as a `like` pattern matches it in JSON text: itself, or anything. */
function widenedForJson(char: string): string {
  return char === "\\" || char === '"' || char.charCodeAt(0) < 0x20
    ? "%"
    : char;
}

/**
 * Rows that may refer to a file named `names`: any of whose stored path,
 * URLs or sizes holds one of them, read as text. Wider than the rows that do
 * (`_` is a wildcard here, and a name can occur in another), never narrower,
 * which is what a search for what to keep needs; the caller decides by path.
 */
function mayReferTo(search: StoredFileSearch, names: readonly string[]): SQL {
  const { columns, dialect } = search;
  // The sizes column is JSON on PostgreSQL and MySQL, which `like` cannot
  // read as it is; it is read as its text.
  const sizesText =
    dialect === "postgresql"
      ? sql`${columns.sizes}::text`
      : dialect === "mysql"
        ? sql`cast(${columns.sizes} as char)`
        : sql`${columns.sizes}`;
  const conditions = names.flatMap(name => {
    // A character JSON escapes (a backslash, a double quote, a control
    // character) is written otherwise in the sizes text, and a backslash is
    // `like`'s own escape: each matches anything here, which only widens
    // the rows found.
    const pattern = `%${Array.from(name, widenedForJson).join("")}%`;
    return [
      like(columns.filename, pattern),
      like(columns.url, pattern),
      like(columns.thumbnailUrl, pattern),
      sql`${sizesText} like ${pattern}`,
    ];
  });
  return or(...conditions) ?? sql`false`;
}

/**
 * Of `paths`, the ones `rows` refer to, compared as stored paths are
 * (`canonicalStoredPath`): the one answer to "does an item refer to this
 * file" that the search for left-behind thumbnails also gives.
 *
 * A row's thumbnail whose stored location its record does not show (an
 * original spelled otherwise than its URL, say) cannot be compared by path;
 * a file whose name it ends in is taken as referred to, since nothing shows
 * it is not.
 */
export function pathsReferencedAmong(
  paths: readonly string[],
  rows: readonly MediaFilesRecord[]
): Set<string> {
  const referenced = new Set<string>();
  const unlocatedNames = new Set<string>();
  for (const row of rows) {
    const files = storedFilesOf(row);
    for (const path of files.paths) referenced.add(canonicalStoredPath(path));
    for (const url of files.unlocated) unlocatedNames.add(lastSegment(url));
  }
  return new Set(
    paths.filter(
      path =>
        referenced.has(canonicalStoredPath(path)) ||
        unlocatedNames.has(lastSegment(path))
    )
  );
}

/**
 * Of `paths`, the stored files another media item still refers to: what a
 * removal of them must keep. Nothing makes a stored path one item's alone,
 * since an import can copy a record and a content-addressed adapter gives
 * one file one key, and an item can refer to a file by its stored path, a
 * URL or one of its sizes, in any of the spellings a storage reads as one.
 *
 * Asked once the change that left the files unreferenced has committed,
 * never inside it: two deletes of copies at once, each reading inside its
 * own transaction on PostgreSQL, would each still see the other's row and
 * both keep the files. Read after its own commit, the later of the two finds
 * the other row gone.
 *
 * `null` when the media table could not be read: then nothing shows any of
 * the files is unreferenced, and none is to be removed. Named in the log,
 * never thrown, since the change it follows has committed.
 */
export async function filesKeptByOthers(
  search: StoredFileSearch,
  paths: readonly string[],
  mediaIds: readonly string[]
): Promise<Set<string> | null> {
  const names = [...new Set(paths.map(lastSegment).filter(Boolean))];
  try {
    const rows: MediaFilesRecord[] = [];
    for (let i = 0; i < names.length; i += NAMES_PER_QUERY) {
      rows.push(
        ...(await search.read(
          mayReferTo(search, names.slice(i, i + NAMES_PER_QUERY))
        ))
      );
    }
    return pathsReferencedAmong(paths, rows);
  } catch (error) {
    console.warn(
      mediaIds.length > 0
        ? `[MediaService] Left the files of media ${mediaIds.join(", ")}: could not check whether another item refers to them:`
        : `[MediaService] Left ${paths.map(storedPathForLog).join(", ")}: could not check whether a media item refers to them:`,
      errorForLog(error)
    );
    return null;
  }
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
