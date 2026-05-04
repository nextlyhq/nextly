/**
 * Forms Collection
 *
 * Stores form definitions created via Code-First or Schema Builder.
 * Each form contains field definitions, settings, notifications, and access control.
 *
 * @module collections/forms
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
  checkbox,
  group,
  json,
  relationship,
} from "@revnixhq/nextly";

import type { ResolvedFormBuilderConfig } from "../types";

// ============================================================
// Type Augmentation for Custom Admin Components
// ============================================================
// These types extend CollectionAdminOptions to support custom admin views.
// This augmentation will be removed once @revnixhq/nextly exports these types.

/**
 * Component path string format.
 * Format: `"package-name/path#ExportName"`
 */
type ComponentPath = string;

/**
 * Custom view configuration for replacing default admin views.
 */
interface CollectionAdminViewConfig {
  /** Component path to the custom view component */
  Component: ComponentPath;
}

/**
 * Custom components configuration for collection admin UI.
 */
interface CollectionAdminComponents {
  views?: {
    Edit?: CollectionAdminViewConfig;
    List?: CollectionAdminViewConfig;
  };
  BeforeListTable?: ComponentPath;
  AfterListTable?: ComponentPath;
  BeforeEdit?: ComponentPath;
  AfterEdit?: ComponentPath;
}

/**
 * Extended CollectionConfig with custom admin components support.
 * This extends the base CollectionConfig to include the components property.
 */
interface ExtendedCollectionConfig extends Omit<CollectionConfig, "admin"> {
  admin?: CollectionConfig["admin"] & {
    /** Whether this collection is provided by a plugin */
    isPlugin?: boolean;
    components?: CollectionAdminComponents;
  };
}

/**
 * Generate the Forms collection configuration.
 *
 * Creates a collection for storing form definitions with fields,
 * settings, notifications, and access control.
 *
 * @param pluginConfig - Resolved plugin configuration
 * @returns ExtendedCollectionConfig for the Forms collection (with custom admin components)
 *
 * @example
 * ```typescript
 * const formsCol = formsCollection(resolvedConfig);
 * // Returns a collection with slug "forms" (or custom slug from config)
 * ```
 */
