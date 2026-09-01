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
 * The fields the draft-preview route renders, and nothing more.
 *
 * Mirrors the route's own zod schema rather than reusing a template payload
 * type: a preview never writes, so sending a name, a slug or an id would hand
 * the endpoint input it has no use for, and widening this later would widen
 * what an unsaved draft can put on the wire.
 */
export interface DraftPreviewTemplate {
  subject: string;
  htmlContent: string;
  plainTextContent: string | null;
  preheader: string | null;
  useLayout: boolean;
  kind: EmailTemplateKind;
  layoutId: string | null;
}

/**
 * A rendered draft: the complete artifact, including the text part.
 *
 * Distinct from `EmailTemplatePreviewResult`, which carries no `text` because
 * the saved-row preview predates the unified renderer. Narrowing this to match
 * it would discard the one field that tells an author whether the plain-text
 * alternative recipients receive is the one they wrote.
 */
export interface DraftPreviewResult {
  subject: string;
  html: string;
  text: string;
}

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
  data: Record<string, unknown>
): Promise<DraftPreviewResult> {
  return fetcher<DraftPreviewResult>(
    "/email-templates/preview",
    { method: "POST", body: JSON.stringify({ template, data }) },
    true
  );
}

export interface SendTestEmailResult {
  success: boolean;
  messageId?: string;
}

/**
 * Send a real test email from a saved template via the shared
 * send-with-template endpoint. Tests the SAVED template (not unsaved edits).
 */
export async function sendTestEmail(
  slug: string,
  to: string,
  variables: Record<string, unknown>
): Promise<SendTestEmailResult> {
  return fetcher<SendTestEmailResult>(
    "/email/send-with-template",
    {
      method: "POST",
      body: JSON.stringify({ to, template: slug, variables }),
    },
    true
  );
}

export const emailTemplateApi = {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  previewTemplate,
  previewDraft,
  sendTestEmail,
} as const;
