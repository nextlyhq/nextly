/**
 * Email Template API Service
 *
 * API client for managing email templates and the shared email layout.
 * Supports CRUD operations, preview, and layout management.
 *
 * @example
 * ```ts
 * import { emailTemplateApi } from '@admin/services/emailTemplateApi';
 *
 * const templates = await emailTemplateApi.listTemplates();
 * const template = await emailTemplateApi.getTemplate('template-id');
 * const layout = await emailTemplateApi.getLayout();
 * ```
 */

import type {
  DraftPreviewRequest,
  RenderedTemplate,
} from "nextly/api/email-template-preview-types";

import { fetcher } from "../lib/api/fetcher";
import type {
  ActionResponse,
  MutationResponse,
} from "../lib/api/response-types";

// ============================================================
// Types
// ============================================================

export interface EmailTemplateVariable {
  name: string;
  description: string;
  required?: boolean;
}

export interface EmailTemplateAttachment {
  mediaId: string;
  filename?: string;
}

/** Row kind discriminator. Layouts wrap templates at their {{content}}. */
export type EmailTemplateKind = "template" | "layout" | "partial";

/**
 * Who a template belongs to: core, a plugin (and whether it is still
 * installed), or the site. An owned template is the owner's until the site
 * overrides it, and the server refuses to delete it.
 */
export type EmailTemplateOwner =
  | { kind: "core" }
  | { kind: "plugin"; name: string; installed: boolean }
  | { kind: "site" };

export interface EmailTemplateRecord {
  id: string;
  name: string;
  slug: string;
  kind: EmailTemplateKind;
  subject: string;
  htmlContent: string;
  plainTextContent: string | null;
  preheader: string | null;
  layoutId: string | null;
  fromOverride: string | null;
  replyTo: string | null;
  variables: EmailTemplateVariable[] | null;
  useLayout: boolean;
  isActive: boolean;
  providerId: string | null;
  attachments: EmailTemplateAttachment[] | null;
  createdAt: string;
  updatedAt: string;
  owner: EmailTemplateOwner;
  /** When the template is sent, in a sentence. */
  description: string | null;
  /** The site replaced its owner's version. Never true for the site's own. */
  overridden: boolean;
  /** The owner changed its version since the site overrode it. */
  ownerChanged: boolean;
  /** A version of it is set in the site's code. */
  setInCode: boolean;
  /**
   * Kept on the previous template engine, so it sends as it always did until
   * someone changes the flagged text. Only the list reports it.
   */
  keptOnOldEngine?: boolean;
  /**
   * When it was last sent, from the delivery log: null when never. Absent
   * when the list doesn't report it, which it does only to someone who may
   * read deliveries.
   */
  lastSentAt?: string | null;
  /** Fixed addresses every send of it copies. */
  cc?: string[] | null;
  /** Fixed addresses every send of it blind-copies. */
  bcc?: string[] | null;
  /**
   * Its owner marks it as carrying a secret (a sign-in, reset or verification
   * link): it takes no copies, and any stored on it are not sent.
   */
  carriesSecret?: boolean;
}

/**
 * The parts of a template an owner versions and an override replaces.
 *
 * This and the four types after it restate the server's ownership types
 * (`nextly`'s `EmailTemplateVersion`, `OwnerChange`, `OwnerChangeChoice`,
 * `EmailTemplateComparison` and `OwnerUpdateUndo`, from
 * `domains/email/template-merge.ts` and `email-template-service.ts`), as
 * `EmailTemplateRecord` above restates the record: the admin reads server
 * types only through the light `nextly/api/*-types` entries, and none carries
 * these yet.
 */
export interface EmailTemplateVersion {
  subject: string;
  htmlContent: string;
  plainTextContent: string | null;
  preheader: string | null;
}

