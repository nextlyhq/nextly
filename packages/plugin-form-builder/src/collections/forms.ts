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
import {
  documentIsReachable,
  parseRedirectReference,
  pickedDocumentField,
  type PickedDocumentField,
} from "../utils/redirect-reference";
import {
  applyRedirectPattern,
  type RedirectRelationships,
  type RedirectTargetDocument,
} from "../utils/redirect-target";

import { accessWithDefaults } from "./access-defaults";

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
  // Annotated rather than asserted. `hostHooks ?? {}` widens to `T | {}`
  // under the generic and cannot be indexed by phase name; a cast says the
  // same thing but reads as removable, and `--fix` removes it.
  const host: Record<string, unknown> = { ...hostHooks };

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
/**
 * The settings a write is SETTING to a page redirect, or null for every other
 * write.
 *
 * `setsSettings` mirrors the fields rule above. An update carries the patch
 * rather than the merged document, so treating an absent `settings` as empty
 * would refuse a rename for a setting it never touched.
 */
function documentRedirectSettings(
  settings: unknown
): { settings: Record<string, unknown>; field: PickedDocumentField } | null {
  if (typeof settings !== "object" || settings === null) return null;
  const record = settings as Record<string, unknown>;
  const field = pickedDocumentField(record);
  return field ? { settings: record, field } : null;
}

function pageRedirectSettings(
  data: Record<string, unknown> | undefined,
  operation: string
): { settings: Record<string, unknown>; field: PickedDocumentField } | null {
  if (!data) return null;
  if (operation !== "create" && data.settings === undefined) return null;
  return documentRedirectSettings(data.settings);
}

/**
 * Whether the form this write leaves behind can receive a submission.
 *
 * A form's `status` is its own lifecycle — draft, published, closed — and only
 * a published form accepts submissions, so only a published form can send a
 * visitor anywhere at all. That is the whole reason this rule is conditional:
 * a draft form pointing at a draft page is fine, because the two go live
 * together.
 *
 * The stored status is consulted when the write does not carry one. Publishing
 * a form and editing its settings are separate saves, and an update that never
 * mentions `status` leaves the stored one standing — so reading an absent
 * field as "not published" would wave through exactly the case this rule
 * exists to catch.
 */
export function formAcceptsSubmissions(
  data: Record<string, unknown> | undefined,
  originalData: Record<string, unknown> | undefined
): boolean {
  return (data?.status ?? originalData?.status) === "published";
}

/**
 * The stored `settings`, which is not the shape the payload uses.
 *
 * Measured on 2026-08-25: the incoming write carries `settings` as an OBJECT,
 * and the same field on `originalData` comes back as JSON TEXT. Reading the
 * stored row with the payload's reader answers "no redirect configured" for
 * every form that has one — silently, and indistinguishably from a form that
 * genuinely has none.
 */
