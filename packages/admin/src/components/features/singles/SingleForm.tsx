"use client";

/**
 * Single Form Component
 *
 * Form component for editing Single document data.
 * Singles are single-document entities that always exist and cannot be deleted.
 * This component provides:
 * - Dynamic field rendering based on Single schema
 * - Form validation with Zod
 * - Auto-save to localStorage
 * - Unsaved changes protection
 * - Keyboard shortcuts
 *
 * Unlike EntryForm, SingleForm:
 * - Only supports edit mode (no create/delete)
 * - Has a simpler header (no delete/duplicate actions)
 * - Uses separate hooks for document data vs schema
 *
 * @module components/singles/SingleForm
 * @since 1.0.0
 */

import { zodResolver } from "@hookform/resolvers/zod";
import type { FieldConfig } from "nextly/config";
import type React from "react";
import { useEffect, useMemo, useCallback } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { EntryFormContent } from "@admin/components/features/entries/EntryForm/EntryFormContent";
import { EntryFormProvider } from "@admin/components/features/entries/EntryForm/EntryFormProvider";
import { EntryFormSidebar } from "@admin/components/features/entries/EntryForm/EntryFormSidebar";
import { EntryFormToolbarSlots } from "@admin/components/features/entries/EntryForm/EntryFormToolbarSlots";
import { EntryMetaStrip } from "@admin/components/features/entries/EntryForm/EntryMetaStrip";
import { EntrySystemHeader } from "@admin/components/features/entries/EntryForm/EntrySystemHeader";
import { FormErrorSummary } from "@admin/components/features/entries/EntryForm/FormErrorSummary";
import {
  mapIntentToPayload,
  type EntryFormIntent,
} from "@admin/components/features/entries/EntryForm/useEntryForm";
import { useRailCollapsed } from "@admin/components/features/entries/EntryForm/useRailCollapsed";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import { useAutoSlug } from "@admin/hooks/useAutoSlug";
import { useEntryFormShortcuts } from "@admin/hooks/useKeyboardShortcuts";
import {
  computeMainFields,
  takeoverControllerNames,
  takeoverTypesFromBranding,
} from "@admin/lib/builder/takeoverLayout";
import { generateClientSchema } from "@admin/lib/field-validation";
import { cn } from "@admin/lib/utils";

import { relaxIdentityRequired } from "./identity-fields";

// ============================================================================
// Types
// ============================================================================

/**
 * Single schema data (from useSingleSchema hook)
 */
export interface SingleSchema {
  slug: string;
  label: string;
  description?: string;
  fields: FieldConfig[];
  admin?: {
    group?: string;
    icon?: string;
    hidden?: boolean;
    description?: string;
  };
  /**
   * Whether this Single has the Draft/Published lifecycle enabled. When
   * true, the system header splits into Save Draft + Update buttons and the
   * Document panel + meta strip surface a status pill. Backed by the
   * `dynamic_singles.status` boolean column.
   */
  status?: boolean;
}

/**
 * Single document data
 */