export function formsCollection(
  pluginConfig: ResolvedFormBuilderConfig
): ExtendedCollectionConfig {
  const {
    slug,
    labels,
    fields: additionalFields,
    access: accessOverrides,
    ...overrides
  } = pluginConfig.formOverrides;

  // Build settings group fields based on plugin configuration
  const settingsFields: FieldConfig[] = [
    text({
      name: "submitButtonText",
      label: "Submit Button Text",
      defaultValue: "Submit",
      admin: {
        description: "Text displayed on the form submit button",
      },
    }),

    select({
      name: "confirmationType",
      label: "After Submission",
      defaultValue: "message",
      options: [
        { label: "Show Message", value: "message" },
        { label: "Redirect to URL", value: "redirect" },
        ...(pluginConfig.redirectRelationships.length > 0
          ? [{ label: "Redirect to Page", value: "relationship" }]
          : []),
      ],
      admin: {
        description: "What happens after a successful form submission",
      },
    }),

    textarea({
      name: "successMessage",
      label: "Success Message",
      defaultValue: "Thank you for your submission!",
      admin: {
        description: "Message shown after successful submission",
        condition: {
          field: "settings.confirmationType",
          equals: "message",
        },
      },
    }),

    text({
      name: "redirectUrl",
      label: "Redirect URL",
      admin: {
        description: "URL to redirect to after submission",
        condition: {
          field: "settings.confirmationType",
          equals: "redirect",
        },
      },
    }),
  ];

  // Add redirect relationship field if configured
  if (pluginConfig.redirectRelationships.length > 0) {
    settingsFields.push(
      relationship({
        name: "redirectPage",
        label: "Redirect Page",
        relationTo: pluginConfig.redirectRelationships,
        admin: {
          description: "Select a page to redirect to after submission",
          condition: {
            field: "settings.confirmationType",
            equals: "relationship",
          },
        },
      })
    );
  }

  // Add remaining settings fields
  settingsFields.push(
    checkbox({
      name: "allowMultipleSubmissions",
      label: "Allow Multiple Submissions",
      defaultValue: true,
      admin: {
        description:
          "Allow the same user/IP to submit this form multiple times",
      },
    }),

    checkbox({
      name: "captchaEnabled",
      label: "Enable reCAPTCHA",
      defaultValue: false,
      admin: {
        description: "Protect this form with Google reCAPTCHA v3",
      },
    }),

    text({
      name: "captchaSiteKey",
      label: "reCAPTCHA Site Key",
      admin: {
        description: "Override the default reCAPTCHA site key for this form",
        condition: {
          field: "settings.captchaEnabled",
          equals: true,
        },
      },
    })
  );

  // Build the default fields array
  const defaultFields: FieldConfig[] = [
    // ============================================================
    // Basic Information
    // ============================================================
    text({
      name: "name",
      label: "Form Name",
      required: true,
      admin: {
        description: "Internal name for this form (not shown to users)",
      },
    }),

    text({
      name: "slug",
      label: "Slug",
      required: true,
      unique: true,
      admin: {
        description: "URL-friendly identifier. Used in API: /api/forms/{slug}",
      },
    }),

    textarea({
      name: "description",
      label: "Description",
      admin: {
        description: "Internal notes about this form's purpose",
      },
    }),

    // ============================================================
    // Form Fields (JSON schema managed by Form Builder UI)
    // ============================================================
    json({
      name: "fields",
      label: "Form Fields",
      required: true,
      defaultValue: [],
      admin: {
        description:
          "Form field configuration. Managed by the Form Builder UI.",
      },
    }),

    // ============================================================
    // Form Settings
    // ============================================================
    group({
      name: "settings",
      label: "Form Settings",
      fields: settingsFields,
    }),

    // ============================================================
    // Email Notifications
    // ============================================================
    json({
      name: "notifications",
      label: "Email Integrations",
      defaultValue: [],
      admin: {
        description:
          "Email notification integrations. Managed by the Form Builder UI.",
      },
    }),

    // ============================================================
    // Status
    // ============================================================
    select({
      name: "status",
      label: "Status",
      required: true,
      defaultValue: "draft",
      options: [
        { label: "Draft", value: "draft" },
        { label: "Published", value: "published" },
        { label: "Closed", value: "closed" },
      ],
      admin: {
        description:
          "Only published forms can receive submissions. Closed forms display a message instead.",
      },
    }),

    textarea({
      name: "closedMessage",
      label: "Closed Form Message",
      defaultValue: "This form is no longer accepting submissions.",
      admin: {
        description: "Message shown when form status is 'closed'",
        condition: {
          field: "status",
          equals: "closed",
        },
      },
    }),
  ];

  // Process additional fields from formOverrides
  // Note: Function-style overrides should be resolved in plugin.ts before reaching here
  let finalFields: FieldConfig[];

  if (Array.isArray(additionalFields) && additionalFields.length > 0) {
    // Merge: append additional fields to defaults
    finalFields = [...defaultFields, ...additionalFields];
  } else {
    finalFields = defaultFields;
  }

  // Convert hyphenated slug to underscored table name for database compatibility
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
      order: 50,
      useAsTitle: "name",
      description:
        "Create and manage your form templates using the visual form builder. Create and manage forms for collecting user submissions",

      // Custom components for visual form builder
      components: {
        views: {
          // Replace default edit view with visual Form Builder
          Edit: {
            Component: "@revnixhq/plugin-form-builder/admin#FormBuilderView",
          },
        },
      },

      ...overrides.admin,
    },

    // Access control with sensible defaults
    access: {
      // Anyone can read forms (needed for frontend rendering)
      read: accessOverrides?.read ?? true,
      // Only authenticated users can create/update forms
      create: accessOverrides?.create ?? (({ user }) => !!user),
      update: accessOverrides?.update ?? (({ user }) => !!user),
      // Only admins can delete forms (falls back to DB permissions)
      delete:
        accessOverrides?.delete ??
        (({ roles }) =>
          roles.includes("admin") || roles.includes("super-admin")),
    },

    hooks: {
      // Auto-generate slug from name if not provided
      beforeValidate: [
        (context: HookContext) => {
          const { data, operation } = context;

          // Auto-generate slug from name if not provided (only on create)
          if (operation === "create" && data && !data.slug && data.name) {
            data.slug = String(data.name)
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-+|-+$/g, "");
          }

          // Validation: Ensure fields array is not empty
          // We check for length 0 to prevent empty forms from being saved
          if (
            data &&
            (data.fields === undefined ||
              (Array.isArray(data.fields) && data.fields.length === 0))
          ) {
            throw new Error("Form must have at least one field.");
          }

          return data;
        },
      ],

      // Add virtual submission count field
      afterRead: [
        (context: HookContext) => {
          const { data } = context;
          if (data) {
            // Placeholder: submission count will be implemented in Phase 4
            // when the FormSubmissionService is available
            (data as Record<string, unknown>).submissionCount = 0;
          }
          return data;
        },
      ],
    },

    // Spread any additional overrides (excluding already used properties)
    ...overrides,
  };
}