/** One change the owner made since the site's copy started from its version. */
export interface OwnerChange {
  /** Stable within one review. */
  id: string;
  /** The field, or "template" for an update offered as a whole. */
  field:
    | "subject"
    | "preheader"
    | "htmlContent"
    | "plainTextContent"
    | "template";
  /** The site edited the same lines. */
  conflict: boolean;
  /** The lines the change replaced in the version the copy started from. */
  base: string[];
  /** The owner's lines now. */
  theirs: string[];
  /** The site's lines at the same place now. */
  mine: string[];
}

/** What the person chose for one change. */
export type OwnerChangeChoice =
  | { use: "mine" }
  | { use: "theirs" }
  | { use: "edited"; text: string };

/** An overridden template beside its owner's current version. */
export interface EmailTemplateComparison {
  base: EmailTemplateVersion;
  theirs: EmailTemplateVersion;
  mine: EmailTemplateVersion;
  changes: OwnerChange[];
  /** Names the three versions; applying is refused once any of them moved. */
  review: string;
}

/** What an applied review replaced, for Undo. */
export interface OwnerUpdateUndo {
  version: EmailTemplateVersion;
  base: EmailTemplateVersion;
  applied: string;
  appliedBase: string;
}

/** Wire shape before normalization: legacy rows may carry a null `kind`. */
type RawEmailTemplateRecord = Omit<EmailTemplateRecord, "kind"> & {
  kind: EmailTemplateKind | null;
};

/** Coerce a null `kind` (legacy rows) to "template" at the API boundary. */
function normalizeTemplate(
  record: RawEmailTemplateRecord
): EmailTemplateRecord {
  return { ...record, kind: record.kind ?? "template" };
}

export interface CreateEmailTemplatePayload {
  name: string;
  slug: string;
  kind?: EmailTemplateKind;
  subject: string;
  htmlContent: string;
  plainTextContent?: string | null;
  preheader?: string | null;
  layoutId?: string | null;
  fromOverride?: string | null;
  replyTo?: string | null;
  variables?: EmailTemplateVariable[] | null;
  useLayout?: boolean;
  isActive?: boolean;
  providerId?: string | null;
  attachments?: EmailTemplateAttachment[] | null;
  description?: string | null;
  cc?: string[] | null;
  bcc?: string[] | null;
}

export interface UpdateEmailTemplatePayload {
  name?: string;
  subject?: string;
  htmlContent?: string;
  plainTextContent?: string | null;
  preheader?: string | null;
  layoutId?: string | null;
  fromOverride?: string | null;
  replyTo?: string | null;
  variables?: EmailTemplateVariable[] | null;
  useLayout?: boolean;
  isActive?: boolean;
  providerId?: string | null;
  attachments?: EmailTemplateAttachment[] | null;
  description?: string | null;
  cc?: string[] | null;
  bcc?: string[] | null;
}

export interface EmailTemplatePreviewResult {
  subject: string;
  html: string;
}

// ============================================================
// API Functions
// ============================================================

/**
 * List all email templates.
 *
 * Server emits `{ templates }` (the email dispatcher avoids respondList
 * because the underlying service is non-paginated). We project
 * `templates` to keep the bare-array public signature callers expect.
 */
export async function listTemplates(): Promise<EmailTemplateRecord[]> {
  const result = await fetcher<{ templates: RawEmailTemplateRecord[] }>(
    "/email-templates",
    {},
    true
  );
  return (result.templates ?? []).map(normalizeTemplate);
}

/**
 * Get a single email template by ID.
 */
export async function getTemplate(id: string): Promise<EmailTemplateRecord> {
  const record = await fetcher<RawEmailTemplateRecord>(
    `/email-templates/${id}`,
    {},
    true
  );
  return normalizeTemplate(record);
}

/**
 * Create a new email template.
 */
export async function createTemplate(
  data: CreateEmailTemplatePayload
): Promise<EmailTemplateRecord> {
  const result = await fetcher<MutationResponse<RawEmailTemplateRecord>>(
    "/email-templates",
    { method: "POST", body: JSON.stringify(data) },
    true
  );
  return normalizeTemplate(result.item);
}

