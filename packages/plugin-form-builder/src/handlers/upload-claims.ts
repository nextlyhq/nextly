/**
 * Which files a submission holds, decided inside the transaction that stores
 * it, whatever stored it.
 *
 * A file answer names media ids. A submission a request writes (a visitor
 * submitting, or staff over the API) may only name uploads the plugin's
 * upload route issued for the same form and field, that no other submission
 * has claimed; anything else (another form's upload, one already claimed, a
 * site's own logo, an id made up) is refused, and the write rolls back. The
 * uploads it names are claimed for it in the same transaction, each read for
 * update first, so two submissions naming one upload take turns and the
 * second is refused.
 *
 * An update keeps the ids the submission already stores in a field: staff
 * editing other answers send the file answer back as it was, and that is not
 * a new claim. A submission stored as spam is evidence, judged as a write
 * with no request is, so a bot is not told which of its ids were refused.
 *
 * A write no request produced (the Direct API from site code, an import, a
 * job) is trusted, as it was before uploads were recorded: nothing it names
 * is refused, and an issued upload it names for the same form and field that
 * no submission has claimed is claimed for it, so the file is kept with the
 * submission and deleted with it. One it names that another submission
 * already holds is recorded again, as this submission's too: a file stays
 * while any submission holding it is left.
 *
 * Deleting a submission releases its uploads in the deleting transaction,
 * and deleting a form releases the uploads no submission claimed: a released
 * upload can never be claimed again, and its file is deleted once the
 * deletion commits (`upload-cleanup`).
 *
 * @module handlers/upload-claims
 */
import { NextlyError, type PluginContext } from "@nextlyhq/plugin-sdk";

import { mediaIdsOf } from "../utils/upload-rules";

import { DELETE_PAGE } from "./forget-sends";
import { formIdOf } from "./form-closing-hold";

type InTransactionHandler = Parameters<
  PluginContext["hooks"]["onInTransaction"]
>[1];
type InTransactionContext = Parameters<InTransactionHandler>[0];

/** The shared hook context key the write seam marks a write under. */
const UPLOAD_CLAIMS_CONTEXT = "formBuilder.uploadClaims";

/** What a visitor, or staff, is told about a file answer it may not name. */
export const UPLOAD_NOT_CLAIMABLE =
  "This file was not uploaded for this field. Please upload it again.";

/** What the write seam tells the transaction about a write. */
interface ClaimMarker {
  /** Whether a request produced the write. */
  request: boolean;
  /** The form's file fields, when the seam read the form. */
  fileFields?: string[];
}

/** What claiming and releasing read and write with. */
interface ClaimDeps {
  own: PluginContext["services"]["ownCollections"];
  collections: PluginContext["services"]["collections"];
}

export interface UploadClaimSlugs {
  forms: string;
  submissions: string;
  uploads: string;
}

/** An upload as recorded. */
interface UploadRow {
  id: unknown;
  form?: unknown;
  field?: unknown;
  submission?: unknown;
  releasedAt?: unknown;
}

/** What one write may claim, and how strictly it is judged. */
interface ClaimTerms {
  formId: string;
  submissionId: string;
  strict: boolean;
}

/** The names of a form's file fields. */
function fileFieldNamesOf(fields: unknown): string[] {
  if (!Array.isArray(fields)) return [];
  return fields.flatMap(field => {
    const { type, name } = (field ?? {}) as { type?: unknown; name?: unknown };
    return type === "file" && typeof name === "string" ? [name] : [];
  });
}

/**
 * Mark a submission's write for the transaction that stores it: whether a
 * request produced it and, once the form is read, its file fields. Written
 * over whatever the shared context held, so no caller decides it.
 */
export function markUploadClaims(
  hook: { context?: Record<string, unknown>; req?: { http?: unknown } },
  form?: { fields?: unknown }
): void {
  if (!hook.context) return;
  const marker: ClaimMarker = {
    request: Boolean(hook.req?.http),
    ...(form ? { fileFields: fileFieldNamesOf(form.fields) } : {}),
  };
  hook.context[UPLOAD_CLAIMS_CONTEXT] = marker;
}

