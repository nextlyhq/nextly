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

import {
  definePlugin,
  NextlyError,
  type PluginDefinition,
} from "@nextlyhq/plugin-sdk";
import type { CollectionConfig } from "nextly";
// Author against the SDK — the stable, experimental plugin boundary.

import { formsCollection } from "./collections/forms";
import { submissionsCollection } from "./collections/submissions";
import {
  asFormDocument,
  asSubmissionDocument,
  asSubmissionDocuments,
} from "./document-shapes";
import {
  sameSubmittedPayload,
  submissionMarks,
  type SubmissionOriginMarks,
  prepareSubmission,
} from "./handlers/prepare-submission";
import { checkSpam, type SpamCheckResult } from "./handlers/spam-detection";
import type {
  AnyFormField,
  BeforeEmailFilterContext,
  FormNotification,
  FormBuilderPluginOptions,
  FormEmailNotification,
  ResolvedFormBuilderConfig,
} from "./types";
import { evaluateSingleCondition } from "./utils/evaluate-conditions";
import { exportToCSV, generateExportFilename } from "./utils/export-formats";
import { parseFieldRef } from "./utils/field-references";
import { normalizeRedirectRelationships } from "./utils/redirect-target";

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

    redirectRelationships: normalizeRedirectRelationships(
      options.redirectRelationships
    ),
    // Filled at `init` from each collection's own metadata. Empty until then,
    // and a slug that stays absent reads as unknown rather than as not
    // localized — see `ResolvedFormBuilderConfig`.
    redirectTargetLocalization: {},
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
              asSubmissionDocuments(items),
              asFormDocument(form)
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
                // Spam defaults the Settings tab surfaces, so per-form
                // override selects can show what "inherit" resolves to.
                spamProtection: {
                  honeypot: resolvedConfig.spamProtection.honeypot,
                  recaptchaEnabled:
                    resolvedConfig.spamProtection.recaptcha?.enabled ?? false,
                },
                // Runtime-resolved collection slugs (through ctx.self, so a
                // framework .rename() is honored too) — admin components
                // never hardcode "forms"/"form-submissions".
                // Names only. A pattern may be a function, which does not
                // survive JSON and which the browser has no use for — the
                // admin picks a document, the server builds the URL.
                redirectCollections: Object.keys(
                  resolvedConfig.redirectRelationships
                ),
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
    async init(nextly: NextlyInstance) {
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

      // Ask each redirect target collection whether it is localized. The save
      // rule and the submission path both need it and neither can reach the
      // registry themselves: a collection hook is handed `req.nextly`, which
      // is the Direct API and carries no metadata accessor. Resolved once here
      // and written onto the config both of them already close over.
      //
      // Per collection rather than in one call: a slug that cannot be read
      // must stay ABSENT from the map, and a single failing lookup would
      // otherwise take its readable siblings with it.
      // Emptied first. `init` runs again on HMR and re-registration against the
      // SAME config object, so a lookup that succeeded on the previous boot and
      // fails on this one would leave its old answer standing while the catch
      // below believes it left the slug absent. A stale `false` then reads a
      // localized target as unreachable and drops its redirect; a stale `true`
      // lets a plain draft target through.
      for (const slug of Object.keys(
        resolvedConfig.redirectTargetLocalization
      )) {
        delete resolvedConfig.redirectTargetLocalization[slug];
      }

      // AWAITED, not fired and forgotten: a write reaching the save rule before
      // this resolves would find the map empty and read every target as
      // undecided, which is the refusal silently not happening.
      await Promise.all(
        Object.keys(resolvedConfig.redirectRelationships).map(
          async declared => {
            const slug = nextly.self.collections[declared] ?? declared;
            try {
              // `getCollection` reads registered metadata and does not consult
              // the context — its parameter is declared for a future ACL hook
              // and is unused today — so an empty context is the honest
              // argument rather than a fabricated user.
              const collection =
                await nextly.services.collections.getCollection(slug, {});
              const localized = (collection as { localized?: unknown })
                ?.localized;
              if (typeof localized === "boolean") {
                resolvedConfig.redirectTargetLocalization[declared] = localized;
              }
            } catch {
              // Left absent on purpose: unknown, not "not localized".
              nextly.logger.debug?.(
                "Redirect target localization could not be read",
                { collection: slug }
              );
            }
          }
        )
      );

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
              form: asFormDocument(ctx.form),
              submission: asSubmissionDocument(ctx.submission),
            })
        );
      }

      // Every submission is brought to the form's own shape here, whatever
      // created it. Registered directly on the registry, like the two below, so
      // it runs for every API surface that writes one: the plugin's HTTP
      // handler, `nextly.forms.submit()`, and an admin creating a row by hand.
      //
      // The Direct API did none of this. A submission arriving that way was
      // stored with whatever keys the caller sent, values that never met the
      // form's schema, and markup intact, while the same submission over HTTP
      // was transformed, validated and sanitized. Putting the rule at the write
      // seam rather than in the second caller is what stops a third one
      // inheriting the gap.
      // The forms slug, resolved the way the submissions one above is. A host
      // that renames a contributed collection takes the declared slug out of
      // the registry, so reading the parent form by `formOverrides.slug` finds
      // nothing, and this hook would then refuse every submission on a renamed
      // install. Resolved once here and used by both readers.
      const declaredFormsSlug = resolvedConfig.formOverrides.slug;
      const formsSlug =
        nextly.self.collections[declaredFormsSlug] ?? declaredFormsSlug;

      // `beforeChange` rather than `beforeCreate`: it is the last
      // COLLECTION-level mutating phase before the insert. Core runs stored
      // `beforeCreate` hooks after the code-registered ones, so a host hook
      // could put undeclared keys or markup back into a payload a
      // `beforeCreate` check had just passed.
      //
      // Field-level `beforeChange` hooks run after this one and are handed the
      // whole record, so a host that registers one on this collection can still
      // reshape `data` afterwards. No collection phase follows them to register
      // on, and core's own sanitizer sits earlier still, on `beforeCreate`.
      // This is the latest point a plugin can check from, which is not the same
      // as a point nothing can follow.
      nextly.hooks.on(
        "beforeChange",
        submissionSlug,
        async (context: unknown) =>
          prepareSubmissionForWrite(context, formsSlug, nextly)
      );

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
      // Reads the patch as it arrived. Core runs this phase before
      // `beforeChange`, so the payload the write seam adds to a status-only
      // patch is not here yet and cannot be mistaken for an admin's edit.
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
      nextly.hooks.on("afterRead", formsSlug, (context: unknown) =>
        injectSubmissionCount(context, submissionSlug, nextly)
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
  // The pattern is shared with the admin, which decides whether a value is a
  // reference at all. Written twice, a value the editor accepted and this did
  // not would be delivered with its braces intact.
  const name = parseFieldRef(ref);
  if (name === null) return ref;
  const value = data[name];
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
/**
 * Bring an incoming submission to the shape its form declares.
 *
 * Runs on `beforeCreate` for the submissions collection, so it sees every write
 * rather than every caller. The cost is one read of the parent form per
 * submission: the HTTP handler has already loaded it and cannot hand it over,
 * because a hook receives the row and not the request. Submissions are written
 * one visitor at a time and the read is by primary key, which is the cheaper
 * side of the trade against a rule two callers have to remember.
 *
 * Refuses rather than storing when it cannot judge. A form it cannot read, or
 * one whose `fields` is not a list, leaves nothing to transform against, and
 * transforming against an empty list would project the submission down to `{}`
 * and store a row that says the visitor sent nothing. Silently emptying someone's
 * submission is worse than declining it.
 *
 * A row that names no form is passed through untouched. `form` is `required` on
 * the collection, so it is already refused a step later, and rejecting it here
 * would answer a question this hook was not asked.
 */
/**
 * The parent form's id, however the row spells the relationship.
 *
 * A relationship arrives as an id string from a write and as a populated object
 * from a read, and both hooks on this collection have to cope with either.
 * Stated once so they cannot come to disagree about what counts as a reference.
 */
function parentFormId(submission: Record<string, unknown>): string | null {
  const raw = submission.form;
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") {
    const maybeId = (raw as { id?: unknown }).id;
    if (typeof maybeId === "string") return maybeId;
  }
  return null;
}