/**
 * Update an existing email template.
 */
export async function updateTemplate(
  id: string,
  data: UpdateEmailTemplatePayload
): Promise<EmailTemplateRecord> {
  const result = await fetcher<MutationResponse<RawEmailTemplateRecord>>(
    `/email-templates/${id}`,
    { method: "PATCH", body: JSON.stringify(data) },
    true
  );
  return normalizeTemplate(result.item);
}

/**
 * Delete an email template. The caller expects void; we discard the
 * server's ActionResponse body.
 */
export async function deleteTemplate(id: string): Promise<void> {
  await fetcher<ActionResponse>(
    `/email-templates/${id}`,
    { method: "DELETE" },
    true
  );
}

/**
 * Preview a template with sample data. Returns rendered subject and
 * HTML.
 */
export async function previewTemplate(
  id: string,
  sampleData: Record<string, unknown>
): Promise<EmailTemplatePreviewResult> {
  // The preview route's schema expects `{ data: <sampleData> }` (wrapped);
  // sending the raw sampleData under the top-level body fails the zod parse
  // with a 400 (handoff F14 — pre-existing wire mismatch picked up here).
  return fetcher<EmailTemplatePreviewResult>(
    `/email-templates/${id}/preview`,
    { method: "POST", body: JSON.stringify({ data: sampleData }) },
    true
  );
}

/**
 * The fields the draft-preview route renders — DERIVED from the schema the
 * server validates against, never restated.
 *
 * A hand-written mirror compiles happily while every request is rejected: add
 * a required field on the server and nothing here fails until runtime. Taking
 * the type from the canonical schema turns that into a build error, for the
 * same reason the render itself has only one implementation — a contract with
 * two definitions is one that drifts.
 *
 * A type-only import, so nothing of the server reaches the browser bundle, and
 * the entry point it comes from pulls zod and nothing else.
 */
export type DraftPreviewTemplate = DraftPreviewRequest["template"];

/** The variable values a render interpolates, as the schema declares them. */
export type DraftPreviewData = DraftPreviewRequest["data"];

/**
 * A rendered draft: the complete artifact, including the text part.
 *
 * The server's own `RenderedTemplate`, so the field the browser-side preview
 * used to guess at cannot be dropped here without the compiler noticing.
 * Distinct from `EmailTemplatePreviewResult`, which carries no `text` because
 * the saved-row preview predates the unified renderer.
 */
export type DraftPreviewResult = RenderedTemplate;

/**
 * Render UNSAVED template fields through the server's composition.
 *
 * The editor previews through this rather than interpolating in the browser:
 * a second implementation of the render is a second answer to "what will they
 * receive", and the two drifted on the preheader, on a layout's own chrome and
 * on the derived text part before this existed.
 */
export async function previewDraft(
  template: DraftPreviewTemplate,
  data: DraftPreviewData
): Promise<DraftPreviewResult> {
  /*
   * The WHOLE body is annotated, not just the template inside it. Typing only
   * the nested field leaves the envelope hand-authored, so a schema that gains
   * another required top-level property still compiles here and fails as a 400
   * at runtime — which is the failure this derivation exists to prevent.
   */
  const body: DraftPreviewRequest = { template, data };
  return fetcher<DraftPreviewResult>(
    "/email-templates/preview",
    { method: "POST", body: JSON.stringify(body) },
    true
  );
}

export interface SendTestEmailResult {
  success: boolean;
  messageId?: string;
}

/**
 * Send a real test email from a saved template to the signed-in user's own
 * address: the server picks the recipient, never the caller. Tests the SAVED
 * template (not unsaved edits).
 */