/** The mark the write seam left, if it ran. */
function markerOf(
  context: Readonly<Record<string, unknown>>
): ClaimMarker | undefined {
  const raw = context[UPLOAD_CLAIMS_CONTEXT] as
    | { request?: unknown; fileFields?: unknown }
    | undefined;
  if (!raw || typeof raw !== "object") return undefined;
  const fileFields = Array.isArray(raw.fileFields)
    ? raw.fileFields.filter((name): name is string => typeof name === "string")
    : undefined;
  return {
    request: raw.request === true,
    ...(fileFields ? { fileFields } : {}),
  };
}

/** A submission's answers, as stored: an object, or a JSON string of one. */
function answersOf(value: unknown): Record<string, unknown> {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return {};
    }
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

/** The form's file fields, read on the write's transaction. */
async function fileFieldsInTransaction(
  deps: ClaimDeps,
  write: InTransactionContext,
  formsSlug: string,
  formId: string
): Promise<string[]> {
  try {
    const form = (await deps.own.findEntryByIdInTransaction(
      write.transaction,
      formsSlug,
      formId,
      { lock: "none" }
    )) as unknown as { fields?: unknown } | null;
    return fileFieldNamesOf(form?.fields);
  } catch (error) {
    if (NextlyError.isNotFound(error)) return [];
    throw error;
  }
}

/** Whether an upload record still counts: not released for deletion. */
function live(upload: UploadRow): boolean {
  return !upload.releasedAt;
}

/** Whether `upload` was issued for `field` of the form and nobody holds it. */
function claimable(
  upload: UploadRow,
  terms: ClaimTerms,
  field: string
): boolean {
  return (
    live(upload) &&
    !upload.submission &&
    upload.form === terms.formId &&
    upload.field === field
  );
}

/**
 * Whether the submission already holds `upload`: a request write only for
 * the field it names, a trusted one however it came to hold it.
 */
function heldBy(upload: UploadRow, terms: ClaimTerms, field: string): boolean {
  if (!live(upload) || upload.submission !== terms.submissionId) return false;
  return (
    !terms.strict || (upload.form === terms.formId && upload.field === field)
  );
}

/** The refusal of a file answer naming what it may not. */
function notClaimable(field: string, mediaId: string, terms: ClaimTerms) {
  return NextlyError.validation({
    errors: [{ path: field, code: "INVALID", message: UPLOAD_NOT_CLAIMABLE }],
    logContext: {
      mediaId,
      formId: terms.formId,
      reason: "upload-not-claimable",
    },
  });
}

/**
 * Hold the upload of `mediaId` for the submission: claim the record the
 * route issued, refuse a request write anything else, and record a trusted
 * write as one more holder of a file another submission holds.
 */
async function claimOne(
  deps: ClaimDeps,
  write: InTransactionContext,
  uploadsSlug: string,
  terms: ClaimTerms,
  field: string,
  mediaId: string
): Promise<void> {
  // For update: a second submission naming this upload, and a deletion
  // releasing it, wait here until this one commits or rolls back, then
  // read what it left.
  const { data } = await deps.own.listEntriesInTransaction(
    write.transaction,
    uploadsSlug,
    {
      where: { media: { equals: mediaId } },
      pagination: { limit: DELETE_PAGE },
      depth: 0,
    },
    { lock: "update" }
  );
  const uploads = data as UploadRow[];
  if (uploads.some(upload => heldBy(upload, terms, field))) return;
  const issued = uploads.find(upload => claimable(upload, terms, field));
  if (issued) {
    await deps.collections.updateEntryInTransaction(
      write.transaction,
      uploadsSlug,
      String(issued.id),
      // Replaces what is stored: the row was just read for update.
      { submission: terms.submissionId, _overwrite: true }
    );
    return;
  }
  if (terms.strict) throw notClaimable(field, mediaId, terms);
  // Trusted, naming a file another submission holds: recorded as this
  // submission's too, so deleting either keeps it while the other names it.
  if (uploads.some(live)) {
    await deps.collections.createEntryInTransaction(
      write.transaction,
      uploadsSlug,
      {
        media: mediaId,
        form: terms.formId,
        field,
        submission: terms.submissionId,
      }
    );
  }
}

/** The ids `field` names now that it did not name before this write. */
function newIdsIn(
  field: string,
  answers: Record<string, unknown>,
  stored: Record<string, unknown>
): string[] {
  const kept = new Set(mediaIdsOf(stored[field]));
  return [...new Set(mediaIdsOf(answers[field]))].filter(id => !kept.has(id));
}

