/**
 * Uploading a private file: start, then confirm.
 *
 * **Start** checks the caller may create an entry in the collection, by the
 * one access decision, as the caller; judges what the file claims to be
 * against the collection's own `files` policy; records the entry as pending
 * with the file's own fields; and answers a short link the browser sends the
 * bytes to, straight to storage. Nothing is written before the claim is
 * judged and the caller is recognised.
 *
 * **Confirm** is the only way a file becomes `ready`: only the caller who
 * started the upload may ask, within the collection's wait, and the bytes
 * storage holds are read back and checked, their size against the claim and
 * their content against the claimed type. Bytes that fail are deleted and the
 * entry is marked `rejected` with why. Confirming a ready file again answers
 * as the first confirm did.
 *
 * The routes and their answers are in `api/file-routes.ts`.
 *
 * @module domains/files/file-uploads
 * @experimental
 */
import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import {
  resolveFilesPolicy,
  type CollectionFilesConfig,
  type FilesPolicy,
} from "../../collections/config/collection-files";
import { container } from "../../di/container";
import { unwrapServiceResult } from "../../dispatcher/helpers/service-envelope";
import { NextlyError } from "../../errors/nextly-error";
import type { CollectionsHandler } from "../../services/collections-handler";
import { isBlockedExtension } from "../../services/upload-validation/extensions";
import { validateFilename } from "../../services/upload-validation/filename";
import { detectAndCompareMime } from "../../services/upload-validation/magic-bytes";
import {
  canonicalMimeType,
  DEFAULT_ACCEPTED_FORMATS,
} from "../../services/upload-validation/mime";
import type { PrivateFileStore } from "../../storage/private-files";
import { isStorageReadTooLarge } from "../../storage/read-errors";
import { getMediaStorage } from "../../storage/storage";

import {
  asFileCaller,
  fileCaller,
  isUploader,
  type FileCaller,
} from "./file-caller";

/** How long an upload link lasts, in seconds: the storage layer's own cap. */
export const UPLOAD_LINK_SECONDS = 300;

