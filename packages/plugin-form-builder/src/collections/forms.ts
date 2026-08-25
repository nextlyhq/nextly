/**
 * Forms Collection
 *
 * Stores form definitions created via Code-First or Schema Builder.
 * Each form contains field definitions, settings, notifications, and access control.
 *
 * @module collections/forms
 * @since 0.1.0
 */

import { NextlyError } from "@nextlyhq/plugin-sdk";
import type { CollectionConfig, FieldConfig, HookContext } from "nextly";
import {
  text,
  textarea,
  select,
  checkbox,
  group,
  json,
  relationship,
} from "nextly";

import type { ResolvedFormBuilderConfig } from "../types";
import { parseRedirectReference } from "../utils/redirect-reference";

// ============================================================
// Type Augmentation for Custom Admin Components
// ============================================================
// These types extend CollectionAdminOptions to support custom admin views.
// This augmentation will be removed once nextly exports these types.

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
/**
 * Whether a stored value names a page this plugin is configured to reach.
 *
 * `parseRedirectReference` answers which document a value names; it trusts an
 * explicit `relationTo` on purpose, because a form validated without plugin
 * config cannot judge one. Here the configuration IS known, so membership is
 * checked too: a reference into a collection with no URL pattern is a value
 * the resolver cannot use, and accepting it saves a form whose every
 * submission ends nowhere.
 */
function namesAConfiguredPage(
  value: unknown,
  collections: readonly string[]
): boolean {
  const reference = parseRedirectReference(value, collections);
  return reference !== null && collections.includes(reference.collection);
}

/**
 * The plugin's hooks, with a host's own appended per phase.
 *
 * A host may pass `formOverrides.hooks`, and the trailing `...overrides` spread
 * would otherwise replace this object outright — taking with it the slug
 * generation, the at-least-one-field rule and the redirect check, none of
 * which are the host's to remove. Those are invariants of the collection this
 * plugin ships; an override extends it rather than disarming it.
 *
 * Handlers in `pluginHooks` run FIRST — they are transformations a host may
 * want to build on, like the generated slug. Handlers in `trailing` run LAST,
 * after every host handler in that phase, which is where an INVARIANT has to
 * sit: one placed first is checked against a payload the host can still
 * rewrite afterwards.
 */
function withHostHooks<T>(
  pluginHooks: T,
  hostHooks: T | undefined,
  trailing: Partial<Record<string, unknown[]>> = {}
): T {
  const host = hostHooks ?? {};

  const asList = (value: unknown) =>
    Array.isArray(value) ? value : value === undefined ? [] : [value];

  const merged: Record<string, unknown> = { ...host };
  for (const [phase, handlers] of Object.entries(
    pluginHooks as Record<string, unknown>
  )) {
    merged[phase] = [...asList(handlers), ...asList(host[phase])];
  }
  for (const [phase, handlers] of Object.entries(trailing)) {
    merged[phase] = [...asList(merged[phase]), ...asList(handlers)];
  }
  return merged as T;
}

/**
 * Refuses a write whose redirect target the resolver could not use.
 *
 * One function, called from two phases. `beforeValidate` so an author gets the
 * error where the rest of the form's errors appear, and LAST in `beforeChange`
 * so the guarantee survives a host hook: a check placed before host handlers
 * judges a payload they can still rewrite, and one that can be rewritten past
 * is not an invariant.
 *
 * `setsSettings` mirrors the fields rule above. An update carries the patch
 * rather than the merged document, so treating an absent `settings` as empty
 * would reject every partial update — renaming a form — for a setting it never
 * touched.
 */
function assertRedirectTargetUsable(
  data: Record<string, unknown> | undefined,
  operation: string,
  redirectCollections: readonly string[]
) {
  const setsSettings = operation === "create" || data?.settings !== undefined;
  const settings = data?.settings as Record<string, unknown> | undefined;
  if (
    !data ||
    !setsSettings ||
    settings?.confirmationType !== "relationship" ||
    namesAConfiguredPage(settings.redirectPage, redirectCollections)
  ) {
    return;
  }

  throw NextlyError.validation({
    errors: [
      {
        path: "settings.redirectPage",
        code: "REQUIRED",
        message:
          "Choose a page to redirect to, or pick a different confirmation.",
      },
    ],
  });
}

export function formsCollection(
  pluginConfig: ResolvedFormBuilderConfig
): ExtendedCollectionConfig {
  const {
    slug,
    labels,
    fields: additionalFields,
    access: accessOverrides,
    hooks: hookOverrides,
    admin: adminOverrides,
    ...overrides
  } = pluginConfig.formOverrides;

  // Derived from the map rather than carried beside it: the collections a form
  // may redirect to are exactly the ones with a URL pattern configured, so
  // there is no second list to fall out of step with the first.
  const redirectCollections = Object.keys(pluginConfig.redirectRelationships);

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
        ...(redirectCollections.length > 0
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
  if (redirectCollections.length > 0) {
    settingsFields.push(
      relationship({
        name: "redirectPage",
        label: "Redirect Page",
        relationTo: redirectCollections,
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
      name: "honeypotEnabled",
      label: "Honeypot",
      admin: {
        description:
          "Per-form honeypot override; unset inherits the plugin default",
      },
    }),

    checkbox({
      name: "captchaEnabled",
      label: "Enable reCAPTCHA",
      admin: {
        description:
          "Per-form reCAPTCHA override; unset inherits the plugin default",
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
      label: "Notifications",
      defaultValue: [],
      admin: {
        description:
          "Email notification rules. Managed by the Form Builder UI.",
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
            Component: "@nextlyhq/plugin-form-builder/admin#FormBuilderView",
          },
        },
      },

      ...adminOverrides,
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

    hooks: withHostHooks(
      {
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

            // A form must have at least one field, checked against what the
            // write actually sets. An update carries the patch rather than the
            // merged document, so treating an absent `fields` as empty rejects
            // every partial update -- renaming a form, or changing a setting --
            // even though its fields are untouched and still there.
            const setsFields =
              operation === "create" || data?.fields !== undefined;
            if (
              data &&
              setsFields &&
              (data.fields === undefined ||
                (Array.isArray(data.fields) && data.fields.length === 0))
            ) {
              // Typed, so the rejection survives as a validation failure with
              // its field issue rather than being read as a crash and replaced
              // with a generic server-fault message.
              throw NextlyError.validation({
                errors: [
                  {
                    path: "fields",
                    code: "REQUIRED",
                    message: "Form must have at least one field.",
                  },
                ],
              });
            }

            // Reported here so an author sees it beside the form's other
            // errors. The GUARANTEE is the trailing `beforeChange` call below,
            // which a host hook cannot run after.
            assertRedirectTargetUsable(data, operation, redirectCollections);

            return data;
          },
        ],
      },
      hookOverrides,
      {
        // The authoritative call. A host `beforeValidate` may rewrite the
        // payload after the check above passed, and `beforeChange` is the last
        // phase before the write — so this is where the guarantee lives.
        beforeChange: [
          ({ data, operation }: HookContext) => {
            assertRedirectTargetUsable(data, operation, redirectCollections);
            return data;
          },
        ],
      }
    ),

    // Spread any additional overrides (excluding already used properties)
    ...overrides,
  };
}