export interface SingleDocumentData {
  id: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface SingleFormProps {
  /** Single schema with field definitions */
  schema: SingleSchema;
  /** Current document data */
  document: SingleDocumentData;
  /** Callback when form is successfully submitted */
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  /** Whether the form is currently submitting */
  isSubmitting?: boolean;
  /** Callback when the user clicks Discard changes in the system header
   *  dropdown (only shown when the form is dirty). */
  onCancel?: () => void;
  /** Callback when the user picks "View API response" from the system
   *  header dropdown. Singles' API URL pattern differs from collections,
   *  so the page route handles navigation. */
  onViewApi?: () => void;
  /** Additional CSS classes */
  className?: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Recursively extracts default values from field configurations.
 */
/** Convert camelCase to snake_case for DB column name lookup fallback. */
function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
}

function getDefaultValues(
  fields: FieldConfig[],
  existingData?: Record<string, unknown>
): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};

  for (const field of fields) {
    if (!("name" in field) || !field.name) {
      continue;
    }

    const fieldName = field.name;
    // Single entry API returns DB column names (snake_case) but field configs
    // use camelCase. Try camelCase first, then fall back to snake_case.
    const existingValue =
      existingData?.[fieldName] ?? existingData?.[toSnakeCase(fieldName)];

    // Use existing value if available
    if (existingValue !== undefined) {
      // Coerce checkbox values to boolean — the database may store/return
      // them as strings ("true"/"false") or integers (0/1).
      const fieldType = field.type as string;
      if (fieldType === "checkbox" || fieldType === "boolean") {
        defaults[fieldName] =
          existingValue === true ||
          existingValue === "true" ||
          existingValue === 1;
      } else if (fieldType === "chips") {
        // Chips may be stored as a JSON string in non-JSONB databases or legacy rows.
        // Always ensure the value is an array.
        if (Array.isArray(existingValue)) {
          defaults[fieldName] = existingValue;
        } else if (typeof existingValue === "string") {
          try {
            const parsed = JSON.parse(existingValue);
            defaults[fieldName] = Array.isArray(parsed) ? parsed : [];
          } catch {
            defaults[fieldName] = [];
          }
        } else {
          defaults[fieldName] = [];
        }
      } else {
        defaults[fieldName] = existingValue;
      }
      continue;
    }

    // Generate default value based on field type
    const fieldType = field.type as string;
    switch (fieldType) {
      case "text":
      case "textarea":
      case "email":
      case "password":
      case "select":
      case "radio":
        defaults[fieldName] =
          (field as { defaultValue?: string }).defaultValue ?? "";
        break;
      case "richText":
        // Why: richText was previously lumped with text/textarea and
        // defaulted to "" — but its value is a Lexical JSON state, not
        // a string, so an empty string crashed the editor on first
        // render. Read the developer's `defaultValue` (any) and fall
        // back to null, which Lexical treats as empty cleanly.
        defaults[fieldName] =
          (field as { defaultValue?: unknown }).defaultValue ?? null;
        break;
      case "number":
        defaults[fieldName] =
          (field as { defaultValue?: number }).defaultValue ?? null;
        break;
      case "checkbox":
        defaults[fieldName] =
          (field as { defaultValue?: boolean }).defaultValue ?? false;
        break;
      case "date":
        defaults[fieldName] =
          (field as { defaultValue?: string }).defaultValue ?? null;
        break;
      case "relationship": {
        const relationField = field as {
          multiple?: boolean;
          hasMany?: boolean;
        };
        const isMultiple = relationField.multiple || relationField.hasMany;
        defaults[fieldName] = isMultiple ? [] : null;
        break;
      }
      case "upload": {
        const uploadField = field as { multiple?: boolean; hasMany?: boolean };
        const isMultiple = uploadField.multiple || uploadField.hasMany;
        defaults[fieldName] = isMultiple ? [] : null;
        break;
      }
      case "repeater":
      case "chips":
        defaults[fieldName] = [];
        break;
      case "group": {
        const groupField = field as { fields: FieldConfig[] };
        defaults[fieldName] = getDefaultValues(groupField.fields);
        break;
      }
      case "component": {
        const componentField = field as {
          componentFields?: FieldConfig[];
          repeatable?: boolean;
        };
        if (componentField.repeatable) {
          defaults[fieldName] = [];
        } else if (componentField.componentFields) {
          defaults[fieldName] = getDefaultValues(
            componentField.componentFields
          );
        } else {
          defaults[fieldName] = null;
        }
        break;
      }
      default:
        defaults[fieldName] = null;
    }
  }

  return defaults;
}

// ============================================================================
// Component
// ============================================================================

/**
 * SingleForm - Form for editing Single document data
 *
 * A complete form component for editing Single documents.
 * Automatically generates form fields from Single schema, handles validation
 * with Zod, and manages update operations.
 *
 * ## Features
 *
 * - Dynamic form generation from Single schema
 * - Zod validation from field configurations
 * - Two-column layout with metadata sidebar
 * - Loading and submitting states
 * - Dirty state tracking
 * - Unsaved changes protection
 * - Auto-save to localStorage
 * - Draft recovery
 * - Keyboard shortcuts (Cmd/Ctrl+S to save)
 *
 * @example
 * ```tsx
 * function SingleEditPage({ slug }: { slug: string }) {
 *   const { data: schema } = useSingleSchema(slug);
 *   const { data: document } = useSingleDocument(slug);
 *   const { mutateAsync: updateDocument, isPending } = useUpdateSingleDocument(slug);
 *
 *   if (!schema || !document) return <Skeleton />;
 *
 *   return (
 *     <SingleForm
 *       schema={schema}
 *       document={document}
 *       onSubmit={updateDocument}
 *       isSubmitting={isPending}
 *     />
 *   );
 * }
 * ```
 */