/** What a start request may carry. */
export const startUploadBody: z.ZodType<StartUploadBody> = z
  .object({
    filename: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(255),
    size: z.number().int().positive(),
    /** The app's own fields for the entry, judged by its field rules. */
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

/** A start request, as {@link startUploadBody} accepts it. */
export interface StartUploadBody {
  filename: string;
  mimeType: string;
  size: number;
  data?: Record<string, unknown>;
}

/** The collection whose files are asked for, and its policy. */
interface FilesCollection {
  slug: string;
  policy: FilesPolicy;
}

/**
 * The collection `slug` and its `files` policy, or "not found" for a slug
 * that names no collection with files: the same answer a missing file gets,
 * so the routes do not say which collections exist.
 */
function filesCollection(slug: string): FilesCollection {
  const config = container.get<{
    collections?: ReadonlyArray<{
      slug: string;
      files?: CollectionFilesConfig;
    }>;
  }>("config");
  const found = (config.collections ?? []).find(
    collection => collection.slug === slug && collection.files !== undefined
  );
  if (found?.files === undefined) {
    throw NextlyError.notFound({
      logContext: { reason: "not-a-files-collection", collection: slug },
    });
  }
  return { slug, policy: resolveFilesPolicy(found.files) };
}

function collections(): CollectionsHandler {
  return container.get<CollectionsHandler>("collectionsHandler");
}

/** A refusal of what an upload claims, naming what is wrong with it. */
function refuseClaim(code: string, message: string, collection: string): never {
  throw NextlyError.validation({
    errors: [{ path: "file", code, message }],
    logContext: { reason: "file-claim-refused", collection, code },
  });
}

/**
 * The claim, judged against the collection's policy before anything is
 * written: a plain file name with no blocked extension, a type the collection
 * accepts, and a size within its limit. Where the type is one Nextly knows
 * the extensions of, the name must carry one of them, so a file saved under
 * its name opens as what it was checked to be.
 */
function judgeClaim(
  body: StartUploadBody,
  { slug, policy }: FilesCollection
): { filename: string; mimeType: string; size: number } {
  const filename = body.filename.trim();
  if (!validateFilename(filename).ok || isBlockedExtension(filename)) {
    refuseClaim("FILE_NAME_INVALID", "The file name is not allowed.", slug);
  }
  const mimeType = canonicalMimeType(body.mimeType);
  if (!policy.accept.includes(mimeType)) {
    refuseClaim(
      "FILE_TYPE_NOT_ACCEPTED",
      "This type of file is not accepted here.",
      slug
    );
  }
  const known = DEFAULT_ACCEPTED_FORMATS.find(
    format => format.mimeType === mimeType
  );
  const lower = filename.toLowerCase();
  if (known && !known.extensions.some(extension => lower.endsWith(extension))) {
    refuseClaim(
      "FILE_NAME_TYPE_MISMATCH",
      "The file name's extension does not match its type.",
      slug
    );
  }
  if (body.size > policy.maxSize) {
    refuseClaim("FILE_TOO_LARGE", "The file is larger than allowed.", slug);
  }
  return { filename, mimeType, size: body.size };
}

/** The services' options for a checked write or read made as `caller`. */
function checkedAs(caller: FileCaller): {
  overrideAccess: false;
  user?: FileCallerUser;
  authenticatedScope?: FileCallerScope;
  actor?: FileCallerActor;
} {
  return caller.type === "staff"
    ? {
        overrideAccess: false,
        user: caller.read.user,
        ...(caller.read.authenticatedScope
          ? { authenticatedScope: caller.read.authenticatedScope }
          : {}),
        actor: caller.actor,
      }
    : { overrideAccess: false };
}

type StaffCaller = Extract<FileCaller, { type: "staff" }>;
type FileCallerUser = StaffCaller["read"]["user"];
type FileCallerScope = NonNullable<StaffCaller["read"]["authenticatedScope"]>;
type FileCallerActor = StaffCaller["actor"];

/** A trusted write of a file's own fields, which no caller may make. */
export async function writeFileFields(
  slug: string,
  id: string,
  fields: Record<string, unknown>
): Promise<void> {
  unwrapServiceResult(
    await collections().updateEntry(
      {
        collectionName: slug,
        entryId: id,
        overrideAccess: true,
        depth: 0,
        disableRevalidate: true,
      },
      { ...fields, _overwrite: true }
    ),
    { reason: "file-fields-not-written", collection: slug }
  );
}

/** What a start answers: the new entry's id and where to send the bytes. */
export interface StartedUpload {
  id: string;
  upload: {
    url: string;
    method: "PUT" | "POST";
    headers: Record<string, string>;
    expiresAt: string;
  };
}

/**
 * Start an upload to `slug` for the caller on `request`. The caller is
 * recognised and the claim judged first; the entry is then created as the
 * caller, by the collection's create rule and field rules, and given the
 * file's own fields by trusted code; the link last.
 */
export async function startUpload(
  request: Request,
  slug: string,
  body: StartUploadBody
): Promise<StartedUpload> {
  const collection = filesCollection(slug);
  const caller = await fileCaller(request, collection.policy.principals);
  const claim = judgeClaim(body, collection);
  const files = getMediaStorage().getPrivateFiles(slug);

  const data = body.data ?? {};
  const created = unwrapServiceResult<{ id: unknown }>(
    await asFileCaller(caller, () =>
      collections().createEntry(
        {
          request,
          collectionName: slug,
          depth: 0,
          // A private file has no public page whose cache a write expires.
          disableRevalidate: true,
          ...checkedAs(caller),
        },
        {
          ...data,
          // An entry needs a title and an address of its own. Neither is the
          // storage key, which no caller ever learns.
          title: data.title ?? claim.filename,
          slug: data.slug ?? `file-${randomUUID()}`,
        }
      )
    ),
    { reason: "file-entry-not-created", collection: slug }
  );
  const id = String(created.id);

  const key = files.newKey();
  await writeFileFields(slug, id, {
    filename: claim.filename,
    mimeType: claim.mimeType,
    size: claim.size,
    storageKey: key,
    // Kept after the file is confirmed or rejected, until the link expires:
    // bytes sent through it late land here, and are removed from here.
    uploadKey: key,
    fileStatus: "pending",
    uploadedByKind: caller.uploader.kind,
    uploadedById: caller.uploader.id,
  });
  const link = await files.uploadUrl(key, {
    mimeType: claim.mimeType,
    size: claim.size,
    expiresIn: UPLOAD_LINK_SECONDS,
  });
  return {
    id,
    upload: {
      url: link.uploadUrl,
      method: link.method,
      headers: link.headers ?? {},
      expiresAt: link.expiresAt.toISOString(),
    },
  };
}

/** An entry of a files collection, as trusted code reads it. */
interface FileEntry {
  id: string;
  filename?: unknown;
  mimeType?: unknown;
  size?: unknown;
  storageKey?: unknown;
  uploadKey?: unknown;
  fileStatus?: unknown;
  uploadedByKind?: unknown;
  uploadedById?: unknown;
  createdAt?: unknown;
}

/** The entry `id` of `slug` as trusted code reads it, or `null`. */
async function fileEntry(slug: string, id: string): Promise<FileEntry | null> {
  const found = await collections().getEntry({
    collectionName: slug,
    entryId: id,
    overrideAccess: true,
    depth: 0,
  });
  if (!found.success) {
    if (found.statusCode === 404) return null;
    unwrapServiceResult(found, {
      reason: "file-entry-not-read",
      collection: slug,
    });
  }
  return (found.data as FileEntry | null) ?? null;
}

/** The one refusal for an upload that is missing or not the caller's. */
function uploadNotFound(slug: string, reason: string): never {
  throw NextlyError.notFound({
    logContext: { reason, collection: slug },
  });
}

/** What a confirm answers about a ready file. Never where it is stored. */
export interface ConfirmedUpload {
  id: string;
  fileStatus: "ready";
  filename: string;
  mimeType: string;
  size: number;
}

function confirmed(entry: FileEntry): ConfirmedUpload {
  return {
    id: entry.id,
    fileStatus: "ready",
    filename: String(entry.filename),
    mimeType: String(entry.mimeType),
    size: Number(entry.size),
  };
}

/** Why a file was refused, as its entry records it and the uploader is told. */
type RejectReason =
  | "abandoned"
  | "size-mismatch"
  | "type-mismatch"
  | "already-rejected";

const REJECTED_MESSAGE: Record<RejectReason, string> = {
  abandoned: "The upload was not confirmed in time.",
  "size-mismatch": "The file's size is not the size it claimed.",
  "type-mismatch": "The file's content is not the type it claimed.",
  "already-rejected": "The file was rejected.",
};

/** The refusal an uploader gets for a rejected file. */
function rejectedError(slug: string, reason: RejectReason): NextlyError {
  return NextlyError.validation({
    errors: [
      {
        path: "file",
        code: "FILE_REJECTED",
        message: REJECTED_MESSAGE[reason],
      },
    ],
    logContext: { reason: "file-rejected", collection: slug, why: reason },
  });
}

/**
 * Reject the file: delete its bytes, then mark the entry `rejected` with
 * why, so a file is never left counted with bytes that failed. Deleting
 * bytes that are not there is not an error.
 */
export async function rejectFile(
  files: PrivateFileStore,
  slug: string,
  entry: FileEntry,
  reason: RejectReason
): Promise<void> {
  if (typeof entry.storageKey === "string" && files.owns(entry.storageKey)) {
    await files.delete(entry.storageKey);
  }
  await writeFileFields(slug, entry.id, {
    fileStatus: "rejected",
    rejectReason: reason,
  });
}

/** Whether an upload that started at `createdAt` has waited past `seconds`. */
function waitedTooLong(createdAt: unknown, seconds: number): boolean {
  const started = new Date(String(createdAt)).getTime();
  return !Number.isFinite(started) || Date.now() - started > seconds * 1000;
}

/** The bytes of `key`, read with the collection's own size as the limit. */
async function storedBytes(
  files: PrivateFileStore,
  key: string,
  maxSize: number
): Promise<Buffer | "too-large" | null> {
  try {
    return await files.read(key, { maxBytes: maxSize });
  } catch (error) {
    if (isStorageReadTooLarge(error)) return "too-large";
    throw error;
  }
}

/**
 * Confirm the upload `id` of `slug` for the caller on `request`. Only the
 * caller who started it may; anyone else, and an id with no upload, are
 * answered "not found" alike.
 */
export async function completeUpload(
  request: Request,
  slug: string,
  id: string
): Promise<ConfirmedUpload> {
  const collection = filesCollection(slug);
  const caller = await fileCaller(request, collection.policy.principals);
  const entry = await fileEntry(slug, id);
  if (
    entry === null ||
    !isUploader(caller, {
      kind: entry.uploadedByKind,
      id: entry.uploadedById,
    })
  ) {
    uploadNotFound(slug, "upload-not-found-for-caller");
  }

  if (entry.fileStatus === "ready") return confirmed(entry);
  if (entry.fileStatus === "rejected") {
    throw rejectedError(slug, "already-rejected");
  }

  const files = getMediaStorage().getPrivateFiles(slug);
  const key = String(entry.storageKey);
  if (waitedTooLong(entry.createdAt, collection.policy.pendingTimeout)) {
    await rejectFile(files, slug, entry, "abandoned");
    throw rejectedError(slug, "abandoned");
  }

  const head = await files.head(key);
  if (head === null) {
    // Nothing has arrived yet: the entry stays pending, so the browser may
    // send the bytes and confirm again within the wait.
    throw NextlyError.validation({
      errors: [
        {
          path: "file",
          code: "FILE_NOT_UPLOADED",
          message: "No file has been received for this upload yet.",
        },
      ],
      logContext: { reason: "file-not-uploaded", collection: slug },
    });
  }
  const claimedSize = Number(entry.size);
  if (head.size !== claimedSize) {
    await rejectFile(files, slug, entry, "size-mismatch");
    throw rejectedError(slug, "size-mismatch");
  }
  const bytes = await storedBytes(files, key, collection.policy.maxSize);
  if (bytes === null) uploadNotFound(slug, "upload-bytes-vanished");
  if (bytes === "too-large" || bytes.length !== claimedSize) {
    await rejectFile(files, slug, entry, "size-mismatch");
    throw rejectedError(slug, "size-mismatch");
  }
  const content = await detectAndCompareMime(bytes, String(entry.mimeType));
  if (!content.ok) {
    await rejectFile(files, slug, entry, "type-mismatch");
    throw rejectedError(slug, "type-mismatch");
  }

  // The checked bytes are kept under a key of their own, which the upload
  // link cannot write: the link stays usable until it expires, and a second
  // PUT through it must never replace a file already confirmed. The entry is
  // pointed at the new key before the upload's own object is removed.
  const finalKey = files.newKey();
  await files.put(finalKey, bytes, { mimeType: String(entry.mimeType) });
  await writeFileFields(slug, entry.id, {
    fileStatus: "ready",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    storageKey: finalKey,
  });
  await files.delete(key);
  return confirmed(entry);
}
