/**
 * Form Builder Plugin
 *
 * Visual form builder with drag-and-drop UI, submission management,
 * email notifications, and spam protection.
 *
 * @module plugin
 * @since 0.1.0
 */

import type { CollectionConfig, PluginDefinition } from "@revnixhq/nextly";
// `getCollectionsHandler` runs inside Next.js request handlers, so it
// lives behind the runtime subpath (task 24 stage 1). Importing from
// the root would drag Next.js subpaths into Node-only contexts (CLI,
// config loaders) that pull this plugin via `nextly.config.ts`.
import { getCollectionsHandler } from "@revnixhq/nextly/runtime";

import { formsCollection } from "./collections/forms";
import { submissionsCollection } from "./collections/submissions";
import type {
  FormNotificationItem,
  FormBuilderPluginOptions,
  ResolvedFormBuilderConfig,
} from "./types";

export type NextlyPlugin = PluginDefinition;

/** The runtime instance passed to plugin hooks (type extracted from `init`'s parameter). */
type NextlyInstance = Parameters<NonNullable<NextlyPlugin["init"]>>[0];

/** Internal augmentation: we stash the resolved config on the nextly instance for later retrieval. */
type NextlyWithFormBuilderConfig = NextlyInstance & {
  __formBuilderConfig?: ResolvedFormBuilderConfig;
};

// ---------------------------------------------------------------------------
// Configuration resolver
// ---------------------------------------------------------------------------

/**
 * Merge user options with sensible defaults.
 */