export async function sendTestEmail(
  templateId: string,
  variables: Record<string, unknown>
): Promise<SendTestEmailResult> {
  return fetcher<SendTestEmailResult>(
    `/email-templates/${encodeURIComponent(templateId)}/send-test`,
    {
      // PATCH: the server gates it by the update permission on templates.
      method: "PATCH",
      body: JSON.stringify({ variables }),
    },
    true
  );
}

// ============================================================
// Ownership: override, reset, and an owner's update
// ============================================================

/**
 * Make an owned template the site's: from now on it holds the site's version,
 * starting from the owner's current one, or from `version` where given (Undo
 * of a Reset puts the site's text back this way).
 */
export async function overrideTemplate(
  id: string,
  version?: EmailTemplateVersion
): Promise<EmailTemplateRecord> {
  const result = await fetcher<MutationResponse<RawEmailTemplateRecord>>(
    `/email-templates/${id}/override`,
    { method: "PATCH", body: JSON.stringify(version ? { version } : {}) },
    true
  );
  return normalizeTemplate(result.item);
}

/** Return an overridden template to its owner's current version. */
export async function resetTemplate(id: string): Promise<EmailTemplateRecord> {
  const result = await fetcher<MutationResponse<RawEmailTemplateRecord>>(
    `/email-templates/${id}/reset`,
    { method: "PATCH", body: JSON.stringify({}) },
    true
  );
  return normalizeTemplate(result.item);
}

/** An overridden template beside its owner's version, change by change. */
export async function compareTemplate(
  id: string
): Promise<EmailTemplateComparison> {
  return fetcher<EmailTemplateComparison>(
    `/email-templates/${id}/compare`,
    {},
    true
  );
}

/**
 * Apply a review of the owner's update. Refused (409) when the template or
 * the owner's version moved since `compareTemplate` returned `review`.
 */
export async function applyOwnerUpdate(
  id: string,
  choices: Record<string, OwnerChangeChoice>,
  review: string
): Promise<{ item: EmailTemplateRecord; undo: OwnerUpdateUndo }> {
  const result = await fetcher<{
    item: RawEmailTemplateRecord;
    undo: OwnerUpdateUndo;
  }>(
    `/email-templates/${id}/apply-update`,
    { method: "PATCH", body: JSON.stringify({ choices, review }) },
    true
  );
  return { item: normalizeTemplate(result.item), undo: result.undo };
}

/** Undo an applied review, while nothing has changed the template since. */
export async function undoOwnerUpdate(
  id: string,
  undo: OwnerUpdateUndo
): Promise<EmailTemplateRecord> {
  const result = await fetcher<MutationResponse<RawEmailTemplateRecord>>(
    `/email-templates/${id}/undo-update`,
    { method: "PATCH", body: JSON.stringify({ undo }) },
    true
  );
  return normalizeTemplate(result.item);
}

/** The type of {@link emailTemplateApi}. */
type EmailTemplateApiType = {
  readonly listTemplates: typeof listTemplates;
  readonly getTemplate: typeof getTemplate;
  readonly createTemplate: typeof createTemplate;
  readonly updateTemplate: typeof updateTemplate;
  readonly deleteTemplate: typeof deleteTemplate;
  readonly previewTemplate: typeof previewTemplate;
  readonly previewDraft: typeof previewDraft;
  readonly sendTestEmail: typeof sendTestEmail;
  readonly overrideTemplate: typeof overrideTemplate;
  readonly resetTemplate: typeof resetTemplate;
  readonly compareTemplate: typeof compareTemplate;
  readonly applyOwnerUpdate: typeof applyOwnerUpdate;
  readonly undoOwnerUpdate: typeof undoOwnerUpdate;
};

export const emailTemplateApi: EmailTemplateApiType = {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  previewTemplate,
  previewDraft,
  sendTestEmail,
  overrideTemplate,
  resetTemplate,
  compareTemplate,
  applyOwnerUpdate,
  undoOwnerUpdate,
} as const;
