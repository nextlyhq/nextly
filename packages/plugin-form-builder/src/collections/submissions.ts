/**
 * Form Submissions Collection
 *
 * Stores form submission data from user-submitted forms.
 * Each submission contains the submitted data, metadata, and status.
 *
 * @module collections/submissions
 * @since 0.1.0
 */

import type { CollectionConfig, FieldConfig, HookContext } from "nextly";
import { text, textarea, select, json, date, relationship } from "nextly";

import type { ResolvedFormBuilderConfig } from "../types";

import { accessWithDefaults } from "./access-defaults";

/**
 * Extended CollectionConfig with isPlugin support.
 * This extends the base CollectionConfig to include the isPlugin property.
 */
interface ExtendedCollectionConfig extends Omit<CollectionConfig, "admin"> {
  admin?: CollectionConfig["admin"] & {
    /** Whether this collection is provided by a plugin */
    isPlugin?: boolean;
  };
}

/**
 * Whether a create keeps the `submittedAt` it names: only one made on the
 * server with no request behind it (`req.http` absent), such as an import
 * restoring old submissions with their dates, and only where it names one.
 *
 * A create a request produced, a visitor's through the public grant above
 * all, is given the server's time whatever it says: the dashboard lists new
 * submissions newest first by this field, and a date a visitor chose (one far
 * in the future) would keep theirs ahead of every real submission.
 */
function trustedSubmittedAt(context: HookContext): boolean {
  return context.req?.http === undefined && Boolean(context.data?.submittedAt);
}

/** The unique index one response per person rests on. */
const RESPONSE_KEY_INDEX = {
  fields: ["form", "responseKey"],
  unique: true,
};

/** Whether two index declarations name the same columns and uniqueness. */
function sameIndex(
  index: { fields: readonly string[]; unique?: boolean },
  other: { fields: readonly string[]; unique?: boolean }
): boolean {
  return (
    index.fields.join("\u0000") === other.fields.join("\u0000") &&
    (index.unique ?? false) === (other.unique ?? false)
  );
}

/**
 * The fields the plugin itself gives every submission, whatever a host adds
 * through `formSubmissionOverrides.fields`. One list, read by the collection
 * and by what tells the admin which fields are the host's own.
 */
