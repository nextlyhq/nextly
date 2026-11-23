/**
 * Storage for a collection's private files: files no public address ever
 * serves, reached only through Nextly.
 *
 * A private file differs from a media file in what its storage may do, so it
 * has its own small surface rather than flags on `upload`:
 *
 * - **The key is core's.** `files/<collection>/<uuid>` (or the collection's
 *   configured prefix), never the uploaded file's name, which can carry a
 *   person's name. Every call checks the key is one this store made for its
 *   own collection, so one collection's files cannot be reached through
 *   another's.
 * - **No public address is formed.** The adapter's private calls write the
 *   object as private and never cached, and keep the original name nowhere.
 * - **Links are short.** An upload link lasts at most
 *   {@link PRIVATE_UPLOAD_URL_MAX_SECONDS}, a download link at most
 *   {@link PRIVATE_DOWNLOAD_URL_MAX_SECONDS}, whatever is asked.
 *
 * Who may upload or download is not decided here: the store is the storage
 * half, used by the checked routes after the caller's access is decided.
 *
 * @module storage/private-files
 * @experimental
 */
import { randomUUID } from "node:crypto";

import { NextlyError } from "../errors/nextly-error";

import type {
  ClientUploadData,
  IStorageAdapter,
  StorageReadOptions,
  StorageStreamOptions,
  StoredObjectHead,
} from "./types";

/** The longest a private file's upload link lasts, in seconds. */
export const PRIVATE_UPLOAD_URL_MAX_SECONDS = 300;

/** The longest a private file's download link lasts, in seconds. */
export const PRIVATE_DOWNLOAD_URL_MAX_SECONDS = 60;

/** The calls a storage needs to keep a collection's files private. */
type PrivateCalls =
  | "getInfo"
  | "head"
  | "read"
  | "readStream"
  | "putPrivate"
  | "getPrivateUploadUrl"
  | "getPrivateDownloadUrl";

/**
 * A storage that keeps files private: it says so, and it has every call the
 * private-file routes use.
 *
 * @experimental
 */
export type PrivateFileStorage = IStorageAdapter &
  Required<Pick<IStorageAdapter, PrivateCalls>>;

/**
 * Whether `adapter` can hold a collection's private files. Both halves are
 * needed: the calls, and the adapter's own word that, as configured, nothing
 * public serves what they write (an S3 bucket behind a public URL has the
 * calls and is still public). One answer for everything that asks, so the
 * routing and the boot checks cannot disagree.
 *
 * @experimental
 */
