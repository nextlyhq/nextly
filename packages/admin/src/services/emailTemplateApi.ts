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

export interface EmailTemplateRecord {
  id: string;
  name: string;
  slug: string;
  subject: string;
  htmlContent: string;
  plainTextContent: string | null;
  variables: EmailTemplateVariable[] | null;
  useLayout: boolean;
  isActive: boolean;
  providerId: string | null;
  attachments: EmailTemplateAttachment[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEmailTemplatePayload {
  name: string;
  slug: string;
  subject: string;
  htmlContent: string;
  plainTextContent?: string | null;
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
  variables?: EmailTemplateVariable[] | null;
  useLayout?: boolean;
  isActive?: boolean;
  providerId?: string | null;
  attachments?: EmailTemplateAttachment[] | null;
}

export interface EmailLayout {
  header: string;
  footer: string;
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
 * Phase 4 (Task 19): server emits `respondData({ templates })` (the email
 * dispatcher avoids respondList because the underlying service is
 * non-paginated). We project `templates` to keep the bare-array public
 * signature callers expect.
 */
export async function listTemplates(): Promise<EmailTemplateRecord[]> {
  const result = await fetcher<{ templates: EmailTemplateRecord[] }>(
    "/email-templates",
    {},
    true
  );
  return result.templates ?? [];
}

/**
 * Get a single email template by ID.
 *
 * Phase 4 (Task 19): findByID returns the bare doc via respondDoc.
 */
export async function getTemplate(id: string): Promise<EmailTemplateRecord> {
  return fetcher<EmailTemplateRecord>(`/email-templates/${id}`, {}, true);
}

/**
 * Create a new email template.
 *
 * Phase 4 (Task 19): server returns `MutationResponse<EmailTemplateRecord>`;
 * project `item` for the bare-record public signature.
 */
export async function createTemplate(
  data: CreateEmailTemplatePayload
): Promise<EmailTemplateRecord> {
  const result = await fetcher<MutationResponse<EmailTemplateRecord>>(
    "/email-templates",
    { method: "POST", body: JSON.stringify(data) },
    true
  );
  return result.item;
}

/**
 * Update an existing email template.
 *
 * Phase 4 (Task 19): server returns `MutationResponse<EmailTemplateRecord>`;
 * project `item` for the bare-record public signature.
 */
export async function updateTemplate(
  id: string,
  data: UpdateEmailTemplatePayload
): Promise<EmailTemplateRecord> {
  const result = await fetcher<MutationResponse<EmailTemplateRecord>>(
    `/email-templates/${id}`,
    { method: "PATCH", body: JSON.stringify(data) },
    true
  );
  return result.item;
}

/**
 * Delete an email template.
 *
 * Phase 4 (Task 19): server returns `ActionResponse` (delete is an action
 * because the dispatcher's templateService returns void); we discard the
 * body since the caller expects void.
 */
export async function deleteTemplate(id: string): Promise<void> {
  await fetcher<ActionResponse>(
    `/email-templates/${id}`,
    { method: "DELETE" },
    true
  );
}

/**
 * Get the shared email layout (header and footer HTML).
 *
 * Phase 4 (Task 19): the dispatcher emits `respondData(layout)` so the
 * wire body IS the EmailLayout `{ header, footer }`; type the generic
 * with the bare shape directly.
 */
export async function getLayout(): Promise<EmailLayout> {
  return fetcher<EmailLayout>("/email-templates/layout", {}, true);
}

/**
 * Update the shared email layout.
 *
 * Phase 4 (Task 19): server returns `ActionResponse`; we discard.
 */
export async function updateLayout(data: Partial<EmailLayout>): Promise<void> {
  await fetcher<ActionResponse>(
    "/email-templates/layout",
    { method: "PATCH", body: JSON.stringify(data) },
    true
  );
}

/**
 * Preview a template with sample data.
 * Returns rendered subject and HTML.
 *
 * Phase 4 (Task 19): server emits `respondData(preview)` (the bare
 * `{ subject, html }` shape).
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

export const emailTemplateApi = {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  getLayout,
  updateLayout,
  previewTemplate,
} as const;