function builtInSubmissionFields(formSlug: string): FieldConfig[] {
  return [
    // ============================================================
    // Form Relationship
    // ============================================================
    relationship({
      name: "form",
      label: "Form",
      relationTo: formSlug,
      required: true,
      admin: {
        readOnly: true,
        description: "The form this submission belongs to",
      },
    }),

    // ============================================================
    // Submission Data (JSON)
    // ============================================================
    json({
      name: "data",
      label: "Submission Data",
      required: true,
      admin: {
        readOnly: true,
        description: "The submitted form data as JSON",
      },
    }),

    // ============================================================
    // Status
    // ============================================================
    select({
      name: "status",
      label: "Status",
      required: true,
      defaultValue: "new",
      options: [
        { label: "New", value: "new" },
        { label: "Read", value: "read" },
        { label: "Archived", value: "archived" },
        // Spam is stored and flagged, never silently dropped: a false
        // positive stays reviewable and recoverable ("Not spam" = back to new).
        { label: "Spam", value: "spam" },
      ],
      // Indexed with `submittedAt`: the dashboard's New form submissions card
      // and its header count filter every submission by status and list them
      // newest first, on every dashboard load.
      index: true,
      admin: {
        description: "Track whether this submission has been reviewed",
      },
    }),

    text({
      name: "spamReason",
      label: "Spam Reason",
      admin: {
        readOnly: true,
        description:
          "Which spam check flagged this submission (empty for clean submissions)",
      },
    }),

    // ============================================================
    // Internal Notes
    // ============================================================
    textarea({
      name: "notes",
      label: "Internal Notes",
      admin: {
        description: "Notes visible only to admins (not shown to submitter)",
      },
    }),

    // ============================================================
    // Metadata
    // ============================================================
    text({
      name: "ipAddress",
      label: "IP Address",
      admin: {
        readOnly: true,
        description: "IP address of the submitter",
      },
    }),

    text({
      name: "userAgent",
      label: "User Agent",
      admin: {
        readOnly: true,
        description: "Browser/device information of the submitter",
      },
    }),

    date({
      name: "submittedAt",
      label: "Submitted At",
      required: true,
      // The order the dashboard lists new submissions in (see `status`).
      index: true,
      admin: {
        readOnly: true,
        description: "When the form was submitted",
      },
    }),

    // Honesty stamps for admin edits of submitted data: a corrected
    // submission must never be indistinguishable from what the visitor sent.
    date({
      name: "editedAt",
      label: "Edited At",
      admin: {
        readOnly: true,
        description: "When an admin last edited the submitted data",
      },
    }),

    text({
      name: "editedBy",
      label: "Edited By",
      admin: {
        readOnly: true,
        description: "ID of the admin who last edited the submitted data",
      },
    }),

    // The submission's one-response key: a keyed digest of the email answer
    // or network address its form's "one response per person" compares,
    // never the value itself. Written by the plugin at the write seam, never
    // taken from a caller, and empty when the form allows several responses
    // or the submission is spam. Unique per form (see `indexes`), so two
    // submissions with the same value cannot both be stored.
    text({
      name: "responseKey",
      label: "One-response key",
      admin: { hidden: true },
    }),

    // What the submission was asked: each field's label, type and option
    // labels, and which fields its conditions hid, so its page reads as it
    // was answered after the form changes. Written by the plugin at the write
    // seam, never taken from a caller.
    json({
      name: "asked",
      label: "Fields asked",
      admin: { hidden: true },
    }),

    // Who sent it, as the admin names it (`submission-title`): its title in
    // the breadcrumb and lists. Written by the plugin from the answers, never
    // taken from a caller.
    text({
      name: "title",
      label: "Sender",
      admin: { hidden: true },
    }),
  ];
}

/**
 * The fields a host added to the submissions collection: every named
 * top-level field that is not one of the plugin's own, and not one the host
 * hid from the admin. The submission page shows them, since it replaces the
 * default editor that would have drawn them.
 */
export function submissionExtensionFields(
  pluginConfig: ResolvedFormBuilderConfig
): Array<{ name: string; label: string; type: string }> {
  const builtIn = new Set(
    builtInSubmissionFields(pluginConfig.formOverrides.slug).map(fieldName)
  );
  return submissionsCollection(pluginConfig)
    .fields.filter(field => !hiddenFromAdmin(field))
    .map(field => ({
      name: fieldName(field),
      label: fieldLabel(field),
      type: (field as { type: string }).type,
    }))
    .filter(field => field.name !== "" && !builtIn.has(field.name));
}

/** Whether a field is configured to stay out of the admin. */
function hiddenFromAdmin(field: FieldConfig): boolean {
  return (field as { admin?: { hidden?: unknown } }).admin?.hidden === true;
}

/** A field's name, or "" for a layout field that has none. */
function fieldName(field: FieldConfig): string {
  return "name" in field && typeof field.name === "string" ? field.name : "";
}

/** A field's label as the page shows it: its own, else its name. */
function fieldLabel(field: FieldConfig): string {
  const label = (field as { label?: unknown }).label;
  return typeof label === "string" && label !== "" ? label : fieldName(field);
}

/**
 * Generate the Form Submissions collection configuration.
 *
 * Creates a collection for storing form submissions with:
 * - Reference to the parent form
 * - Submitted data (JSON)
 * - Status tracking (new, read, archived)
 * - Metadata (IP, user agent, timestamp)
 * - Internal notes for admin use
 *
 * @param pluginConfig - Resolved plugin configuration
 * @returns CollectionConfig for the Submissions collection
 *
 * @example
 * ```typescript
 * const submissionsCol = submissionsCollection(resolvedConfig);
 * // Returns a collection with slug "form-submissions" (or custom slug from config)
 * ```
 */
