/**
 * Form Builder Plugin
 *
 * Visual form builder with drag-and-drop UI, submission management,
 * email notifications, and spam protection.
 *
 * @module plugin
 * @since 0.1.0
 */

import { createRequire } from "node:module";

import { definePlugin, type PluginDefinition } from "@nextlyhq/plugin-sdk";
import type { CollectionConfig } from "nextly";
// Author against the SDK — the stable, experimental plugin boundary.

import { formsCollection } from "./collections/forms";
import { submissionsCollection } from "./collections/submissions";
import type {
  BeforeEmailFilterContext,
  FormNotification,
  FormBuilderPluginOptions,
  FormEmailNotification,
  FormDocument,
  SubmissionDocument,
  ResolvedFormBuilderConfig,
} from "./types";
import { evaluateSingleCondition } from "./utils/evaluate-conditions";
import { exportToCSV, generateExportFilename } from "./utils/export-formats";

export type NextlyPlugin = PluginDefinition;

// Read the version from package.json so it can never drift from the published
// package. Node/config-side only (this module is not part of the admin bundle).
const { version: PLUGIN_VERSION } = createRequire(import.meta.url)(
  "../package.json"
) as { version: string };

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
  const formOverrides = options.formOverrides || {};
  const submissionOverrides = options.formSubmissionOverrides || {};

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
    version: PLUGIN_VERSION,
    nextly: ">=0.0.2-alpha.21",
    // Identity metadata for the admin plugins page, mirroring package.json.
    author: "Nextly",
    homepage: "https://nextlyhq.com",
    repository: "https://github.com/nextlyhq/nextly",
    license: "MIT",
    category: "forms",
    tags: ["forms", "submissions", "email-notifications"],

    // Declarative schema: the merged pipeline folds these into the
    // app schema — no manual `setup()` append needed. Just register the plugin.
    contributes: {
      collections: [formsCol, submissionsCol],
      // Custom permission — gates submission export beyond CRUD. The
      // canonical example third-party plugin authors copy.
      permissions: [
        {
          action: "export",
          resource: "submissions",
          label: "Export Submissions",
          description: "Export form submissions as CSV/JSON",
          // No `group`: the admin already files this under the plugin that
          // declared it, so naming the plugin again would nest it inside
          // itself. `group` is for a plugin with enough permissions to sort
          // its own into headings, which one is not.
          //
          // `danger` because the point of the permission is to take
          // submissions — names, emails, whatever a form asked for — out of
          // the site in a file.
          danger: true,
        },
      ],
      // HTTP route — exported at
      // /api/plugins/@nextlyhq/plugin-form-builder/submissions/export. Secure by
      // default: gated by the custom `export-submissions` permission. Reads
      // via the secure-by-default service path as the authed user and
      // resolves its OWN slug through `ctx.self`. The canonical
      // contributes.routes example for third-party authors.
      routes: [
        {
          method: "GET",
          path: "/submissions/export",
          requiredPermission: "export-submissions",
          handler: async (req, ctx) => {
            const declaredSlug = resolvedConfig.formSubmissionOverrides.slug;
            const slug = ctx.self.collections[declaredSlug] ?? declaredSlug;
            const url = new URL(req.url);
            const format = url.searchParams.get("format") ?? "json";
            const formId = url.searchParams.get("form");
            const status = url.searchParams.get("status");

            // Spam stays out of exports unless it is explicitly requested —
            // an export is "what people submitted", not "what bots sent".
            const where: Record<string, unknown> = {};
            if (formId) where.form = { equals: formId };
            if (status) where.status = { equals: status };
            else where.status = { not_equals: "spam" };

            const opts = { as: "user", user: ctx.user ?? undefined } as const;

            // CSV needs its form BEFORE any submissions are read: the
            // columns come from one form's fields, and a malformed request
            // must fail fast instead of paginating the whole table first.
            let form: Record<string, unknown> | undefined;
            if (format === "csv") {
              if (!formId) {
                return Response.json(
                  {
                    error: {
                      code: "VALIDATION_ERROR",
                      message: "CSV export requires a form parameter.",
                    },
                  },
                  { status: 400 }
                );
              }
              const formsSlugDeclared = resolvedConfig.formOverrides.slug;
              const formsSlug =
                ctx.self.collections[formsSlugDeclared] ?? formsSlugDeclared;
              const formResult = await ctx.services.collections.listEntries(
                formsSlug,
                { where: { id: { equals: formId } } },
                opts
              );
              form = formResult.data[0];
              if (!form) {
                return Response.json(
                  { error: { code: "NOT_FOUND", message: "Form not found." } },
                  { status: 404 }
                );
              }
            }

            // Page through the export with a hard ceiling: an unbounded loop
            // over a high-traffic form could hold the whole table in memory.
            // Hitting the ceiling is reported in a header, never silent.
            const MAX_EXPORT_ROWS = 50_000;
            const items: unknown[] = [];
            const pageSize = 200;
            let truncated = false;
            for (let page = 1; ; page += 1) {
              const result = await ctx.services.collections.listEntries(
                slug,
                { where, pagination: { limit: pageSize, page } },
                opts
              );
              items.push(...result.data);
              const pageWasFull = result.data.length === pageSize;
              if (items.length >= MAX_EXPORT_ROWS) {
                truncated = pageWasFull || items.length > MAX_EXPORT_ROWS;
                items.length = MAX_EXPORT_ROWS;
                break;
              }
              if (!pageWasFull) break;
            }
            const truncationHeaders: Record<string, string> = truncated
              ? { "X-Export-Truncated": "true" }
              : {};

            if (format !== "csv" || !form) {
              return Response.json({ items }, { headers: truncationHeaders });
            }

            // The service returns parsed entries; the export helpers declare
            // the document shapes — the boundary cast is through unknown.
            const csv = exportToCSV(
              items as unknown as SubmissionDocument[],
              form as unknown as FormDocument
            );
            const filename = generateExportFilename(
              typeof form.slug === "string" ? form.slug : "form",
              "csv"
            );
            return new Response(csv, {
              headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="${filename}"`,
                ...truncationHeaders,
              },
            });
          },
        },
        {
          // The builder UI reads the host's resolved field enable/disable map
          // from here, so the plugin option actually gates the type picker.
          // Options resolve server-side only; this is the one channel the
          // admin client has to them.
          method: "GET",
          path: "/builder-config",
          // Derived from the forms slug like the menu entry: with an
          // overridden slug, users hold read-<slug>, not read-forms.
          requiredPermission: `read-${resolvedConfig.formOverrides.slug}`,
          handler: (_req, ctx) =>
            Promise.resolve(
              Response.json({
                fields: resolvedConfig.fields,
                // Notification defaults the builder surfaces: defaultToEmail
                // seeds a new form's first rule, defaultFrom renders as the
                // inherited sender placeholder.
                notifications: {
                  defaultFrom: resolvedConfig.notifications.defaultFrom,
                  defaultToEmail: resolvedConfig.notifications.defaultToEmail,
                },
                // Runtime-resolved collection slugs (through ctx.self, so a
                // framework .rename() is honored too) — admin components
                // never hardcode "forms"/"form-submissions".
                slugs: {
                  forms:
                    ctx.self.collections[resolvedConfig.formOverrides.slug] ??
                    resolvedConfig.formOverrides.slug,
                  submissions:
                    ctx.self.collections[
                      resolvedConfig.formSubmissionOverrides.slug
                    ] ?? resolvedConfig.formSubmissionOverrides.slug,
                },
              })
            ),
        },
      ],
    },

    // Forms is a first-class destination, not a plugin detail: standalone
    // placement gives it its own main-rail icon after Media, and its
    // sub-sidebar lists the plugin's collections (Forms, Submissions) —
    // no separate menu contribution, so "Forms" exists exactly once.
    // Hosts preferring the Plugins section override placement in config.
    // (The old admin.settings.component that rendered a second full builder
    // at /admin/plugins/<slug> is gone; the collection Edit-view override
    // is the single FormBuilderView mount.)
    admin: {
      placement: "standalone",
      after: "media",
      order: 50,
      appearance: { icon: "FileText", label: "Forms" },
      description: "Create and manage forms with submission tracking",
    },

    // -- Init ----------------------------------------------------------------
    // Registers an afterCreate hook on submissions to send email notifications.
    init(nextly: NextlyInstance) {
      // Resolve our OWN submissions slug through ctx.self, so the hook
      // follows a framework `.rename()` as well as our formSubmissionOverrides
      // option. The declared slug is the key; ctx.self maps it to the resolved
      // (possibly renamed) slug. Identity when not renamed.
      const declaredSubmissionsSlug =
        resolvedConfig.formSubmissionOverrides.slug;
      const submissionSlug =
        nextly.self.collections[declaredSubmissionsSlug] ??
        declaredSubmissionsSlug;

      // Hook/event subscriptions are idempotent across HMR — the platform
      // clears a plugin's prior subscriptions before re-init (B2), so the old
      // globalThis dedup guard is no longer needed.
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

      // Stamp admin edits of submitted data: changing what the visitor
      // submitted must leave a visible trace. Registered directly on the
      // registry (like the notification hook) so it runs for every API
      // surface that updates a submission.
      nextly.hooks.on("beforeUpdate", submissionSlug, (context: unknown) => {
        const ctx = context as {
          data?: Record<string, unknown>;
          user?: { id?: string };
        };
        if (ctx.data && ctx.data.data !== undefined) {
          ctx.data.editedAt = new Date();
          ctx.data.editedBy = ctx.user?.id ?? null;
        }
        return ctx.data;
      });

      // Inject a real submissionCount into form reads (spam excluded — the
      // number answers "how many people submitted", not "how many bots").
      const declaredFormsSlug = resolvedConfig.formOverrides.slug;
      const formsSlug =
        nextly.self.collections[declaredFormsSlug] ?? declaredFormsSlug;
      nextly.hooks.on("afterRead", formsSlug, async (context: unknown) => {
        const data = (context as { data?: unknown }).data;
        // afterRead fires for single reads (one record) and list reads
        // (array); count each form either way. Counts run concurrently —
        // form lists are paginated, so this is a bounded fan-out of small
        // indexed queries, not a serial N+1 walk.
        const records = Array.isArray(data) ? data : data ? [data] : [];
        await Promise.all(
          records.map(async record => {
            const form = record as Record<string, unknown>;
            if (typeof form.id !== "string") return;
            try {
              // Count as system: whoever may read the form may see its
              // submission volume without holding submission read rights.
              form.submissionCount = await nextly.services.collections.count(
                submissionSlug,
                {
                  where: {
                    form: { equals: form.id },
                    status: { not_equals: "spam" },
                  },
                },
                { as: "system" }
              );
            } catch {
              // A failed count must never break reading the form itself.
              form.submissionCount = 0;
            }
          })
        );
      });
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
 * Normalize a JSON column value from a raw DB row into an object. Hook
 * contexts carry the row as stored, so the value may be an already-parsed
 * object (jsonb dialects) or a serialized string (text-storage dialects).
 *
 * @internal Exported for testing — not part of the public plugin API.
 */
export function parseJsonColumn(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Trim an address list and drop blanks; undefined when nothing remains. */
function normalizeAddressList(
  addresses: readonly string[] | undefined
): string[] | undefined {
  if (!Array.isArray(addresses)) return undefined;
  const cleaned = addresses
    .map(address => (typeof address === "string" ? address.trim() : ""))
    .filter(Boolean);
  return cleaned.length > 0 ? cleaned : undefined;
}

/** Why a notification rule produced no email for a given submission. */
export interface SkippedNotification {
  notificationId: string;
  reason: "empty-recipient" | "condition-unmet" | "no-template";
}

/**
 * Resolve a form's notification rules against one submission into outgoing
 * email descriptors, honoring everything a rule can configure: the send
 * condition gates the rule, the recipient/reply-to resolve `{{fieldName}}`
 * references, and the sender falls back from the rule's own address to the
 * plugin's `notifications.defaultFrom` (undefined lets the template/provider
 * default apply downstream).
 *
 * @internal Exported for testing — not part of the public plugin API.
 */
export function buildNotificationEmails(input: {
  notifications: readonly FormNotification[];
  submittedData: Record<string, unknown>;
  formName: unknown;
  submissionId: unknown;
  defaultFrom?: string;
}): { emails: FormEmailNotification[]; skipped: SkippedNotification[] } {
  const { notifications, submittedData, formName, submissionId, defaultFrom } =
    input;

  const seen = new Set<string>();
  const emails: FormEmailNotification[] = [];
  const skipped: SkippedNotification[] = [];

  for (const notification of notifications) {
    if (!notification.enabled) continue;

    if (!notification.templateSlug) {
      skipped.push({ notificationId: notification.id, reason: "no-template" });
      continue;
    }

    // Deduplicate (UI can append duplicates on repeated saves). For id-less
    // rules (API-authored), only an exact structural duplicate counts — a
    // to+template key would silently drop distinct rules that share a
    // recipient and template but differ elsewhere (e.g. their condition).
    const key = notification.id || JSON.stringify(notification);
    if (seen.has(key)) continue;
    seen.add(key);

    // An unmet send condition skips the rule for this submission — an
    // expected state, never an error.
    if (
      notification.condition &&
      !evaluateSingleCondition(notification.condition, submittedData)
    ) {
      skipped.push({
        notificationId: notification.id,
        reason: "condition-unmet",
      });
      continue;
    }

    // Trim every address on the way out: whitespace-only values must count
    // as empty, and stray spaces must not reach the provider as headers.
    const to = (
      notification.recipientType === "field"
        ? resolveFieldRef(notification.to, submittedData)
        : notification.to
    ).trim();

    if (!to) {
      skipped.push({
        notificationId: notification.id,
        reason: "empty-recipient",
      });
      continue;
    }

    const cc = normalizeAddressList(notification.cc);
    const bcc = normalizeAddressList(notification.bcc);

    // Sender resolution: the rule's own address wins, then the plugin's
    // configured default; undefined defers to the template/provider chain.
    const from =
      notification.senderEmail?.trim() || defaultFrom?.trim() || undefined;

    // Reply-To resolves {{fieldName}} like recipients do; a reference to a
    // field the visitor left empty degrades to "no Reply-To header" rather
    // than an invalid address.
    const replyTo = notification.replyTo
      ? resolveFieldRef(notification.replyTo, submittedData).trim() || undefined
      : undefined;

    emails.push({
      to,
      templateSlug: notification.templateSlug,
      variables: {
        ...submittedData,
        formName,
        submissionId,
      },
      providerId: notification.providerId,
      from,
      replyTo,
      cc,
      bcc,
      notificationId: notification.id,
    });
  }

  return { emails, skipped };
}

/**
 * Send email notifications after a form submission is created.
 */
async function handleSubmissionCreated(
  context: unknown,
  config: ResolvedFormBuilderConfig,
  nextly: NextlyInstance
): Promise<void> {
  // The plugin-level kill switch: `notifications.enabled: false` turns off
  // all form emails regardless of per-rule state.
  if (!config.notifications.enabled) return;

  const submission = (context as { data?: Record<string, unknown> }).data;
  if (!submission) return;

  // Spam is stored for review, but nobody gets emailed about it — otherwise
  // every bot hit would trigger the form's notification rules.
  if (submission.status === "spam") return;

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
    ? (form.notifications as FormNotification[])
    : [];
  if (notifications.length === 0) return;

  const emailService = nextly.services.email;
  if (!emailService) return;

  // The afterCreate hook receives the raw DB row, so on dialects that store
  // JSON columns as text (e.g. SQLite) `data` arrives serialized. Without
  // parsing it, {{field}} recipients, reply-to references, and send
  // conditions all silently see an empty submission.
  const submittedData = parseJsonColumn(submission.data);

  // Collect mediaIds from file fields marked for email attachment
  const formFields = Array.isArray(form.fields)
    ? (form.fields as Array<Record<string, unknown>>)
    : [];
  const fileAttachments = collectAttachmentInputs(formFields, submittedData);

  // -- Build phase: resolve each enabled notification into an outgoing
  // descriptor (the value the D63 seam transforms).
  const { emails, skipped } = buildNotificationEmails({
    notifications,
    submittedData,
    formName: form.name,
    submissionId: submission.id,
    defaultFrom: config.notifications.defaultFrom,
  });

  for (const skip of skipped) {
    if (skip.reason === "empty-recipient") {
      nextly.logger.warn?.(
        "Form Builder: empty recipient, skipping notification",
        { notificationId: skip.notificationId, formSlug: form.slug }
      );
    } else {
      // Unmet conditions and missing templates are expected states, not
      // faults — surface them only at debug level.
      nextly.logger.debug?.("Form Builder: notification skipped", {
        notificationId: skip.notificationId,
        formSlug: form.slug,
        reason: skip.reason,
      });
    }
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
          from: email.from,
          replyTo: email.replyTo,
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
export async function fetchParentForm(
  config: ResolvedFormBuilderConfig,
  formId: string,
  nextly: NextlyInstance
): Promise<Record<string, unknown> | null> {
  try {
    // D35/D56: read the parent form through the secure managed service as
    // system — the afterCreate hook runs without an ambient user. Replaces the
    // legacy `getCollectionsHandler()` + `overrideAccess` runtime path.
    const form = await nextly.services.collections.findEntryById(
      config.formOverrides.slug,
      formId,
      { as: "system" }
    );
    return form;
  } catch (err) {
    nextly.logger.error?.("Form Builder: failed to fetch form", {
      formId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