function storedSettings(
  value: unknown
): { settings: Record<string, unknown>; field: PickedDocumentField } | null {
  if (typeof value === "string") {
    try {
      return documentRedirectSettings(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return documentRedirectSettings(value);
}

/**
 * The redirect target already stored on the form, for a write that does not
 * mention it.
 *
 * Publishing a form is such a write: it carries `status` and nothing else, and
 * the target it inherits is the one a visitor will be sent to. Without this,
 * the rule would guard the save that PICKS a draft page and ignore the save
 * that makes that same pairing reachable — protecting one path while appearing
 * to protect both.
 *
 * Nothing here is written back. `originalData` is the stored row, not the
 * payload; normalising it would edit a document this write never touched.
 */
function storedRedirectReference(
  originalData: Record<string, unknown> | undefined,
  patterns: RedirectRelationships
): {
  reference: { collection: string; id: string };
  field: PickedDocumentField;
} | null {
  const picked = storedSettings(originalData?.settings);
  if (!picked) return null;

  const collections = Object.keys(patterns);
  const reference = parseRedirectReference(
    picked.settings[picked.field],
    collections
  );
  return reference && collections.includes(reference.collection)
    ? { reference, field: picked.field }
    : null;
}

/**
 * Writes the parser's normalised names back into the row being saved.
 *
 * Not merely read: trimming only the parsed copy leaves the padded name in
 * `data`, so this rule accepts the write and the framework's own relationship
 * validator downstream still sees `" pages "`. The plugin and the framework
 * then disagree about a value this parser has already decided.
 */
function normalizeStoredReference(
  settings: Record<string, unknown>,
  field: PickedDocumentField,
  reference: { collection: string; id: string }
) {
  const stored = settings[field];

  if (typeof stored === "string") {
    if (stored !== reference.id) settings[field] = reference.id;
    return;
  }
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) {
    return;
  }

  const record = stored as Record<string, unknown>;
  if (record.relationTo !== reference.collection) {
    settings[field] = { ...record, relationTo: reference.collection };
  }
}

function assertRedirectTargetNamed(
  data: Record<string, unknown> | undefined,
  operation: string,
  patterns: RedirectRelationships
): {
  reference: { collection: string; id: string };
  field: PickedDocumentField;
} | null {
  const picked = pageRedirectSettings(data, operation);
  if (!picked) return null;
  const { settings, field } = picked;

  const collections = Object.keys(patterns);
  const reference = parseRedirectReference(settings[field], collections);
  if (!reference || !collections.includes(reference.collection)) {
    throw redirectRefusal(
      "Choose a page to redirect to, or pick a different confirmation.",
      field
    );
  }

  normalizeStoredReference(settings, field, reference);

  return { reference, field };
}

/**
 * The same rule, plus the one question that needs a read: can this document
 * actually fill its collection's pattern?
 *
 * Split from the shape check so the cheap half stays synchronous — the early
 * `beforeValidate` call wants an error, not a database round trip, and making
 * that hook async changes what a caller has to do to observe its rejection.
 *
 * Best effort by design: `req.nextly` is optional, and a slug can be emptied
 * AFTER this form is saved. The submit path keeps its own check and its log
 * line. What this buys is telling the author NOW, while the page they picked
 * is in front of them, rather than leaving a form that saves cleanly and
 * redirects nobody.
 */
/**
 * Whether this write leaves a form that would send visitors to a page they
 * cannot reach.
 *
 * One question, so it has one implementation and one name. It is the whole
 * rule: a form that accepts submissions is the only kind that redirects
 * anyone, and an unreachable target is the only thing that 404s them. A draft
 * form pointing at a draft page satisfies neither half and is allowed — the
 * picker offers unpublished pages on purpose, because a form is usually
 * configured beside the page it points at and the two go live together.
 */
export function wouldStrandVisitors(
  data: Record<string, unknown> | undefined,
  originalData: Record<string, unknown> | undefined,
  target: RedirectTargetDocument
): boolean {
  return (
    formAcceptsSubmissions(data, originalData) && !documentIsReachable(target)
  );
}

/**
 * Whether this write is the one that makes the form able to receive
 * submissions.
 *
 * Distinct from {@link formAcceptsSubmissions}, which answers what the form
 * WILL be: this asks what the write itself does, which is what decides whether
 * an inherited target is any of its business.
 */
function publishesForm(data: Record<string, unknown> | undefined): boolean {
  return data?.status === "published";
}

/**
 * The page this write leaves the form pointing at, and whether the write
 * CHOSE it.
 *
 * The distinction decides which refusals apply. A write that names a page
 * answers for that page; a write that only publishes the form, or renames it,
 * inherits whatever is stored and must not be refused for it.
 */
function redirectReferenceForWrite(
  context: HookContext,
  patterns: RedirectRelationships
): {
  reference: { collection: string; id: string };
  field: PickedDocumentField;
  chosen: boolean;
} | null {
  const chosen = assertRedirectTargetNamed(
    context.data,
    context.operation,
    patterns
  );
  if (chosen) return { ...chosen, chosen: true };

  // A write that REPLACES `settings` has answered the question: this form no
  // longer redirects to a page. Inheriting the old target there would refuse
  // the very edit that removes an invalid redirect, which is the one edit an
  // author in that state needs to make. Only a write that omits `settings`
  // inherits.
  const data = context.data as Record<string, unknown> | undefined;
  if (data?.settings !== undefined) return null;

  const stored = storedRedirectReference(
    context.originalData as Record<string, unknown> | undefined,
    patterns
  );
  return stored ? { ...stored, chosen: false } : null;
}

/**
 * Whether the collection's configured pattern can build a URL for this
 * document.
 *
 * A pattern may be a FUNCTION, which is host code and can throw. Authoring
 * must not be blocked by that: the submission path contains the same throw and
 * degrades to no redirect with a log line, so a broken pattern costs a
 * destination rather than the ability to edit forms.
 */
function assertPatternBuildsUrl(
  patterns: RedirectRelationships,
  reference: { collection: string; id: string },
  field: PickedDocumentField,
  target: RedirectTargetDocument
) {
  let url: string | undefined;
  try {
    url = applyRedirectPattern(patterns[reference.collection], target);
  } catch {
    return;
  }
  if (url) return;

  // Pattern-agnostic. The configured pattern may depend on any field, or be a
  // function that declines for its own reasons, so naming a slug states a
  // remedy that often cannot fix the actual failure — and the save is
  // correctly blocked either way, leaving the author following wrong advice.
  throw redirectRefusal(
    `No URL could be built for that page from the pattern configured for ` +
      `"${reference.collection}". Choose another page, or ask a developer ` +
      `to check that collection's redirect pattern.`,
    field
  );
}

export async function assertRedirectTargetUsable(
  context: HookContext,
  patterns: RedirectRelationships
) {
  const write = redirectReferenceForWrite(context, patterns);
  if (!write) return;
  const { reference, field, chosen } = write;

  const nextly = context.req?.nextly;
  if (!nextly) return;

  // Not inside a caller-owned transaction. `context.executor` is present only
  // there, and the contract on it is explicit: a hook that reads the database
  // must use that executor, because a second pooled connection can stall
  // against a small pool while the caller's transaction holds the only one —
  // and a pooled read cannot see the transaction's own uncommitted rows, so a
  // page created in the same transaction would read as missing and this would
  // refuse a correct write.
  //
  // `findByID` takes no executor, and reaching for Drizzle directly here would
  // be raw database access inside a plugin. So the transactional path keeps
  // the shape check and skips the read; the submit path is the backstop it
  // already was.
  if (context.executor) return;

  const found = await readRedirectTarget(nextly, reference);
  if (found.status === "unreadable") return;
  if (found.status === "missing") {
    // Only the write that NAMES a page answers for that page still existing.
    // A rename inherits whatever is stored, and refusing it would block an
    // edit for a setting it never touched.
    if (!chosen) return;
    throw redirectRefusal(
      `That page no longer exists in "${reference.collection}". Pick another.`,
      field
    );
  }

  // An inherited target is only judged by the write that PUBLISHES the form.
  // A published form can acquire a draft target without being touched — the
  // page is unpublished later, or the pairing predates this rule — and
  // refusing every subsequent rename would hold the form hostage to a state
  // the write neither created nor mentions. A write that CHOOSES a target
  // answers for it whatever else it does.
  const judged =
    chosen ||
    publishesForm(context.data as Record<string, unknown> | undefined);

  if (
    judged &&
    wouldStrandVisitors(
      context.data as Record<string, unknown> | undefined,
      context.originalData as Record<string, unknown> | undefined,
      found.document
    )
  ) {
    throw redirectRefusal(
      `That page is not published yet, and this form is. A visitor sent ` +
        `there would reach a "page not found". Publish the page, or save ` +
        `this form as a draft until you do.`,
      field
    );
  }

  // The pattern belongs to the write that CHOOSES a page. A form being
  // published does not get refused for a pattern its author never edited.
  if (chosen)
    assertPatternBuildsUrl(patterns, reference, field, found.document);
}

/**
 * The target document, as one of three outcomes.
 *
 * Three rather than a nullable document, because "the page is not there" and
 * "I could not ask" are different answers and only the first is the author's
 * to fix. Collapsing them has been wrong in both directions on this rule:
 * refusing on any failure blocks a save a retry would complete, and skipping
 * on any failure loses the deleted-page refusal entirely.
 */
async function readRedirectTarget(
  nextly: NonNullable<NonNullable<HookContext["req"]>["nextly"]>,
  reference: { collection: string; id: string }
): Promise<
  | { status: "ok"; document: RedirectTargetDocument }
  | { status: "missing" }
  | { status: "unreadable" }
> {
  try {
    const row = (await nextly.findByID({
      collection: reference.collection,
      id: reference.id,
    })) as RedirectTargetDocument | null;
    return row ? { status: "ok", document: row } : { status: "missing" };
  } catch (error) {
    return isMissingTarget(error)
      ? { status: "missing" }
      : { status: "unreadable" };
  }
}

/**
 * Whether a failed read means the document is GONE, or that it could not be
 * asked for.
 *
 * Both arrive as exceptions — `findByID` throws `NOT_FOUND` for a missing
 * entry rather than returning null, despite a signature that says `| null` —
 * so the two are separated by the error's own code. Not by its message, which
 * is prose, and not by catching everything, which has now been wrong in both
 * directions: refusing on any failure blocks a save a retry would complete,
 * and skipping on any failure loses the deleted-page refusal.
 */
export function isMissingTarget(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "NOT_FOUND"
  );
}

/** One shape for every refusal this rule makes, so callers see one field. */
function redirectRefusal(message: string, field: PickedDocumentField) {
  // The path names the field the author actually filled in. Reporting every
  // refusal against `redirectPage` points a form configured through the URL
  // option at a control it does not show.
  return NextlyError.validation({
    errors: [{ path: `settings.${field}`, code: "REQUIRED", message }],
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
    // `read: true` — a form is public because a site renders it. The rest are
    // the shared defaults.
    access: accessWithDefaults(accessOverrides, { read: true }),

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
            assertRedirectTargetNamed(
              data,
              operation,
              pluginConfig.redirectRelationships
            );

            return data;
          },
        ],
      },
      hookOverrides,
      {
        // The last COLLECTION-level phase, after every host handler in it. A
        // host `beforeValidate` may rewrite the payload once the earlier call
        // has passed, so the check has to run again here.
        //
        // It is not the last mutating point in the write, and saying so would
        // be false: `collection-mutation-service` runs FIELD-level
        // `beforeChange` hooks after this one, and a host may contribute a
        // field through `formOverrides.fields`. Nothing collection-level can
        // sit after that — the next steps are hashing and the insert. What
        // bounds the consequence is the submit path, which resolves an
        // unusable target to NO redirect and logs it, never to a wrong one.
        beforeChange: [
          async (context: HookContext) => {
            await assertRedirectTargetUsable(
              context,
              pluginConfig.redirectRelationships
            );
            return context.data;
          },
        ],
      }
    ),

    // Spread any additional overrides (excluding already used properties)
    ...overrides,
  };
}