/**
 * A write's answers as it leaves them, and as the submission stored them
 * before it (none for a create). `undefined` when the write changes no
 * answer, so nothing new can be named.
 */
function answersOfWrite(
  write: InTransactionContext,
  row: Record<string, unknown>
):
  | { answers: Record<string, unknown>; stored: Record<string, unknown> }
  | undefined {
  const answers = answersOf(row.data);
  if (write.operation !== "update") return { answers, stored: {} };
  const before = write.originalData as Record<string, unknown> | undefined;
  const stored = answersOf(before?.data);
  return JSON.stringify(answers) === JSON.stringify(stored)
    ? undefined
    : { answers, stored };
}

/**
 * How strictly a write is judged: one a request produced is held to the
 * rules, unless it is stored as spam, which is evidence.
 */
function termsOf(
  write: InTransactionContext,
  row: Record<string, unknown>,
  formId: string,
  marker: ClaimMarker | undefined
): ClaimTerms {
  return {
    formId,
    submissionId: String(write.id),
    strict: marker?.request === true && row.status !== "spam",
  };
}

/** Claim the uploads a created or updated submission newly names. */
async function claimUploads(
  deps: ClaimDeps,
  write: InTransactionContext,
  slugs: UploadClaimSlugs
): Promise<void> {
  const row = write.data as Record<string, unknown> | undefined;
  const formId = formIdOf(row?.form);
  if (!row || formId === undefined) return;
  const changed = answersOfWrite(write, row);
  if (changed === undefined) return;
  const { answers, stored } = changed;
  const marker = markerOf(write.context);
  const fields =
    marker?.fileFields ??
    (await fileFieldsInTransaction(deps, write, slugs.forms, formId));
  const terms = termsOf(write, row, formId, marker);
  for (const field of fields) {
    for (const mediaId of newIdsIn(field, answers, stored)) {
      await claimOne(deps, write, slugs.uploads, terms, field, mediaId);
    }
  }
}

/** Release every upload `where` selects, a page at a time. */
async function releaseWhere(
  deps: ClaimDeps,
  write: InTransactionContext,
  uploadsSlug: string,
  where: Record<string, unknown>
): Promise<void> {
  const releasedAt = new Date();
  // Each released row stops matching, so the first page is the next batch.
  for (;;) {
    const { data } = await deps.own.listEntriesInTransaction(
      write.transaction,
      uploadsSlug,
      {
        where: { ...where, releasedAt: { exists: false } },
        pagination: { limit: DELETE_PAGE },
        depth: 0,
      },
      { lock: "update" }
    );
    for (const upload of data as UploadRow[]) {
      await deps.collections.updateEntryInTransaction(
        write.transaction,
        uploadsSlug,
        String(upload.id),
        { releasedAt, _overwrite: true }
      );
    }
    if (data.length < DELETE_PAGE) return;
  }
}

/** A submission's write: claim what it names, or release what it held. */
async function judgeSubmissionWrite(
  deps: ClaimDeps,
  write: InTransactionContext,
  slugs: UploadClaimSlugs
): Promise<void> {
  if (write.operation !== "delete") return claimUploads(deps, write, slugs);
  await releaseWhere(deps, write, slugs.uploads, {
    submission: { equals: String(write.id) },
  });
}

/**
 * A form's deletion: release the uploads made for it that no submission
 * claimed. Claimed ones go with their submissions, which the deletion
 * deletes, or stay with one moved to another form.
 */
async function releaseFormUploads(
  deps: ClaimDeps,
  write: InTransactionContext,
  uploadsSlug: string
): Promise<void> {
  if (write.operation !== "delete") return;
  await releaseWhere(deps, write, uploadsSlug, {
    form: { equals: String(write.id) },
    submission: { exists: false },
  });
}

/** Claim and release uploads in every write of a submission or a form. */
export function registerUploadClaims(
  ctx: Pick<PluginContext, "hooks"> & { services: PluginContext["services"] },
  slugs: UploadClaimSlugs
): void {
  const deps: ClaimDeps = {
    own: ctx.services.ownCollections,
    collections: ctx.services.collections,
  };
  ctx.hooks.onInTransaction(slugs.submissions, write =>
    judgeSubmissionWrite(deps, write, slugs)
  );
  ctx.hooks.onInTransaction(slugs.forms, write =>
    releaseFormUploads(deps, write, slugs.uploads)
  );
}