/**
 * The submitted payload, as an object, or a refusal.
 *
 * `data` arrives as an object from every caller in this repository. A string is
 * read as the JSON a dialect stores rather than assumed to be one field's
 * value, and anything else is refused: that column is `required`, so an omitted
 * payload is meant to be refused, and substituting `{}` satisfied the check on
 * the way past. A form whose fields are all optional then accepted the empty
 * object and the row was stored.
 */
function submittedPayload(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Falls through to the refusal below.
    }
  } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  throw NextlyError.validation({
    errors: [
      {
        path: "data",
        code: "INVALID",
        message: "Submission data must be an object.",
      },
    ],
  });
}

/**
 * Whether an update has to be brought back to the form's shape.
 *
 * Two kinds of update do, and one does not.
 *
 * A patch that replaces `data` is replacing what the visitor sent, so it is
 * checked exactly as the create was. Exempting every update meant a caller who
 * may edit a submission could put undeclared keys, values the form's schema
 * rejects and markup into the row a moment after the create had refused to
 * accept them.
 *
 * A patch that touches `form` moves the row under a different schema, and the
 * payload it already holds is what has to satisfy that one. Such a patch
 * carries no `data` of its own, so a rule keyed on `data` alone let a caller
 * move a submission onto any form and leave behind a payload the form it now
 * belongs to rejects.
 *
 * A patch that takes the row out of spam is the third. An evidence row was
 * stored WITHOUT being validated, deliberately, so that a false positive stays
 * reviewable. The admin's "Not spam" action sends only a status, and letting it
 * through unchecked turned a payload the form rejects into an ordinary counted
 * submission. Leaving spam is the moment that payload has to satisfy the form,
 * and a row that cannot has to be corrected in the same update.
 *
 * An update that does none of these leaves nothing to check: an admin changing
 * a status between two non-spam values sends only that, and preparing an absent
 * payload would store an empty submission over a real one. The last two are
 * left alone for the same reason when the stored row did not reach this hook,
 * since there is then no payload to judge.
 */