export function submissionsCollection(
  pluginConfig: ResolvedFormBuilderConfig
): ExtendedCollectionConfig {
  const {
    slug,
    labels,
    fields: additionalFields,
    access: accessOverrides,
    ...overrides
  } = pluginConfig.formSubmissionOverrides;

  // Get the forms collection slug for the relationship
  const formSlug = pluginConfig.formOverrides.slug;

  // The plugin's own fields, then any the host adds through
  // formSubmissionOverrides (a function-style override is resolved in
  // plugin.ts before it reaches here).
  const submissionFields: FieldConfig[] = [
    ...builtInSubmissionFields(formSlug),
    ...(Array.isArray(additionalFields) ? additionalFields : []),
  ];

  // Convert hyphenated slug to underscored table name (e.g., "form-submissions" -> "form_submissions")
  const dbName = slug.replace(/-/g, "_");

  return {
    slug,
    dbName,
    labels,
    fields: submissionFields,
    timestamps: true,

    // Submissions carry visitor-entered answers plus ipAddress/userAgent, so the
    // default `entry.*` events stay suppressed — otherwise every submission would
    // be delivered to any endpoint subscribed to `entry.created` or `*`. Instead
    // emit a curated `form.submission.created` carrying ONLY safe metadata (which
    // form, when, and the status) — never the answers, IP, or user agent.
    webhooks: {
      record: false,
      emit: {
        event: "form.submission.created",
        fields: ["form", "submittedAt", "status"],
      },
    },

    admin: {
      isPlugin: true,
      group: "Forms",
      order: 51,
      useAsTitle: "title",
      description: "View and manage form submissions",
      // Submissions are created by visitors submitting forms — a hand-typed
      // "New Submission" would be fiction, so the admin never offers one.
      disableCreate: true,

      components: {
        // The full submissions experience (per-form columns, status tabs,
        // export) replaces the generic list.
        views: {
          List: {
            Component: "@nextlyhq/plugin-form-builder/admin#SubmissionsView",
          },
          // Each submission is a page of its own: its answers as asked, its
          // activity, and its status, note and details beside them.
          Edit: {
            Component: "@nextlyhq/plugin-form-builder/admin#SubmissionPage",
          },
        },
      },

      ...overrides.admin,
    },

    // Access control with sensible defaults
    // Public can create (submit forms); reading, updating and deleting need the
    // matching permission on the caller's role (`read-form-submissions`, ...).
    // `create: true` — a visitor submits without an account. Reading, updating
    // and deleting are the shared defaults.
    access: accessWithDefaults(accessOverrides, { create: true }),

    hooks: {
      // The submission time on creation. (The edit stamp for updates is
      // registered in plugin.ts init — direct registry hooks are the path
      // that runs for every API surface.)
      beforeValidate: [
        (context: HookContext) => {
          const { data, operation } = context;
          if (operation === "create" && data && !trustedSubmittedAt(context)) {
            data.submittedAt = new Date();
          }
          return data;
        },
      ],

      afterChange: [
        (context: HookContext) => {
          const { data } = context;
          return data;
        },
      ],
    },

    // Spread any additional overrides (excluding already used properties)
    ...overrides,

    // One response per person, held by the database: a second submission
    // with the same key on the same form is refused at its insert, even when
    // two arrive at once. A submission with no key is not constrained. Kept
    // beside any indexes the site adds, after the overrides, so customising
    // the indexes cannot drop the one the rule depends on.
    indexes: [
      RESPONSE_KEY_INDEX,
      ...(overrides.indexes ?? []).filter(
        index => !sameIndex(index, RESPONSE_KEY_INDEX)
      ),
    ],
  };
}
