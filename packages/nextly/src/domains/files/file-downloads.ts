/**
 * Opening a private file: the one checked download.
 *
 * Every way a private file leaves Nextly comes through here, the REST route
 * and the Direct API alike:
 *
 * 1. The entry is read **as the caller**, through the collection's checked
 *    read: its read rule, its database permissions, closed-to-super-admin,
 *    and for a signed-in person the rule alone. Refused, missing, and not yet
 *    `ready` are one answer, "not found", so a caller learns nothing of a file
 *    they may not open, nor whether it exists.
 * 2. The storage key is then read as trusted code: no caller ever reads it.
 * 3. The file is handed over as the collection's `delivery` says: its bytes
 *    as a stream, or a link to them that lasts at most a minute and answers
 *    as an attachment that no cache may keep.
 * 4. An audit row of kind `file.downloaded` names who opened which file,
 *    written before the file is handed over. Never the link or the key.
 *
 * @module domains/files/file-downloads
 * @experimental
 */
import { getService } from "../../di";
import { unwrapServiceResult } from "../../dispatcher/helpers/service-envelope";
import { NextlyError } from "../../errors/nextly-error";
import type { PrincipalRef } from "../../plugins/principals/types";
import { PRIVATE_DOWNLOAD_URL_MAX_SECONDS } from "../../storage/private-files";
import { getMediaStorage } from "../../storage/storage";
import { buildAuditLogWriter } from "../audit/audit-log-writer";

import { asFileCaller, fileCaller, type FileCaller } from "./file-caller";
import {
  checkedAs,
  collections,
  fileEntry,
  filesCollection,
} from "./file-uploads";

/** A private file, opened. */
export interface OpenedFile {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  /** How it is handed over: its bytes, or a short link to them. */
  delivery: "stream" | "redirect";
  /** The bytes, for `stream` delivery. */
  stream?: ReadableStream<Uint8Array>;
  /** A link lasting at most a minute, for `redirect` delivery. */
  url?: string;
}

/** Who opened a file, as the audit row names them. */
export type FileReader =
  | { type: "staff"; userId: string; apiKeyId?: string }
  | { type: "principal"; principal: PrincipalRef }
  /** Trusted server code reading without a caller (`overrideAccess: true`). */
  | { type: "system" };

/** The one refusal of a download, for a missing file and a refused one alike. */
function notFound(slug: string, reason: string): never {
  throw NextlyError.notFound({ logContext: { reason, collection: slug } });
}

/**
 * Open the file `id` of collection `slug`. `readChecked` reads the entry as
 * the caller, through the collection's checked read, and answers `null` when
 * the caller may not read it or it does not exist; it is the precondition,
 * asked before anything else is read or written. `reader` is who the audit
 * row names.
 */
export async function openFile(
  slug: string,
  id: string,
  readChecked: () => Promise<{ fileStatus?: unknown } | null>,
  reader: FileReader
): Promise<OpenedFile> {
  const { policy } = filesCollection(slug);
  const readable = await readChecked();
  if (readable === null || readable.fileStatus !== "ready") {
    notFound(slug, "file-not-readable-by-caller");
  }

  const entry = await fileEntry(slug, id);
  const key = entry?.storageKey;
  if (
    entry === null ||
    entry.fileStatus !== "ready" ||
    typeof key !== "string"
  ) {
    notFound(slug, "file-not-ready");
  }
  const files = getMediaStorage().getPrivateFiles(slug);
  const opened: OpenedFile = {
    id,
    filename: String(entry.filename),
    mimeType: String(entry.mimeType),
    size: Number(entry.size),
    delivery: policy.delivery,
  };
  if (policy.delivery === "redirect") {
    opened.url = await files.downloadUrl(key, {
      filename: opened.filename,
      contentType: opened.mimeType,
      expiresIn: PRIVATE_DOWNLOAD_URL_MAX_SECONDS,
    });
  } else {
    const stream = await files.readStream(key);
    if (stream === null) notFound(slug, "file-bytes-missing");
    opened.stream = stream;
  }

  await recordDownload(slug, id, policy.delivery, reader);
  return opened;
}

/** Who the audit row names for `caller`. */
function readerOf(caller: FileCaller): FileReader {
  if (caller.type === "principal") {
    return {
      type: "principal",
      principal: { kind: caller.principal.kind, id: caller.principal.id },
    };
  }
  return caller.uploader.kind === "apiKey"
    ? { type: "staff", userId: caller.userId, apiKeyId: caller.uploader.id }
    : { type: "staff", userId: caller.userId };
}

/**
 * Open file `id` of `slug` for the caller on `request`: staff, an API key by
 * its own scope, or a signed-in person of a kind the collection lists. The
 * entry is read as them through the collection's checked read; a refusal and
 * a missing entry are both `null`, and any other failure is itself.
 */
export async function openFileForRequest(
  request: Request,
  slug: string,
  id: string
): Promise<OpenedFile> {
  const { policy } = filesCollection(slug);
  const caller = await fileCaller(request, policy.principals);
  const readChecked = async (): Promise<{ fileStatus?: unknown } | null> => {
    const read = await asFileCaller(caller, () =>
      collections().getEntry({
        request,
        collectionName: slug,
        entryId: id,
        depth: 0,
        ...checkedAs(caller),
      })
    );
    if (read.success) return (read.data as { fileStatus?: unknown }) ?? null;
    if (read.statusCode === 403 || read.statusCode === 404) return null;
    return unwrapServiceResult(read, {
      reason: "file-entry-not-read",
      collection: slug,
    });
  };
  return openFile(slug, id, readChecked, readerOf(caller));
}

/** Write the `file.downloaded` row for `reader` opening file `id`. */
async function recordDownload(
  slug: string,
  id: string,
  delivery: "stream" | "redirect",
  reader: FileReader
): Promise<void> {
  const metadata: Record<string, unknown> = { collection: slug, id, delivery };
  const writer = buildAuditLogWriter(getService as (name: string) => unknown);
  if (reader.type === "principal") {
    await writer.write({
      kind: "file.downloaded",
      actorPrincipal: reader.principal,
      metadata,
    });
    return;
  }
  if (reader.type === "system") {
    await writer.write({
      kind: "file.downloaded",
      actorKind: "core",
      metadata,
    });
    return;
  }
  // An API key is named by its maker, as the audit log names every key's
  // action, with the key itself in the metadata.
  await writer.write({
    kind: "file.downloaded",
    actorKind: reader.apiKeyId === undefined ? "staff" : "apiKey",
    actorUserId: reader.userId,
    metadata:
      reader.apiKeyId === undefined
        ? metadata
        : { ...metadata, apiKeyId: reader.apiKeyId },
  });
}

/**
 * The headers every download answer carries: private to its caller and
 * stored by no cache, the browser's own included, so each later request
 * comes back through the checked route; never sniffed or rendered as a page
 * on the site's origin; and no referrer.
 */
export const DOWNLOAD_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "private, no-store",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "sandbox",
  "Referrer-Policy": "no-referrer",
};