function updateNeedsChecking(
  submission: Record<string, unknown>,
  stored: Record<string, unknown> | undefined
): boolean {
  if (submission.data !== undefined) return true;
  // Everything below judges the STORED payload, so there has to be one.
  if (stored?.data === undefined) return false;
  if (submission.form !== undefined) return true;
  return (
    stored.status === "spam" &&
    submission.status !== undefined &&
    submission.status !== "spam"
  );
}

export async function prepareSubmissionForWrite(
  context: unknown,
  formsSlug: string,
  nextly: NextlyInstance
): Promise<Record<string, unknown> | undefined> {
  const ctx = context as {
    data?: Record<string, unknown>;
    operation?: string;
    originalData?: Record<string, unknown>;
    user?: { id?: string };
    req?: { http?: { ip: string | null; method: string } };
  };
  const submission = ctx.data;
  if (!submission || typeof submission !== "object") return ctx.data;
  const stored = ctx.originalData;

  // A patch need not repeat the relationship, so the stored row is what says
  // which form this payload has to match.
  const formId =
    parentFormId(submission) ?? (stored ? parentFormId(stored) : null);
  if (!formId) return ctx.data;

  if (ctx.operation !== "create" && !updateNeedsChecking(submission, stored)) {
    return ctx.data;
  }

  const incoming = submittedPayload(
    submission.data !== undefined ? submission.data : stored?.data
  );

  // Read off the row itself, so it describes this write and no other.
  const marks = submissionMarks(submission);

  const form = await formToCheckAgainst(marks, formsSlug, formId, nextly);
  const fields = form.fields as AnyFormField[];

  // Spam is judged HERE, at the seam every door passes through, rather than in
  // the route: the submissions collection grants public create, so the generic
  // collection create is a second public door and the Direct API a third. A
  // rule that lives in one of them guards one of them.
  //
  // Only when a request produced this write. `ctx.req.http` is absent for a
  // seed, an import or a job, and a rule aimed at a visitor must not judge a
  // server that is importing ten thousand rows as one.
  const spam =
    ctx.operation === "create" && ctx.req?.http
      ? await judgeSubmission(incoming, form, ctx.req.http, nextly)
      : undefined;

  if (spam?.reason === "rate_limit") {
    // Refused, not stored: a limiter that wrote a row per refusal would turn
    // volume into a database it fills for the attacker. The plugin's own route
    // answers its visitor with a success anyway, so a bot learns nothing from
    // it; the other doors are machine-facing and get the honest 429.
    throw NextlyError.rateLimited();
  }

  // Content spam keeps its evidence. The handler stores a honeypot or reCAPTCHA
  // hit flagged rather than dropping it, so a false positive stays recoverable,
  // and requiring it to be valid would throw away the thing being reviewed. It
  // is still transformed and sanitized.
  // Leniency is a fact about the CALL, not about the row. Reading it off
  // `status` made it caller-controlled: the collection grants public create and
  // nothing restricts that field, so anyone could post `status: "spam"` and
  // switch validation off for their own row.
  const prepared = prepareSubmission({
    data: incoming,
    fields,
    validate: marks?.keepAsEvidence !== true && spam === undefined,
  });

  if (prepared.validationErrors) {
    throw NextlyError.validation({
      errors: Object.entries(prepared.validationErrors).map(
        ([path, message]) => ({ path, code: "INVALID", message })
      ),
    });
  }

  ctx.data = { ...submission, data: prepared.data };
  if (spam) {
    // Flagged, never dropped: a false positive stays reviewable in the Spam
    // view and recoverable through "Not spam". Written here rather than trusted
    // from the payload, because the collection grants public create and nothing
    // restricts these fields, so a caller could otherwise mark its own row.
    ctx.data.status = "spam";
    ctx.data.spamReason = spam.reason ?? null;
  }
  if (ctx.operation !== "create" && submission.data === undefined) {
    stampDerivedEdit(ctx.data, ctx.user, incoming, prepared.data);
  }
  return ctx.data;
}

