/**
 * Form Submissions Collection
 *
 * Stores form submission data from user-submitted forms.
 * Each submission contains the submitted data, metadata, and status.
 *
 * @module collections/submissions
 * @since 0.1.0
 */

import type {
  CollectionConfig,
  FieldConfig,
  HookContext,
} from "@revnixhq/nextly";
import {
  text,
  textarea,
  select,
  json,
  date,
  relationship,
} from "@revnixhq/nextly";

import type { ResolvedFormBuilderConfig } from "../types";

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

  // Build the default fields array
  const defaultFields: FieldConfig[] = [
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
      ],
      admin: {
        description: "Track whether this submission has been reviewed",
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
      admin: {
        readOnly: true,
        description: "When the form was submitted",
      },
    }),
  ];

  // Process additional fields from formSubmissionOverrides
  // Note: Function-style overrides should be resolved in plugin.ts before reaching here
  let finalFields: FieldConfig[];

  if (Array.isArray(additionalFields) && additionalFields.length > 0) {
    // Merge: append additional fields to defaults
    finalFields = [...defaultFields, ...additionalFields];
  } else {
    finalFields = defaultFields;
  }

  // Convert hyphenated slug to underscored table name (e.g., "form-submissions" -> "form_submissions")
  const dbName = slug.replace(/-/g, "_");

  return {
    slug,
    dbName,
    labels,
    fields: finalFields,
    timestamps: true,

    admin: {
      isPlugin: true,
      group: "Forms",
      order: 51,
      useAsTitle: "id",
      description: "View and manage form submissions",

      // Custom components for submissions list
      components: {
        // Filter dropdown to filter submissions by form
        BeforeListTable:
          "@revnixhq/plugin-form-builder/admin#SubmissionsFilter",
      },

      ...overrides.admin,
    },

    // Access control with sensible defaults
    // Public can create (submit forms), but only authenticated users can read/update/delete
    access: {
      // Anyone can submit forms (public access)
      create: accessOverrides?.create ?? true,
      // Only authenticated users can view submissions
      read: accessOverrides?.read ?? (({ user }) => !!user),
      // Only authenticated users can update submissions (e.g., change status, add notes)
      update: accessOverrides?.update ?? (({ user }) => !!user),
      // Only admins can delete submissions (falls back to DB permissions)
      delete:
        accessOverrides?.delete ??
        (({ roles }) =>
          roles.includes("admin") || roles.includes("super-admin")),
    },

    hooks: {
      // Auto-set submittedAt timestamp on creation
      beforeValidate: [
        (context: HookContext) => {
          const { data, operation } = context;
          if (operation === "create" && data && !data.submittedAt) {
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
  };
}