export function keepsFilesPrivate(
  adapter: IStorageAdapter | null | undefined
): adapter is PrivateFileStorage {
  if (adapter === null || adapter === undefined) return false;
  return (
    adapter.getInfo?.().supportsPrivateFiles === true &&
    typeof adapter.head === "function" &&
    typeof adapter.read === "function" &&
    typeof adapter.readStream === "function" &&
    typeof adapter.putPrivate === "function" &&
    typeof adapter.getPrivateUploadUrl === "function" &&
    typeof adapter.getPrivateDownloadUrl === "function"
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The folder a collection's private files go under, ending in one slash: the
 * configured prefix when there is one, else `files/<collection>/`. Trimmed by
 * a loop rather than a pattern, so a long run of slashes costs nothing.
 */
function privatePrefix(collection: string, configured?: string): string {
  let end = configured?.length ?? 0;
  while (end > 0 && configured?.[end - 1] === "/") end--;
  const folder = configured?.slice(0, end) ?? "";
  return folder === "" ? `files/${collection}/` : `${folder}/`;
}

/**
 * A name that is safe inside a quoted header value: printable ASCII with no
 * quote or backslash. Everything else becomes `_`, so the plain `filename`
 * is always well formed; the exact name travels in `filename*`.
 */
function asciiFilename(name: string): string {
  let out = "";
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0;
    const printable = code >= 0x20 && code < 0x7f;
    out += printable && char !== '"' && char !== "\\" ? char : "_";
  }
  return out;
}

/**
 * The Content-Disposition a private file is answered with: always an
 * attachment, so a browser saves it rather than rendering it on the site's
 * own origin, with the name both plain and RFC 5987-encoded (RFC 6266). Only
 * the last path segment is kept. One spelling for every way a file is handed
 * over, the stream and the short link alike.
 *
 * @experimental
 */
export function attachmentDisposition(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? "";
  const name = base === "" ? "file" : base;
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    char => `%${(char.codePointAt(0) ?? 0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="${asciiFilename(name)}"; filename*=UTF-8''${encoded}`;
}

/** Runs a write and records its outcome for System health. */
export type RecordWrite = <T>(write: () => Promise<T>) => Promise<T>;

/**
 * One collection's private files in its storage.
 *
 * Get one from `MediaStorage.getPrivateFiles(collection)`, which refuses a
 * collection whose storage cannot keep files private. Every call takes only a
 * key the store made for its own collection ({@link PrivateFileStore.owns}),
 * and refuses any other before storage is asked anything.
 *
 * @experimental
 */
export interface PrivateFileStore {
  /** The collection whose files this store holds. */
  readonly collection: string;
  /** The folder this collection's files are kept under, ending in a slash. */
  readonly prefix: string;
  /** A new key for a file of this collection: its folder and a random id. */
  newKey(): string;
  /** Whether `key` is one this store makes: its folder, then a bare id. */
  owns(key: string): boolean;
  /** Store `bytes` as the private file at `key`. */
  put(key: string, bytes: Buffer, options: { mimeType: string }): Promise<void>;
  /**
   * A link a browser sends exactly `options.size` bytes of `options.mimeType`
   * to, at `key`. It lasts `options.expiresIn` seconds, at most
   * {@link PRIVATE_UPLOAD_URL_MAX_SECONDS}.
   */
  uploadUrl(
    key: string,
    options: { mimeType: string; size: number; expiresIn?: number }
  ): Promise<ClientUploadData>;
  /**
   * A link that answers the file at `key` as an attachment named
   * `options.filename`, lasting `options.expiresIn` seconds, at most
   * {@link PRIVATE_DOWNLOAD_URL_MAX_SECONDS}. Hand it only to a caller whose
   * access to the file was just checked: until it expires, it is a bearer
   * link.
   */
  downloadUrl(
    key: string,
    options: { filename: string; contentType?: string; expiresIn?: number }
  ): Promise<string>;
  /** The stored file's size and type, or `null` when it is not there. */
  head(key: string): Promise<StoredObjectHead | null>;
  /** The stored file's bytes, or `null` when it is not there. */
  read(key: string, options?: StorageReadOptions): Promise<Buffer | null>;
  /** The stored file as a stream, or `null` when it is not there. */
  readStream(
    key: string,
    options?: StorageStreamOptions
  ): Promise<ReadableStream<Uint8Array> | null>;
  /** Remove the stored file; removing one that is not there is not an error. */
  delete(key: string): Promise<void>;
}

/**
 * The store for `collection`'s private files in `adapter`. Its writes go
 * through `options.recordWrite`, so they are recorded for System health as
 * every other storage write is.
 *
 * @experimental
 */
export function privateFileStore(
  collection: string,
  adapter: PrivateFileStorage,
  options: { prefix?: string; recordWrite: RecordWrite }
): PrivateFileStore {
  const prefix = privatePrefix(collection, options.prefix);
  const owns = (key: string): boolean =>
    key.startsWith(prefix) && UUID.test(key.slice(prefix.length));
  /*
   * Refuse a key this store did not make, before storage is asked anything:
   * a key from another collection, or one carrying a path of its own, is a
   * defect in the caller and must never reach another collection's files.
   */
  const owned = (key: string): string => {
    if (owns(key)) return key;
    throw NextlyError.internal({
      logContext: { reason: "private-file-key-outside-collection", collection },
    });
  };
  return {
    collection,
    prefix,
    newKey: () => `${prefix}${randomUUID()}`,
    owns,
    put: async (key, bytes, { mimeType }) => {
      owned(key);
      await options.recordWrite(() =>
        adapter.putPrivate(key, bytes, { mimeType })
      );
    },
    uploadUrl: async (key, { mimeType, size, expiresIn }) =>
      adapter.getPrivateUploadUrl(owned(key), mimeType, {
        contentLength: size,
        expiresIn: capSeconds(expiresIn, PRIVATE_UPLOAD_URL_MAX_SECONDS),
      }),
    downloadUrl: async (key, { filename, contentType, expiresIn }) =>
      adapter.getPrivateDownloadUrl(owned(key), {
        expiresIn: capSeconds(expiresIn, PRIVATE_DOWNLOAD_URL_MAX_SECONDS),
        contentDisposition: attachmentDisposition(filename),
        ...(contentType !== undefined ? { contentType } : {}),
      }),
    head: async key => adapter.head(owned(key)),
    read: async (key, readOptions) => adapter.read(owned(key), readOptions),
    readStream: async (key, streamOptions) =>
      adapter.readStream(owned(key), streamOptions),
    delete: async key => {
      owned(key);
      await options.recordWrite(() => adapter.delete(key));
    },
  };
}

/**
 * A link's lifetime: what was asked, no longer than `longest`, and at least a
 * second. An absent or non-finite ask gets the longest.
 */
function capSeconds(asked: number | undefined, longest: number): number {
  if (asked === undefined || !Number.isFinite(asked)) return longest;
  return Math.max(1, Math.min(Math.floor(asked), longest));
}