/**
 * The fields a submission has to satisfy.
 *
 * The handler that already read this form hands it over rather than have the
 * write read it a second time. That read is not free: `findEntryById` runs the
 * forms collection's `afterRead` hooks, and this plugin registers one that
 * COUNTs the form's submissions, so a write was paying for a count of every
 * write before it. Only ever the form this row names, because the id has to
 * match.
 */
async function formToCheckAgainst(
  marks: SubmissionOriginMarks | undefined,
  formsSlug: string,
  formId: string,
  nextly: NextlyInstance
): Promise<Record<string, unknown>> {
  const handedOver = marks?.form?.id === formId ? marks.form : null;
  const form = handedOver ?? (await fetchParentForm(formsSlug, formId, nextly));
  if (!form || !Array.isArray(form.fields)) {
    throw NextlyError.validation({
      errors: [
        {
          path: "form",
          code: "INVALID",
          message:
            "The form this submission belongs to could not be read, so the submission could not be checked against it.",
        },
      ],
    });
  }
  return form;
}

/**
 * The part of a rate-limit key that names the form.
 *
 * Only a string identifies a form; anything else shares a key with everything
 * else that is not a string, and one form's burst would then limit another.
 * Falls back to a constant that is explicit about naming no form, so a row
 * whose slug and id are both unusable is limited as its own bucket rather than
 * silently joining a neighbour's.
 */
function rateLimitKeyFor(form: Record<string, unknown>): string {
  const { slug, id } = form;
  if (typeof slug === "string" && slug.length > 0) return slug;
  if (typeof id === "string" && id.length > 0) return id;
  return "unidentified-form";
}

/**
 * Whether this submission looks like a bot's, and why.
 *
 * `undefined` means nothing was detected, which is not the same as "no rule
 * ran": a form that disables the honeypot and a deployment that configures no
 * rate limit both answer that way, and both mean the submission is stored as an
 * ordinary one.
 *
 * The address comes from the core, resolved under the deployment's proxy-trust
 * settings, so it is the closest untrusted hop rather than whatever the sender
 * put in `x-forwarded-for`. `null` means no address could be trusted, and the
 * rate limit does not run: keying it on a placeholder would put every
 * unidentifiable client in one window, where the first bot to fill it locks out
 * every visitor behind an untrusted proxy. The honeypot still applies, because
 * it reads the payload rather than the caller.
 */
async function judgeSubmission(
  payload: Record<string, unknown>,
  form: Record<string, unknown>,
  http: { ip: string | null; method: string },
  nextly: NextlyInstance
): Promise<SpamCheckResult | undefined> {
  const config = getFormBuilderConfig(nextly);
  if (!config) return undefined;

  // The trap is set among the keys the form does NOT declare. Several honeypot
  // names are ones a real form might use -- `website`, `url_field` -- so
  // probing the whole payload would flag every submission to a form that
  // declares one, and flag it as bot traffic.
  const declared = new Set(
    (Array.isArray(form.fields) ? form.fields : [])
      .map(field => (field as { name?: unknown }).name)
      .filter((name): name is string => typeof name === "string")
  );
  const undeclared = Object.fromEntries(
    Object.entries(payload).filter(([key]) => !declared.has(key))
  );

  const settings = (form.settings ?? {}) as { honeypotEnabled?: boolean };
  const verdict = await checkSpam({
    data: undeclared,
    ipAddress: http.ip ?? undefined,
    formSlug: rateLimitKeyFor(form),
    config: {
      honeypot: settings.honeypotEnabled ?? config.spamProtection.honeypot,
      rateLimit: config.spamProtection.rateLimit,
    },
  });
  return verdict.isSpam ? verdict : undefined;
}

/**
 * Record a payload change this hook derived, since nothing else will.
 *
 * A patch that did not carry a payload but changed one is still an edit of what
 * the visitor sent: moving a submission to another form re-projects its answers
 * onto that form's fields and can drop one it does not declare. The stamp on
 * `beforeUpdate` has already run by then and only marks a patch that arrived
 * with `data`, so without this the stored answers change with nothing in the
 * row saying who changed them.
 */
