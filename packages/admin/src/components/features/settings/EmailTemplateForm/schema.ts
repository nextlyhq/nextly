import { z } from "zod";

import {
  type CreateEmailTemplatePayload,
  type EmailTemplateRecord,
  type UpdateEmailTemplatePayload,
} from "@admin/services/emailTemplateApi";

// ============================================================
// Form id (external submit hooks may still reference it).
// ============================================================

export const EMAIL_TEMPLATE_FORM_ID = "email-template-form";

// ============================================================
// Form Values Type
// ============================================================

export interface TemplateFormVariable {
  name: string;
  description: string;
  required: boolean;
}

export interface TemplateFormAttachment {
  mediaId: string;
  filename?: string;
  displayName: string;
  mimeType?: string;
}

export interface TemplateFormValues {
  name: string;
  slug: string;
  subject: string;
  preheader: string;
  htmlContent: string;
  plainTextContent: string;
  useLayout: boolean;
  isActive: boolean;
  providerId: string; // empty string = "Use Default"
  layoutId: string; // empty string = "Default layout"
  fromOverride: string;
  replyTo: string;
  variables: TemplateFormVariable[];
  attachments: TemplateFormAttachment[];
}

// ============================================================
// Zod Schema
// ============================================================

const templateVariableSchema = z.object({
  name: z
    .string()
    .min(1, "Variable name is required")
    .max(100)
    .regex(
      /^[a-zA-Z][a-zA-Z0-9_.]*$/,
      "Must start with a letter (letters, numbers, underscores, dots allowed)"
    ),
  description: z.string().max(255).optional().or(z.literal("")),
  required: z.boolean(),
});

const templateAttachmentSchema = z.object({
  mediaId: z.string().min(1),
  filename: z.string().optional(),
  displayName: z.string(),
  mimeType: z.string().optional(),
});

export const templateSchema = z.object({
  name: z.string().min(1, "Template name is required").max(255),
  slug: z
    .string()
    .min(1, "Slug is required")
    .max(255)
    .regex(
      /^[a-z0-9]+(?:[-][a-z0-9]+)*$/,
      "Must be a valid slug (lowercase letters, numbers, and hyphens)"
    ),
  subject: z.string().min(1, "Email subject is required").max(500),
  preheader: z.string().max(255).optional().or(z.literal("")),
  htmlContent: z.string().min(1, "HTML content is required"),
  plainTextContent: z.string().optional().or(z.literal("")),
  useLayout: z.boolean(),
  isActive: z.boolean(),
  providerId: z.string().optional().or(z.literal("")),
  layoutId: z.string().optional().or(z.literal("")),
  fromOverride: z.string().max(320).optional().or(z.literal("")),
  replyTo: z.string().max(320).optional().or(z.literal("")),
  variables: z.array(templateVariableSchema),
  attachments: z.array(templateAttachmentSchema),
});

export const DEFAULT_VALUES: TemplateFormValues = {
  name: "",
  slug: "",
  subject: "",
  preheader: "",
  htmlContent: "",
  plainTextContent: "",
  useLayout: true,
  isActive: true,
  providerId: "",
  layoutId: "",
  fromOverride: "",
  replyTo: "",
  variables: [],
  attachments: [],
};

// Sentinels for "Use Default" (Radix Select rejects empty values).
export const USE_DEFAULT_PROVIDER = "__default__";
export const USE_DEFAULT_LAYOUT = "__default_layout__";

// ============================================================
// Payload transforms
// ============================================================

export function formValuesToCreatePayload(
  values: TemplateFormValues
): CreateEmailTemplatePayload {
  return {
    name: values.name,
    slug: values.slug,
    subject: values.subject,
    preheader: values.preheader || null,
    htmlContent: values.htmlContent,
    plainTextContent: values.plainTextContent || null,
    useLayout: values.useLayout,
    isActive: values.isActive,
    providerId: values.providerId || null,
    layoutId: values.layoutId || null,
    fromOverride: values.fromOverride || null,
    replyTo: values.replyTo || null,
    variables: values.variables.length > 0 ? values.variables : null,
    attachments:
      values.attachments.length > 0
        ? values.attachments.map(a => ({
            mediaId: a.mediaId,
            ...(a.filename ? { filename: a.filename } : {}),
          }))
        : null,
  };
}

export function formValuesToUpdatePayload(
  values: TemplateFormValues
): UpdateEmailTemplatePayload {
  return {
    name: values.name,
    subject: values.subject,
    preheader: values.preheader || null,
    htmlContent: values.htmlContent,
    plainTextContent: values.plainTextContent || null,
    useLayout: values.useLayout,
    isActive: values.isActive,
    providerId: values.providerId || null,
    layoutId: values.layoutId || null,
    fromOverride: values.fromOverride || null,
    replyTo: values.replyTo || null,
    variables: values.variables.length > 0 ? values.variables : null,
    attachments:
      values.attachments.length > 0
        ? values.attachments.map(a => ({
            mediaId: a.mediaId,
            ...(a.filename ? { filename: a.filename } : {}),
          }))
        : null,
  };
}

export function templateToFormValues(
  template: EmailTemplateRecord
): TemplateFormValues {
  return {
    name: template.name,
    slug: template.slug,
    subject: template.subject,
    preheader: template.preheader ?? "",
    htmlContent: template.htmlContent,
    plainTextContent: template.plainTextContent ?? "",
    useLayout: template.useLayout,
    isActive: template.isActive,
    providerId: template.providerId ?? "",
    layoutId: template.layoutId ?? "",
    fromOverride: template.fromOverride ?? "",
    replyTo: template.replyTo ?? "",
    variables: (template.variables ?? []).map(v => ({
      name: v.name,
      description: v.description,
      required: v.required ?? false,
    })),
    attachments: (template.attachments ?? []).map(a => ({
      mediaId: a.mediaId,
      filename: a.filename,
      displayName: a.filename ?? a.mediaId,
    })),
  };
}
