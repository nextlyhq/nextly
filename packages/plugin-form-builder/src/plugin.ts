/**
 * Form Builder Plugin
 *
 * Visual form builder with drag-and-drop UI, submission management,
 * email notifications, and spam protection.
 *
 * @module plugin
 * @since 0.1.0
 */

import { definePlugin, type PluginDefinition } from "@nextlyhq/plugin-sdk";
import type { CollectionConfig } from "nextly";
// `getCollectionsHandler` runs inside Next.js request handlers, so it
// lives behind the runtime subpath. Importing from
// the root would drag Next.js subpaths into Node-only contexts (CLI,
// config loaders) that pull this plugin via `nextly.config.ts`.
import { getCollectionsHandler } from "nextly/runtime";
// Author against the SDK — the stable, experimental plugin boundary (D43).

import { formsCollection } from "./collections/forms";
import { submissionsCollection } from "./collections/submissions";
import type {
  BeforeEmailFilterContext,
  FormNotificationItem,
  FormBuilderPluginOptions,
  FormEmailNotification,
  FormDocument,
  SubmissionDocument,
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
 * import { defineConfig } from "nextly/config";
 * import { formBuilder } from "@nextlyhq/plugin-form-builder";
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

  const plugin = definePlugin({
    name: "@nextlyhq/plugin-form-builder",
    version: "0.0.8",
    nextly: ">=0.0.2-alpha.21",

    // Declarative schema (P2/D12): the merged pipeline folds these into the
    // app schema — no manual `setup()` append needed. Just register the plugin.
    contributes: {
      collections: [formsCol, submissionsCol],
      // Custom permission (D36) — gates submission export beyond CRUD. The
      // canonical example third-party plugin authors copy.
      permissions: [
        {
          action: "export",
          resource: "submissions",
          label: "Export Submissions",
          description: "Export form submissions as CSV/JSON",
          group: "Form Builder",
        },
      ],
      // HTTP route (P4/D25) — exported at
      // /api/plugins/@nextlyhq/plugin-form-builder/submissions/export. Secure by
      // default (D28): gated by the custom `export-submissions` permission. Reads
      // via the secure-by-default service path as the authed user (D35) and
      // resolves its OWN slug through `ctx.self` (D54). The canonical
      // contributes.routes example for third-party authors.
      routes: [
        {
          method: "GET",
          path: "/submissions/export",
          requiredPermission: "export-submissions",
          handler: async (_req, ctx) => {
            const declaredSlug = resolvedConfig.formSubmissionOverrides.slug;
            const slug = ctx.self.collections[declaredSlug] ?? declaredSlug;
            const result = await ctx.services.collections.listEntries(
              slug,
              {},
              { as: "user", user: ctx.user ?? undefined }
            );
            return Response.json({ items: result.data });
          },
        },
      ],
      // Admin UI (P5/D19–D23) — the canonical contributes.admin example. Paths
      // are the components form-builder's `/admin` module self-registers (kept
      // as literals so this node entry stays React-free). menu (D20) links to
      // the forms collection; settings (D21) renders the builder UI at
      // /admin/plugins/<slug>; a custom page (D21) is gated by export-submissions;
      // a submissions beforeList view (D23) injects the filter above the list.
      admin: {
        menu: [
          {
            label: "Forms",
            to: `/admin/collections/${resolvedConfig.formOverrides.slug}`,
            icon: "file-text",
            order: 50,
            requiredPermission: `read-${resolvedConfig.formOverrides.slug}`,
          },
        ],
        settings: {
          component: "@nextlyhq/plugin-form-builder/admin#FormBuilderView",
        },
        pages: [
          {
            path: "submissions",
            component: "@nextlyhq/plugin-form-builder/admin#SubmissionsFilter",
            requiredPermission: "export-submissions",
          },
        ],
        views: {
          [resolvedConfig.formSubmissionOverrides.slug]: {
            beforeList: "@nextlyhq/plugin-form-builder/admin#SubmissionsFilter",
          },
        },
      },
    },

    admin: {
      order: 50,
      description: "Create and manage forms with submission tracking",
    },

    // -- Init ----------------------------------------------------------------
    // Registers an afterCreate hook on submissions to send email notifications.
    init(nextly: NextlyInstance) {
      // Resolve our OWN submissions slug through ctx.self (D54), so the hook
      // follows a framework `.rename()` as well as our formSubmissionOverrides
      // option. The declared slug is the key; ctx.self maps it to the resolved
      // (possibly renamed) slug. Identity when not renamed.
      const declaredSubmissionsSlug =
        resolvedConfig.formSubmissionOverrides.slug;
      const submissionSlug =
        nextly.self.collections[declaredSubmissionsSlug] ??
        declaredSubmissionsSlug;

      // Prevent duplicate hook registration in Next.js dev mode
      const guardKey = `__formBuilder_afterCreate_${submissionSlug}`;
      const g = globalThis as Record<string, unknown>;
      if (g[guardKey]) return;
      g[guardKey] = true;

      nextly.logger.info("Form Builder plugin initialized", {
        formsCollection: resolvedConfig.formOverrides.slug,
        submissionsCollection: submissionSlug,
        enabledFields: Object.entries(resolvedConfig.fields)
          .filter(([, on]) => on)
          .map(([name]) => name),
      });

      (nextly as NextlyWithFormBuilderConfig).__formBuilderConfig =
        resolvedConfig;

      // D63: run the user's beforeEmail config as a filter on the form-builder seam.
      if (resolvedConfig.beforeEmail) {
        nextly.filters.add(
          "form-builder.beforeEmail",
          (emails: FormEmailNotification[], ctx: BeforeEmailFilterContext) =>
            resolvedConfig.beforeEmail!({
              emails,
              // Boundary: loose runtime documents → the user's typed contract.
              form: ctx.form as unknown as FormDocument,
              submission: ctx.submission as unknown as SubmissionDocument,
            })
        );
      }

      // Register afterCreate hook for email notifications
      nextly.hooks.on(
        "afterCreate",
        submissionSlug,
        async (context: unknown) => {
          await handleSubmissionCreated(context, resolvedConfig, nextly);
        }
      );
    },
  });

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

  // -- Build phase: resolve each enabled notification into an outgoing
  // descriptor (the value the D63 seam transforms).
  const emails: FormEmailNotification[] = [];

  for (const notification of notifications) {
    if (!notification.enabled || !notification.templateSlug) continue;

    // Deduplicate (UI can append duplicates on repeated saves)
    const key =
      notification.id || `${notification.to}::${notification.templateSlug}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const to =
      notification.recipientType === "field"
        ? resolveFieldRef(notification.to, submittedData)
        : notification.to;

    if (!to) {
      nextly.logger.warn?.(
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

    emails.push({
      to,
      templateSlug: notification.templateSlug,
      variables: {
        ...submittedData,
        formName: form.name,
        submissionId: submission.id,
      },
      providerId: notification.providerId,
      cc,
      bcc,
      notificationId: notification.id,
    });
  }

  if (emails.length === 0) return;

  // -- Seam: thread the outgoing notifications through the D63 filter so user
  // config (and any other registered handler) can modify/filter them.
  const finalEmails = await nextly.filters.apply<
    FormEmailNotification[],
    BeforeEmailFilterContext
  >("form-builder.beforeEmail", emails, { form, submission });

  // -- Send phase: send the (possibly transformed) outgoing notifications.
  for (const email of finalEmails) {
    try {
      await emailService.sendWithTemplate(
        email.templateSlug,
        email.to,
        email.variables,
        {
          providerId: email.providerId,
          cc: email.cc,
          bcc: email.bcc,
          attachments: fileAttachments.length > 0 ? fileAttachments : undefined,
        }
      );

      nextly.logger.info?.("Form Builder: notification sent", {
        formSlug: form.slug,
        to: email.to,
        templateSlug: email.templateSlug,
        notificationId: email.notificationId,
        attachmentCount: fileAttachments.length,
      });
    } catch (err) {
      nextly.logger.error?.("Form Builder: notification failed", {
        to: email.to,
        templateSlug: email.templateSlug,
        notificationId: email.notificationId,
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
      nextly.logger.warn?.(
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
    nextly.logger.error?.("Form Builder: failed to fetch form", {
      formId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
