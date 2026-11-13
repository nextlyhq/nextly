/**
 * `POST /api/forms/:slug/upload`: a visitor's file, for one file field of an
 * open form, before the form is submitted.
 *
 * A file answer in a submission names media ids. The route stores the file
 * in the media library (as the plugin itself; a visitor holds no media
 * permission) and records the upload (`form-uploads`): which form and field
 * it was made for, and, once a submission names it, that submission. A
 * submission a request writes may then name only uploads recorded here for
 * its own form and field that no other submission claimed
 * (`handlers/upload-claims`), so the files a submission holds are its own,
 * and are deleted with it.
 *
 * Refused unless the form exists and is open now (the reading `GET
 * /api/forms/:slug` and submitting make), the named field is one of its file
 * fields, and the file is one the field takes: its types (`accept`, or the
 * plugin's `uploads.allowedMimeTypes`), and its size (`maxFileSize`, never
 * above the plugin's `uploads.maxFileSize`). The body is read only up to that
 * ceiling, so an oversized request is refused without being held in memory.
 * The media library then judges the file as it judges every upload: its
 * contents against its claimed type, blocked types, and its name. Its type
 * is checked against the field again on what the library stored.
 *
 * Limited per visitor and form, in the window submissions are, at
 * {@link UPLOADS_PER_SUBMISSION} times their number: a form may have several
 * file fields, each taking several files. An upload no submission claims is
 * deleted after a day.
 *
 * @module routes/form-upload
 */
import {
  NextlyError,
  respondAction,
  trustedClientIp,
  type PluginRoute,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import { z } from "zod";

import { FORM_UPLOADS_SLUG } from "../collections/uploads";
import { countAgainstLimit } from "../handlers/spam-detection";
import type { ResolvedFormBuilderConfig } from "../types";
import {
  acceptPatternsOf,
  fileMatchesAccept,
  readableBytes,
  safeUploadName,
  uploadLimitOf,
} from "../utils/upload-rules";

import { formAt, noSuchForm, type PublicForm } from "./public-forms";

/** How many uploads a visitor may make per submission the limit allows. */
const UPLOADS_PER_SUBMISSION = 5;

/** Room in a request body for the multipart framing and the field's name. */
const MULTIPART_OVERHEAD = 64 * 1024;

/** What a visitor is told about a file of a type the field does not take. */
const TYPE_REFUSED = "This type of file is not accepted here.";

/** A file field of a form, as the form stores it. */
interface FileField {
  type: "file";
  name: string;
  accept?: unknown;
  maxFileSize?: unknown;
}

/** The multipart body's text part: which field the file is for. */
const UPLOAD_PARTS = z.object({ field: z.string().trim().min(1).max(200) });

/** A refusal of the request's `path` part, as a validation error. */
function refusal(path: string, code: string, message: string, log = {}) {
  return NextlyError.validation({
    errors: [{ path, code, message }],
    logContext: log,
  });
}

function tooLarge(limit: number): NextlyError {
  return refusal(
    "file",
    "SIZE_EXCEEDED",
    `This file is too large. The limit is ${readableBytes(limit)}.`
  );
}

/** The form at `slug` if it takes submissions now, refused as submit is. */
async function openFormAt(
  slug: string,
  ctx: PluginRouteContext,
  config: ResolvedFormBuilderConfig
): Promise<PublicForm & { id: string }> {
  const { doc, availability } = await formAt(slug, ctx, config);
  if (availability.kind === "closed") {
    throw NextlyError.conflict({
      reason: "state",
      message: availability.message,
      logContext: { entity: "form", slug, reason: "closed" },
    });
  }
  if (availability.kind !== "open" || typeof doc?.id !== "string") {
    throw noSuchForm(slug);
  }
  return doc as PublicForm & { id: string };
}

/**
 * Count this upload against the visitor's limit for the form, refusing one
 * over it. A visitor whose address cannot be trusted is not limited, as
 * their submissions are not: one shared window for every such visitor would
 * let the first bot lock out everyone behind an untrusted proxy.
 */
async function holdUploadRate(
  req: Request,
  formId: string,
  config: ResolvedFormBuilderConfig
): Promise<void> {
  const limit = config.spamProtection.rateLimit;
  const ip = trustedClientIp(req);
  if (!limit || !ip) return;
  const result = await countAgainstLimit(
    `form-upload:${formId}:${ip}`,
    limit.maxSubmissions * UPLOADS_PER_SUBMISSION,
    limit.windowMs
  );
  if (result.allowed) return;
  throw NextlyError.rateLimited({
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((result.resetAt.getTime() - Date.now()) / 1000)
    ),
    logContext: { formId, reason: "form-upload-rate" },
  });
}

/**
 * The request body, read to `max` bytes and no further: a body past it is
 * refused, and its stream cancelled, before it is held whole.
 */
async function readCapped(req: Request, max: number): Promise<Buffer> {
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks);
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw tooLarge(max - MULTIPART_OVERHEAD);
    }
    chunks.push(value);
  }
}