function resolveConfig(
  options: FormBuilderPluginOptions
): ResolvedFormBuilderConfig {
  const formOverrides =
    options.formOverrides || options.collections?.forms || {};
  const submissionOverrides =
    options.formSubmissionOverrides || options.collections?.submissions || {};

  return {
    formOverrides: {
      ...formOverrides,
      slug: formOverrides.slug || "forms",
      labels: {
        singular: formOverrides.labels?.singular || "Form",
        plural: formOverrides.labels?.plural || "Forms",
      },
    },

    formSubmissionOverrides: {
      ...submissionOverrides,
      slug: submissionOverrides.slug || "form-submissions",
      labels: {
        singular: submissionOverrides.labels?.singular || "Submission",
        plural: submissionOverrides.labels?.plural || "Submissions",
      },
    },

    fields: {
      text: options.fields?.text ?? true,
      email: options.fields?.email ?? true,
      number: options.fields?.number ?? true,
      phone: options.fields?.phone ?? true,
      url: options.fields?.url ?? true,
      textarea: options.fields?.textarea ?? true,
      select: options.fields?.select ?? true,
      checkbox: options.fields?.checkbox ?? true,
      radio: options.fields?.radio ?? true,
      file: options.fields?.file ?? true,
      date: options.fields?.date ?? true,
      time: options.fields?.time ?? true,
      hidden: options.fields?.hidden ?? true,
    },

    redirectRelationships: options.redirectRelationships || [],
    beforeEmail: options.beforeEmail,

    notifications: {
      defaultFrom: options.notifications?.defaultFrom,
      defaultToEmail: options.notifications?.defaultToEmail,
      enabled: options.notifications?.enabled ?? true,
    },

    spamProtection: {
      honeypot: options.spamProtection?.honeypot ?? true,
      recaptcha: options.spamProtection?.recaptcha ?? { enabled: false },
      rateLimit: {
        maxSubmissions: options.spamProtection?.rateLimit?.maxSubmissions ?? 10,
        windowMs: options.spamProtection?.rateLimit?.windowMs ?? 60_000,
      },
    },

    uploads: {
      maxFileSize: options.uploads?.maxFileSize ?? 10_485_760, // 10 MB
      allowedMimeTypes: options.uploads?.allowedMimeTypes ?? [
        "image/*",
        "application/pdf",
        "text/*",
      ],
      uploadCollection: options.uploads?.uploadCollection ?? "media",
    },

    features: {
      builder: options.features?.builder ?? true,
      conditionalLogic: options.features?.conditionalLogic ?? true,
      fileUploads: options.features?.fileUploads ?? true,
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface FormBuilderPluginResult {
  /** Plugin definition — pass to `defineConfig({ plugins: [...] })`. */
  plugin: NextlyPlugin;
  /** Forms & Submissions collections (also auto-added by the plugin). */
  collections: CollectionConfig[];
  /** Resolved configuration with all defaults applied. */
  config: ResolvedFormBuilderConfig;
}

/**
 * Create a Form Builder plugin instance.
 *
 * @example Basic usage
 * ```ts
 * import { defineConfig } from "@revnixhq/nextly/config";
 * import { formBuilder } from "@revnixhq/plugin-form-builder";
 *
 * const fb = formBuilder();
 *
 * export default defineConfig({
 *   plugins: [fb.plugin],
 * });
 * ```
 *
 * @example With options
 * ```ts
 * const fb = formBuilder({
 *   notifications: { defaultFrom: "noreply@example.com" },
 *   spamProtection: { honeypot: true },
 *   formOverrides: {
 *     slug: "contact-forms",
 *     labels: { singular: "Contact Form", plural: "Contact Forms" },
 *   },
 * });
 * ```
 */
export function formBuilder(
  options: FormBuilderPluginOptions = {}
): FormBuilderPluginResult {
  const resolvedConfig = resolveConfig(options);

  const formsCol = formsCollection(resolvedConfig);
  const submissionsCol = submissionsCollection(resolvedConfig);

  const plugin: NextlyPlugin = {
    name: "@revnixhq/plugin-form-builder",
    version: "0.0.8",
    collections: [formsCol, submissionsCol],

    admin: {
      order: 50,
      description: "Create and manage forms with submission tracking",
    },

    // -- Config transformer --------------------------------------------------
    // Automatically adds plugin collections so users don't have to spread them.
    config(config: Parameters<NonNullable<NextlyPlugin["config"]>>[0]) {
      const existing: CollectionConfig[] = config.collections || [];
      const formsSlug = resolvedConfig.formOverrides.slug;
      const submissionsSlug = resolvedConfig.formSubmissionOverrides.slug;

      const toAdd: CollectionConfig[] = [];
      if (!existing.some((c: CollectionConfig) => c.slug === formsSlug))
        toAdd.push(formsCol);
      if (!existing.some((c: CollectionConfig) => c.slug === submissionsSlug))
        toAdd.push(submissionsCol);

      return { ...config, collections: [...existing, ...toAdd] };
    },

    // -- Init ----------------------------------------------------------------
    // Registers an afterCreate hook on submissions to send email notifications.
    init(nextly: NextlyInstance) {
      const submissionSlug = resolvedConfig.formSubmissionOverrides.slug;

      // Prevent duplicate hook registration in Next.js dev mode
      const guardKey = `__formBuilder_afterCreate_${submissionSlug}`;
      const g = globalThis as Record<string, unknown>;
      if (g[guardKey]) return;
      g[guardKey] = true;

      nextly.infra.logger.info("Form Builder plugin initialized", {
        formsCollection: resolvedConfig.formOverrides.slug,
        submissionsCollection: submissionSlug,
        enabledFields: Object.entries(resolvedConfig.fields)
          .filter(([, on]) => on)
          .map(([name]) => name),
      });

      (nextly as NextlyWithFormBuilderConfig).__formBuilderConfig =
        resolvedConfig;

      // Register afterCreate hook for email notifications
      nextly.hooks.on(
        "afterCreate",
        submissionSlug,
        async (context: unknown) => {
          await handleSubmissionCreated(context, resolvedConfig, nextly);
        }
      );
    },
  };

  return {
    plugin,
    collections: [formsCol, submissionsCol],
    config: resolvedConfig,
  };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Retrieve the resolved Form Builder config from a Nextly plugin context.
 */
export function getFormBuilderConfig(
  nextly: unknown
): ResolvedFormBuilderConfig | undefined {
  if (!nextly || typeof nextly !== "object") return undefined;
  return (nextly as Partial<NextlyWithFormBuilderConfig>).__formBuilderConfig;
}

/**
 * Resolve a `{{fieldName}}` template reference against submitted values.
 * Plain strings (e.g. email addresses) are returned as-is.
 */
function resolveFieldRef(ref: string, data: Record<string, unknown>): string {
  const match = ref.match(/^\{\{(\w+)\}\}$/);
  if (!match) return ref;
  const value = data[match[1]];
  return typeof value === "string" ? value : "";
}

// ---------------------------------------------------------------------------
// Attachment collection for file fields
// ---------------------------------------------------------------------------

/**
 * Scan form fields for file-upload fields marked `attachToEmail` and
 * collect the corresponding mediaIds from the submitted data. Returns
 * an array of `{ mediaId }` objects ready to pass as `attachments` to
 * `emailService.sendWithTemplate()`.
 *
 * Skips empty/missing values silently (optional file fields). Handles
 * both single-value and `multiple: true` file fields.
 *
 * @internal Exported for testing — not part of the public plugin API.
 */
export function collectAttachmentInputs(
  fields: Array<Record<string, unknown>>,
  submittedData: Record<string, unknown>
): Array<{ mediaId: string }> {
  const attachments: Array<{ mediaId: string }> = [];

  for (const field of fields) {
    if (field.type !== "file" || !field.attachToEmail) continue;

    const name = field.name as string;
    const value = submittedData[name];
    if (value == null) continue;

    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && item) {
          attachments.push({ mediaId: item });
        }
      }
    } else if (typeof value === "string" && value) {
      attachments.push({ mediaId: value });
    }
  }

  return attachments;
}

// ---------------------------------------------------------------------------
// Submission notification handler
// ---------------------------------------------------------------------------

/**
 * Send email notifications after a form submission is created.
 */
async function handleSubmissionCreated(
  context: unknown,
  config: ResolvedFormBuilderConfig,
  nextly: NextlyInstance
): Promise<void> {
  const submission = (context as { data?: Record<string, unknown> }).data;
  if (!submission) return;

  const rawFormId = submission.form;
  let formId: string | null = null;
  if (typeof rawFormId === "string") {
    formId = rawFormId;
  } else if (rawFormId && typeof rawFormId === "object") {
    const maybeId = (rawFormId as { id?: unknown }).id;
    if (typeof maybeId === "string") formId = maybeId;
  }
  if (!formId) return;

  // Fetch the parent form
  const form = await fetchParentForm(config, formId, nextly);
  if (!form) return;

  const notifications = Array.isArray(form.notifications)
    ? (form.notifications as FormNotificationItem[])
    : [];
  if (notifications.length === 0) return;

  const emailService = nextly.services.email;
  if (!emailService) return;

  const submittedData = (submission.data ?? {}) as Record<string, unknown>;

  // Collect mediaIds from file fields marked for email attachment
  const formFields = Array.isArray(form.fields)
    ? (form.fields as Array<Record<string, unknown>>)
    : [];
  const fileAttachments = collectAttachmentInputs(formFields, submittedData);

  const seen = new Set<string>();

  for (const notification of notifications) {
    if (!notification.enabled || !notification.templateSlug) continue;

    // Deduplicate (UI can append duplicates on repeated saves)
    const key =
      notification.id || `${notification.to}::${notification.templateSlug}`;
    if (seen.has(key)) continue;
    seen.add(key);

    try {
      const to =
        notification.recipientType === "field"
          ? resolveFieldRef(notification.to, submittedData)
          : notification.to;

      if (!to) {
        nextly.infra.logger.warn?.(
          "Form Builder: empty recipient, skipping notification",
          { notificationId: notification.id, formSlug: form.slug }
        );
        continue;
      }

      const cc =
        Array.isArray(notification.cc) && notification.cc.length
          ? notification.cc
          : undefined;
      const bcc =
        Array.isArray(notification.bcc) && notification.bcc.length
          ? notification.bcc
          : undefined;

      await emailService.sendWithTemplate(
        notification.templateSlug,
        to,
        { ...submittedData, formName: form.name, submissionId: submission.id },
        {
          providerId: notification.providerId,
          cc,
          bcc,
          attachments: fileAttachments.length > 0 ? fileAttachments : undefined,
        }
      );

      nextly.infra.logger.info?.("Form Builder: notification sent", {
        formSlug: form.slug,
        to,
        templateSlug: notification.templateSlug,
        attachmentCount: fileAttachments.length,
      });
    } catch (err) {
      nextly.infra.logger.error?.("Form Builder: notification failed", {
        notificationId: notification.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Fetch the parent form document for a submission.
 */
async function fetchParentForm(
  config: ResolvedFormBuilderConfig,
  formId: string,
  nextly: NextlyInstance
): Promise<Record<string, unknown> | null> {
  try {
    const handler = getCollectionsHandler();
    if (!handler) {
      nextly.infra.logger.warn?.(
        "Form Builder: CollectionsHandler unavailable, skipping notifications"
      );
      return null;
    }
    const result = await handler.getEntry({
      collectionName: config.formOverrides.slug,
      entryId: formId,
      overrideAccess: true,
    });
    const fromData = result?.data;
    if (fromData) return fromData as Record<string, unknown>;
    const fromDoc = (result as { doc?: unknown } | undefined)?.doc;
    if (fromDoc && typeof fromDoc === "object") {
      return fromDoc as Record<string, unknown>;
    }
    return null;
  } catch (err) {
    nextly.infra.logger.error?.("Form Builder: failed to fetch form", {
      formId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
