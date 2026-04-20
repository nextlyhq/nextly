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

import { enhancedFetcher } from "../lib/api/enhancedFetcher";

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
 * Backend returns a flat array (no server-side pagination).
 */
export async function listTemplates(): Promise<EmailTemplateRecord[]> {
  const result = await enhancedFetcher<EmailTemplateRecord[]>(
    "/email-templates",
    {},
    true
  );
  return result.data;
}

/**
 * Get a single email template by ID.
 */
export async function getTemplate(id: string): Promise<EmailTemplateRecord> {
  const result = await enhancedFetcher<EmailTemplateRecord>(
    `/email-templates/${id}`,
    {},
    true
  );
  return result.data;
}

/**
 * Create a new email template.
 */
export async function createTemplate(
  data: CreateEmailTemplatePayload
): Promise<EmailTemplateRecord> {
  const result = await enhancedFetcher<EmailTemplateRecord>(
    "/email-templates",
    { method: "POST", body: JSON.stringify(data) },
    true
  );
  return result.data;
}

/**
 * Update an existing email template.
 */
export async function updateTemplate(
  id: string,
  data: UpdateEmailTemplatePayload
): Promise<EmailTemplateRecord> {
  const result = await enhancedFetcher<EmailTemplateRecord>(
    `/email-templates/${id}`,
    { method: "PATCH", body: JSON.stringify(data) },
    true
  );
  return result.data;
}

/**
 * Delete an email template.
 */
export async function deleteTemplate(id: string): Promise<void> {
  await enhancedFetcher<null>(
    `/email-templates/${id}`,
    { method: "DELETE" },
    true
  );
}

/**
 * Get the shared email layout (header and footer HTML).
 */
export async function getLayout(): Promise<EmailLayout> {
  const result = await enhancedFetcher<EmailLayout>(
    "/email-templates/layout",
    {},
    true
  );
  return result.data;
}

/**
 * Update the shared email layout.
 */
export async function updateLayout(data: Partial<EmailLayout>): Promise<void> {
  await enhancedFetcher<null>(
    "/email-templates/layout",
    { method: "PATCH", body: JSON.stringify(data) },
    true
  );
}

/**
 * Preview a template with sample data.
 * Returns rendered subject and HTML.
 */
export async function previewTemplate(
  id: string,
  sampleData: Record<string, unknown>
): Promise<EmailTemplatePreviewResult> {
  const result = await enhancedFetcher<EmailTemplatePreviewResult>(
    `/email-templates/${id}/preview`,
    { method: "POST", body: JSON.stringify(sampleData) },
    true
  );
  return result.data;
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