function stampDerivedEdit(
  row: Record<string, unknown>,
  user: { id?: string } | undefined,
  before: Record<string, unknown>,
  after: Record<string, unknown>
): void {
  if (sameSubmittedPayload(before, after)) return;
  row.editedAt = new Date();
  row.editedBy = user?.id ?? null;
}

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

  const formId = parentFormId(submission);
  if (!formId) return;

  // Fetch the parent form
  const declaredFormsSlug = config.formOverrides.slug;
  const form = await fetchParentForm(
    nextly.self.collections[declaredFormsSlug] ?? declaredFormsSlug,
    formId,
    nextly
  );
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
/**
 * Put a real `submissionCount` on every form a read returned.
 *
 * Spam is excluded, because the number answers "how many people submitted", not
 * "how many bots". `afterRead` fires for single reads and for list reads, so
 * both shapes are handled; the counts run concurrently, and form lists are
 * paginated, so this is a bounded fan-out of small indexed queries rather than
 * a serial walk.
 *
 * A read that asked for the schema alone is left alone. A submission write
 * reads its parent form only to check the payload against that form's fields,
 * and counting there is presentation work nobody on that path reads. It also
 * grows with the form's history, so every submission was paying for a count of
 * every submission before it.
 *
 * The flag decides how much work to do and nothing else. Forged, the worst it
 * can produce is a form read whose `submissionCount` is absent, and it cannot
 * come from a request body in any case: the hook context is set by the
 * server-side caller of the service.
 */
export async function injectSubmissionCount(
  context: unknown,
  submissionSlug: string,
  nextly: NextlyInstance
): Promise<void> {
  const hook = context as {
    data?: unknown;
    context?: Record<string, unknown>;
  };
  if (hook.context?.[SCHEMA_ONLY_READ] === true) return;

  const records = Array.isArray(hook.data)
    ? hook.data
    : hook.data
      ? [hook.data]
      : [];
  await Promise.all(
    records.map(async record => {
      const form = record as Record<string, unknown>;
      if (typeof form.id !== "string") return;
      try {
        // Count as system: whoever may read the form may see its submission
        // volume without holding submission read rights.
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
}

/**
 * Tells the form's `afterRead` hook that this read wants the schema and nothing
 * else, so it can skip work whose only purpose is to be displayed.
 */
const SCHEMA_ONLY_READ = "formBuilder.schemaOnlyRead";

export async function fetchParentForm(
  formsSlug: string,
  formId: string,
  nextly: NextlyInstance
): Promise<Record<string, unknown> | null> {
  try {
    // D35/D56: read the parent form through the secure managed service as
    // system — the afterCreate hook runs without an ambient user. Replaces the
    // legacy `getCollectionsHandler()` + `overrideAccess` runtime path.
    //
    // The slug arrives RESOLVED. Passing `formOverrides.slug` read the declared
    // name, which a host that renames the collection has taken out of the
    // registry, so the lookup found nothing on exactly the installs the rename
    // API supports.
    //
    // NOT on the caller's transaction, and it cannot be here. The plugin facade
    // rebuilds its context from `user` and `overrideAccess` alone, and
    // `CollectionService.findEntryById` forwards only those two to the entry
    // service, so an executor has nowhere to go on this path: passing one
    // looked like transaction awareness and was discarded before the query.
    //
    // The cost is written down rather than hidden. A submission created inside
    // a transaction alongside a form created in that same transaction cannot
    // see it and is refused, and on a pool whose only connection the
    // transaction holds, this read waits for it. Both fail safely. The pattern
    // for fixing it exists in collection-hook-service and
    // collection-access-service, which forward a context's executor for exactly
    // this reason; bringing it here means changing the entry service and the
    // plugin facade with it.
    const form = await nextly.services.collections.findEntryById(
      formsSlug,
      formId,
      { as: "system", context: { [SCHEMA_ONLY_READ]: true } }
    );
    return form;
  } catch (err) {
    // A form that is not there is an answer, and the caller decides what a
    // submission naming no form means. Anything else is the read itself
    // failing, and it is rethrown: swallowing a pool timeout or a throwing
    // `afterRead` hook turned a server fault into "this form could not be
    // read", so the writer was told their submission was invalid, with a status
    // that says not to retry.
    if (!NextlyError.isNotFound(err)) throw err;
    nextly.logger.error?.("Form Builder: form not found", {
      formId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