export function SingleForm({
  schema,
  document,
  onSubmit,
  isSubmitting = false,
  onCancel,
  onViewApi,
  className,
}: SingleFormProps) {
  // Generate Zod schema from field configurations. Singles render title/slug
  // read-only from config, so relax their required rule — submitting must not
  // error when they aren't user-entered.
  const zodSchema = useMemo(() => {
    try {
      // Singles are always an update of the one existing document, so the
      // schema runs in edit mode (blank password = keep current).
      return generateClientSchema(relaxIdentityRequired(schema.fields), {
        mode: "edit",
      });
    } catch (error) {
      console.error("Failed to generate schema:", error);
      return z.record(z.string(), z.unknown());
    }
  }, [schema.fields]);

  // Generate default values from document data, then pin the single's identity
  // (title/slug) to its config so the read-only display and the submitted
  // payload always reflect the definition rather than any stale stored value.
  const defaultValues = useMemo(() => {
    const values = getDefaultValues(schema.fields, document);
    values.title = schema.label;
    values.slug = schema.slug;
    return values;
  }, [schema.fields, schema.label, schema.slug, document]);

  // Initialize form
  //
  // Why mode: "onSubmit" — matches EntryForm. The previous "onBlur"
  // setting fired field-level validation when a required field was
  // blurred empty, which surfaced inline errors and the top-level
  // toast before the user had tried to save. "onSubmit" keeps the
  // form quiet until the user clicks Save Draft / Publish, after which
  // RHF's default reValidateMode: "onChange" keeps errors in sync as
  // the user fixes them.
  const form = useForm<Record<string, unknown>>({
    resolver: zodResolver(zodSchema),
    defaultValues,
    mode: "onSubmit",
  });

  // Reset form only when the actual document changes (different ID or new version).
  // Reason: defaultValues and form.reset are intentionally excluded — React Query
  // refetches produce new object references even for identical data, and including
  // the full object would reset the form mid-edit, discarding unsaved changes.
  useEffect(() => {
    if (document) {
      form.reset(defaultValues);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document?.id, document?.updatedAt]);

  // submitCount gates the top-level "Please fix" toast so the user
  // doesn't see it until they actually click Save Draft / Publish.
  const { errors, submitCount } = form.formState;
  const isDirty = form.formState.isDirty;

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  // Submit handler. The intent arg names the user's button click and
  // determines payload shape — same intent set as the collection
  // EntryForm (see EntryFormIntent). Mirrors the EntryForm pattern.
  const handleSubmit = useCallback(
    async (e?: React.BaseSyntheticEvent, intent?: EntryFormIntent) => {
      e?.preventDefault();

      await form.handleSubmit(async rawData => {
        // Why: shared intent→payload helper mirrors the EntryForm
        // contract (see useEntryForm.mapIntentToPayload). Unpublish
        // strips other dirty fields so a confirm-modal misclick can't
        // ship unrelated changes to the public site.
        const data = mapIntentToPayload(rawData, intent);

        try {
          await onSubmit(data);
          form.reset(data);
        } catch (error) {
          console.error("Form submission error:", error);
        }
      })(e);
    },
    [form, onSubmit]
  );

  const handleCancel = useCallback(() => {
    onCancel?.();
  }, [onCancel]);

  // ---------------------------------------------------------------------------
  // Keyboard Shortcuts
  // ---------------------------------------------------------------------------

  useEntryFormShortcuts({
    onSave: () => {
      void handleSubmit();
    },
    onCancel: handleCancel,
    isDirty,
    isSubmitting,
    enabled: true,
  });

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // System fields: title (system header) and slug (meta strip). Per the
  // special-casing. Any user-defined field with admin.position: "sidebar"
  // now renders inline like every other Builder field.
  const allFields = schema.fields;
  const titleField = allFields.find(f => "name" in f && f.name === "title");
  const slugField = allFields.find(f => "name" in f && f.name === "slug");
  // Takeover layout: a field flagged `layout: "takeover"` (when active) collapses the
  // body to itself + its condition controller. Generic — driven by field-type metadata.
  const branding = useBranding();
  const takeoverTypes = takeoverTypesFromBranding(branding.plugins);
  const controllerNames = takeoverControllerNames(allFields, takeoverTypes);
  const watched = controllerNames.length ? form.watch(controllerNames) : [];
  const values = Object.fromEntries(
    controllerNames.map((n, i) => [n, watched[i]])
  );
  const mainFields = computeMainFields(allFields, { takeoverTypes, values });

  // Status flag — singles can opt into Draft/Published via schema.status.
  // When true, EntrySystemHeader shows Save Draft / Update split, and
  // EntryMetaStrip / DocumentPanel surface the status pill.
  const hasStatus = schema.status === true;

  // Auto-fill slug from title — same form-level pattern as EntryForm. The
  // title input lives in EntrySystemHeader (not TextInput) so the slug
  // generator must be mounted at the form level to see its keystrokes.
  // Why "name" in f narrowing: SingleForm's allFields type union still
  // includes options without `name` (legacy SingleSchema typing); the
  // titleField/slugField extraction above did the same narrowing dance.
  const titleFieldName =
    titleField && "name" in titleField ? (titleField.name as string) : "title";
  const slugFieldName =
    slugField && "name" in slugField ? (slugField.name as string) : "slug";
  // Singles never auto-generate the slug — it's fixed by the single's config
  // and rendered read-only. Keep the hook mounted (stable hook order) but
  // disabled so it never writes to the slug field.
  useAutoSlug({
    form,
    titleFieldName,
    slugFieldName,
    enabled: false,
  });
  const documentStatus =
    (document as { status?: string } | undefined)?.status ?? "draft";

  // Rail collapse pref (shared with collection EntryForm via the same
  // localStorage key).
  const { collapsed: railCollapsed, toggle: toggleRail } = useRailCollapsed();

  // Adapt the SingleDocumentData shape into what EntrySystemHeader and the
  // rail panels expect (entry.id / entry.status / entry.created_at /
  // entry.updated_at). The structural alignment is straightforward — singles
  // already carry id and updatedAt; status/createdAt are passed through if
  // present.
  const entryLike = {
    id: document.id,
    status: documentStatus,
    createdAt: (document as { createdAt?: string }).createdAt,
    updatedAt: document.updatedAt,
    title: (document as { title?: string }).title,
  } as unknown as Parameters<typeof EntrySystemHeader>[0]["entry"];

  return (
    <div className={cn("space-y-0", className)}>
      <EntryFormProvider form={form} onSubmit={handleSubmit}>
        <FormErrorSummary
          errors={errors}
          submitCount={submitCount}
          className="mx-6 mt-3"
        />

        <div className="flex flex-col @4xl/content:flex-row @4xl/content:min-h-[calc(100vh-4rem)] items-stretch @4xl/content:-m-8">
          {/* Main column */}
          <div className="flex-1 min-w-0 flex flex-col">
            {/* Why: same fix as EntryForm — the parent flex's @4xl/content:-m-8
                already cancels PageContainer's px-8, so wrapping the header / meta
                strip in another -mx-8 was double-negative and pushed them
                past the page edges. */}
            <EntrySystemHeader
              mode="edit"
              titleField={titleField}
              hasStatus={hasStatus}
              isSubmitting={isSubmitting}
              isDirty={isDirty}
              entry={entryLike}
              collectionSlug={schema.slug}
              toolbarSlot={
                <EntryFormToolbarSlots
                  context="single"
                  controllerField={controllerNames[0]}
                />
              }
              onSaveDraft={() => {
                void handleSubmit(undefined, "save-draft");
              }}
              onPublish={() => {
                void handleSubmit(undefined, "publish");
              }}
              onSaveChanges={() => {
                void handleSubmit(undefined, "save-changes");
              }}
              onUnpublish={() => {
                void handleSubmit(undefined, "unpublish");
              }}
              onCancel={handleCancel}
              onViewApi={onViewApi}
              /* Why: Singles share the Show JSON dialog with collections,
                 but at the /api/singles/{slug} URL pattern. Passing
                 `scope="single"` routes the dialog through singleApi
                 instead of entryApi. */
              scope="single"
              lockIdentity
              isRailCollapsed={railCollapsed}
              onToggleRail={toggleRail}
            />
            <EntryMetaStrip
              slugField={slugField}
              hasStatus={hasStatus}
              status={documentStatus}
              isRailCollapsed={railCollapsed}
              lockSlug
            />

            {mainFields.length > 0 && (
              <div className="@4xl/content:p-8 pt-6">
                <EntryFormContent
                  fields={mainFields}
                  disabled={isSubmitting}
                  withCard
                />
              </div>
            )}
          </div>

          {/* Rail (collapsible). Same shape and width as collections. */}
          {!railCollapsed && (
            <div className="hidden @4xl/content:flex w-[320px] shrink-0 border-l border-border bg-background flex-col relative z-10">
              <div className="@4xl/content:sticky @4xl/content:top-0 @4xl/content:h-[calc(100vh-4rem)] overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] flex flex-col">
                <EntryFormSidebar
                  mode="edit"
                  entry={entryLike}
                  hasStatus={hasStatus}
                  isDirty={isDirty}
                />
              </div>
            </div>
          )}
        </div>
      </EntryFormProvider>
    </div>
  );
}
