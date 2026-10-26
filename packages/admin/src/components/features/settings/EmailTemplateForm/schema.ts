import { z } from "zod";

import type {
  CreateEmailTemplatePayload,
  EmailTemplateRecord,
  UpdateEmailTemplatePayload,
} from "@admin/services/emailTemplateApi";

import { ownsContent } from "./workbench-model";

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
  /** When the template is sent, in a sentence. */
  description: string;
  /** Fixed addresses every send copies; none on a template carrying a secret. */
  cc: string[];
  bcc: string[];
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

/**
 * One copied address, as the server takes it: `ops@example.com` or
 * `Ops <ops@example.com>`, one mailbox, no line breaks. The server stays the
 * authority (it checks again); this keeps a sendable address from being
 * refused before it gets there.
 */
const COPY_ADDRESS =
  /^(?:[^<>,]*<\s*[^\s@<>,]+@[^\s@<>,]+\s*>|[^\s@<>,]+@[^\s@<>,]+)$/;
/** Whether `value` holds a C0 control character (line breaks included) or DEL. */
function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}
const copyAddress = z
  .string()
  .refine(
    value => !hasControlCharacter(value) && COPY_ADDRESS.test(value.trim()),
    "Enter an address, or a name and an address in angle brackets"
  );

const templateAttachmentSchema = z.object({
  mediaId: z.string().min(1),
  filename: z.string().optional(),
  displayName: z.string(),
  mimeType: z.string().optional(),
});

/**
 * A LAYOUT row has no subject, and the built-in default layout is seeded with
 * an empty one. Requiring a subject of every row therefore makes the shipped
 * default layout permanently unsaveable — and silently, because the layout
 * editor has no subject field to attach the message to.
 *
 * A factory rather than one schema with a conditional: the caller already knows
 * which kind it is editing, and a `superRefine` that reads a `kind` field the
 * form does not carry would be inventing one to interrogate.
 */
export function templateSchemaFor(isLayoutRow: boolean): z.ZodObject<{
  name: z.ZodString;
  slug: z.ZodString;
  preheader: z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodLiteral<"">]>;
  htmlContent: z.ZodString;
  plainTextContent: z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodLiteral<"">]>;
  useLayout: z.ZodBoolean;
  isActive: z.ZodBoolean;
  providerId: z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodLiteral<"">]>;
  layoutId: z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodLiteral<"">]>;
  fromOverride: z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodLiteral<"">]>;
  replyTo: z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodLiteral<"">]>;
  variables: z.ZodArray<
    z.ZodObject<
      {
        name: z.ZodString;
        description: z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodLiteral<"">]>;
        required: z.ZodBoolean;
      },
      z.core.$strip
    >
  >;
  attachments: z.ZodArray<
    z.ZodObject<
      {
        mediaId: z.ZodString;
        filename: z.ZodOptional<z.ZodString>;
        displayName: z.ZodString;
        mimeType: z.ZodOptional<z.ZodString>;
      },
      z.core.$strip
    >
  >;
  description: z.ZodUnion<[z.ZodOptional<z.ZodString>, z.ZodLiteral<"">]>;
  cc: z.ZodArray<z.ZodString>;
  bcc: z.ZodArray<z.ZodString>;
  subject: z.ZodString;
}> {
  return templateSchema.extend({
    subject: isLayoutRow
      ? z.string().max(500)
      : z.string().min(1, "Email subject is required").max(500),
  });
}

const templateSchema = z.object({
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
  // No length cap here: the description is the owner's on an owner's email,
  // where it's locked, and the server keeps the rule for it.
  description: z.string().optional().or(z.literal("")),
  cc: z.array(copyAddress),
  bcc: z.array(copyAddress),
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
  description: "",
  cc: [],
  bcc: [],
};

// Sentinels for "Use Default" (Radix Select rejects empty values).
export const USE_DEFAULT_PROVIDER = "__default__";
export const USE_DEFAULT_LAYOUT = "__default_layout__";

// ============================================================
// Payload transforms
// ============================================================

/** An optional text field as the API takes it: empty is none. */
const orNull = (value: string): string | null => value || null;

/** An optional list as the API takes it: empty is none. */
function listOrNull<T>(list: T[]): T[] | null {
  return list.length > 0 ? list : null;
}

/** Everything a save or a create sends, but the slug. */
function payloadFields(
  values: TemplateFormValues
): Omit<CreateEmailTemplatePayload, "slug"> {
  return {
    name: values.name,
    subject: values.subject,
    preheader: orNull(values.preheader),
    htmlContent: values.htmlContent,
    plainTextContent: orNull(values.plainTextContent),
    useLayout: values.useLayout,
    isActive: values.isActive,
    providerId: orNull(values.providerId),
    layoutId: orNull(values.layoutId),
    fromOverride: orNull(values.fromOverride),
    replyTo: orNull(values.replyTo),
    variables: listOrNull(values.variables),
    attachments: listOrNull(
      values.attachments.map(a => ({
        mediaId: a.mediaId,
        ...(a.filename ? { filename: a.filename } : {}),
      }))
    ),
    description: orNull(values.description),
    cc: listOrNull(values.cc),
    bcc: listOrNull(values.bcc),
  };
}

export function formValuesToCreatePayload(
  values: TemplateFormValues
): CreateEmailTemplatePayload {
  return { slug: values.slug, ...payloadFields(values) };
}

/** The fields an owner sets on its email: locked until the site overrides it. */
const OWNER_FIELDS = [
  "subject",
  "preheader",
  "htmlContent",
  "plainTextContent",
  "description",
  "variables",
] as const;

/**
 * The update a save sends. Given the saved record, it leaves out what the
 * site can't change right now, rather than sending it back as it was read:
 *
 * - on an owner's email, the owner's fields. The owner can update them while
 *   the form is open (the boot reconciles in the background), and the server
 *   reads a stale copy sent back as an edit, which overrides the email with
 *   the owner's previous text;
 * - on an email that carries a secret, the copies. Ones stored before it was
 *   marked stay stored but aren't sent, and the server refuses any it's sent,
 *   so sending them back would refuse every save.
 */
export function formValuesToUpdatePayload(
  values: TemplateFormValues,
  record?: EmailTemplateRecord
): UpdateEmailTemplatePayload {
  const payload: UpdateEmailTemplatePayload = payloadFields(values);
  if (record && !ownsContent(record)) {
    for (const field of OWNER_FIELDS) delete payload[field];
  }
  if (record?.carriesSecret) {
    delete payload.cc;
    delete payload.bcc;
  }
  return payload;
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
    description: template.description ?? "",
    cc: template.cc ?? [],
    bcc: template.bcc ?? [],
  };
}