/** The multipart body, refused when it is not one or is larger than `limit`. */
async function readUploadBody(req: Request, limit: number): Promise<FormData> {
  const max = limit + MULTIPART_OVERHEAD;
  const declared = Number(req.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > max) throw tooLarge(limit);
  const type = req.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("multipart/form-data")) {
    throw refusal("file", "INVALID", "Send the file as multipart form data.");
  }
  const bytes = await readCapped(req, max);
  try {
    return await new Response(new Uint8Array(bytes), {
      headers: { "content-type": type },
    }).formData();
  } catch {
    throw refusal("file", "INVALID", "The upload could not be read.");
  }
}

/** The form's file field named `name`, or a refusal naming `field`. */
function fileFieldOf(form: PublicForm, name: unknown): FileField {
  const parsed = UPLOAD_PARTS.safeParse({ field: name });
  const fields = Array.isArray(form.fields) ? (form.fields as unknown[]) : [];
  const found = parsed.success
    ? fields.find(field => {
        const candidate = (field ?? {}) as Partial<FileField>;
        return (
          candidate.type === "file" && candidate.name === parsed.data.field
        );
      })
    : undefined;
  if (!found) {
    throw refusal(
      "field",
      "INVALID",
      "This form has no file field by that name."
    );
  }
  return found as FileField;
}

/** The one file the body carries, or a refusal. */
function theFile(body: FormData): File {
  const parts = body.getAll("file");
  const [file] = parts;
  if (parts.length !== 1 || typeof file === "string" || !file) {
    throw refusal("file", "MISSING_FIELD", "Choose one file to upload.");
  }
  if (file.size === 0) {
    throw refusal("file", "INVALID", "This file is empty.");
  }
  return file;
}

/** Whether this install lets visitors upload files at all. */
function uploadsEnabled(config: ResolvedFormBuilderConfig): boolean {
  return config.features.fileUploads !== false && config.fields.file !== false;
}

/** Delete a stored file the upload then refused; one already gone is fine. */
async function discard(
  ctx: PluginRouteContext,
  mediaId: string
): Promise<void> {
  try {
    await ctx.services.media.delete(mediaId, { as: "system" });
  } catch (error) {
    if (!NextlyError.isNotFound(error)) throw error;
  }
}

/** Store the file, judged by the field again on the type the library kept. */
async function storeFile(
  ctx: PluginRouteContext,
  file: File,
  patterns: readonly string[]
) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const stored = await ctx.services.media.upload(
    {
      buffer,
      filename: safeUploadName(file.name),
      mimeType: file.type,
      size: buffer.length,
    },
    { as: "system" }
  );
  const kept = { name: stored.originalFilename, type: stored.mimeType };
  if (!fileMatchesAccept(kept, patterns)) {
    await discard(ctx, stored.id);
    throw refusal("file", "INVALID_TYPE", TYPE_REFUSED, {
      mimeType: stored.mimeType,
    });
  }
  return stored;
}

/** Record the upload, or take its file back when it cannot be recorded. */
async function recordUpload(
  ctx: PluginRouteContext,
  upload: { media: string; form: string; field: string }
): Promise<void> {
  const slug = ctx.self.collections[FORM_UPLOADS_SLUG] ?? FORM_UPLOADS_SLUG;
  try {
    await ctx.services.collections.createEntry(slug, {
      ...upload,
      submission: null,
    });
  } catch (error) {
    await discard(ctx, upload.media);
    throw error;
  }
}

async function acceptUpload(
  req: Request,
  ctx: PluginRouteContext,
  config: ResolvedFormBuilderConfig,
  slug: string
): Promise<Response> {
  const form = await openFormAt(slug, ctx, config);
  if (!uploadsEnabled(config)) {
    throw refusal("field", "INVALID", "This form takes no files.");
  }
  await holdUploadRate(req, form.id, config);
  const body = await readUploadBody(req, config.uploads.maxFileSize);
  const field = fileFieldOf(form, body.get("field"));
  const file = theFile(body);
  const limit = uploadLimitOf(field, config.uploads);
  if (file.size > limit) throw tooLarge(limit);
  const patterns = acceptPatternsOf(field, config.uploads);
  if (!fileMatchesAccept({ name: file.name, type: file.type }, patterns)) {
    throw refusal("file", "INVALID_TYPE", TYPE_REFUSED);
  }
  const stored = await storeFile(ctx, file, patterns);
  await recordUpload(ctx, {
    media: stored.id,
    form: form.id,
    field: field.name,
  });
  // What the visitor's form puts in the field's answer is `mediaId`; the
  // rest is for showing the visitor what they uploaded.
  return respondAction(
    "File uploaded.",
    {
      mediaId: stored.id,
      field: field.name,
      filename: stored.originalFilename,
      mimeType: stored.mimeType,
      size: stored.size,
    },
    { status: 201 }
  );
}

/** The upload route, at the root mount beside the other form endpoints. */
export function formUploadRoute(
  config: ResolvedFormBuilderConfig
): PluginRoute {
  return {
    method: "POST",
    path: "/forms/:slug/upload",
    mount: "root",
    public: true,
    handler: (req, ctx) => acceptUpload(req, ctx, config, ctx.params.slug),
  };
}
