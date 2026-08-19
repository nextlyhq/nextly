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
import { useEffect, useMemo, useCallback, useRef } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { singleSourceFetcher } from "@admin/components/features/entries/entry-locale-source";
import { AutosaveRecoveryBanner } from "@admin/components/features/entries/EntryForm/AutosaveRecoveryBanner";
import { EntryFormContent } from "@admin/components/features/entries/EntryForm/EntryFormContent";
import {
  EntryFormContextProvider,
  hasPendingWorkingDraft,
} from "@admin/components/features/entries/EntryForm/EntryFormContext";
import { EntryFormProvider } from "@admin/components/features/entries/EntryForm/EntryFormProvider";
import { EntryFormSidebar } from "@admin/components/features/entries/EntryForm/EntryFormSidebar";
import { EntryFormToolbarSlots } from "@admin/components/features/entries/EntryForm/EntryFormToolbarSlots";
import { EntryMetaStrip } from "@admin/components/features/entries/EntryForm/EntryMetaStrip";
import { EntrySystemHeader } from "@admin/components/features/entries/EntryForm/EntrySystemHeader";
import { FormErrorSummary } from "@admin/components/features/entries/EntryForm/FormErrorSummary";
import { UnsavedChangesGuard } from "@admin/components/features/entries/EntryForm/UnsavedChangesGuard";
import {
  mapIntentToPayload,
  passwordFieldNames,
  type EntryFormIntent,
} from "@admin/components/features/entries/EntryForm/useEntryForm";
import { useRailCollapsed } from "@admin/components/features/entries/EntryForm/useRailCollapsed";
import { EntryLocaleProvider } from "@admin/components/features/entries/EntryLocaleContext";
import { LanguagePanel } from "@admin/components/features/entries/LanguagePanel";
import { TranslationPanes } from "@admin/components/features/entries/TranslationMode/TranslationPanes";
import { useTranslationSource } from "@admin/components/features/entries/TranslationMode/useTranslationSource";
import { useEntryLocaleContext } from "@admin/components/features/entries/useEntryLocaleContext";
import { historyEnabledFrom } from "@admin/components/features/versions/history-enabled";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import { usePublishAllSingleLocales } from "@admin/hooks/queries/usePublishAllSingleLocales";
import { useAutosaveRecovery } from "@admin/hooks/useAutosaveRecovery";
import { useAutoSlug } from "@admin/hooks/useAutoSlug";
import {
  autosaveScopeFor,
  useDocumentAutosave,
} from "@admin/hooks/useDocumentAutosave";
import { useEntryFormShortcuts } from "@admin/hooks/useKeyboardShortcuts";
import { useLocalization } from "@admin/hooks/useLocalization";
import {
  computeMainFields,
  takeoverControllerNames,
  takeoverTypesFromBranding,
} from "@admin/lib/builder/takeoverLayout";
import { generateClientSchema } from "@admin/lib/field-validation";
import { getDefaultValues } from "@admin/lib/form/default-values";
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
  /**
   * Whether this Single is localized (i18n). Drives the per-language switcher
   * and per-field translatability in the editor. Backed by
   * `dynamic_singles.localized`.
   */
  localized?: boolean;
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
  /**
   * i18n: the active content language (undefined = app default). Drives the per-language
   * switcher and per-field translatability; saves target this locale. Inert for non-localized
   * singles. Mirrors EntryForm.
   */
  locale?: string;
  /** i18n: switch the active editing language (from the in-form status pills). */
  onLocaleChange?: (locale: string, options?: { seedFrom?: string }) => void;
  /**
   * i18n: default-language field values, so a translatable field can show its source text
   * inline while translating a non-default language. Supplied by the page's source fetch.
   */
  sourceValues?: Record<string, unknown>;
  /** A seed the language switch asked for; forwarded to the copy-from action. */
  seedFromLocale?: string;
  /** Clears that seed once it has been offered. */
  onSeedHandled?: () => void;
  /**
   * i18n: translation mode — the language being translated FROM, the source
   * document read at it, and the way in and out.
   *
   * One prop rather than four, because they are one concept and always travel
   * together: three of them are meaningless without `from`, and a form given
   * some of them is in a state the page cannot produce.
   */
  translation?: {
    /** The source language, or absent when the mode is off. */
    from?: string | undefined;
    /** The source document's values, read at `from`. */
    sourceDocument?: Record<string, unknown> | undefined;
    /** Enter the mode, reading the source from the named language. */
    onEnter?: (source: string) => void;
    /** Leave the mode, keeping the language being edited. */
    onExit?: () => void;
  };
  /** Additional CSS classes */
  className?: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Recursively extracts default values from field configurations.
 */

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
  locale,
  onLocaleChange,
  seedFromLocale,
  onSeedHandled,
  translation,
  sourceValues,
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

  // Password fields submit "" to mean "keep the stored hash", so they are
  // exempt from the blank-to-null normalization applied on submit.
  const blankPasswordFields = useMemo(
    () => passwordFieldNames(schema.fields),
    [schema.fields]
  );

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

  // Keep the latest computed defaultValues in a ref so the reset effect can read
  // them without depending on the `defaultValues` object identity: React Query
  // refetches produce a fresh reference even for identical data, so depending on
  // it would reset the form mid-edit and discard unsaved changes.
  const defaultValuesRef = useRef(defaultValues);
  defaultValuesRef.current = defaultValues;

  // Reset the form only when the document's identity actually changes (different
  // ID or new version) or the active locale changes — not on every refetch. The
  // effect depends on the full reactive values (document, locale, form), but a
  // last-applied key guards the reset so a refetch that returns the same
  // id/updatedAt/locale is a no-op and preserves in-progress edits. `locale` is a
  // trigger so switching to an already-cached language (no refetch, so no
  // unmount/remount) still resets the form to that locale's values; otherwise the
  // previous language's inputs would linger. A first-time switch refetches and
  // remounts via the page's loading gate, which resets naturally.
  const lastResetKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!document) return;
    const resetKey = `${document.id}:${String(document.updatedAt)}:${locale}`;
    if (lastResetKeyRef.current === resetKey) return;
    lastResetKeyRef.current = resetKey;
    form.reset(defaultValuesRef.current);
  }, [document, locale, form]);

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
        const data = mapIntentToPayload(rawData, intent, blankPasswordFields);

        try {
          await onSubmit(data);
          form.reset(data);
        } catch (error) {
          console.error("Form submission error:", error);
        }
      })(e);
    },
    [form, onSubmit, blankPasswordFields]
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

  // i18n: per-locale writing direction (RTL) + the app default locale, for the content-locale
  // context passed to field components and the language pills. Inert for non-localized singles.
  const {
    getLocale,
    defaultLocale,
    enabled: localizationEnabled,
  } = useLocalization();

  // The per-locale translation-status map, read once and shared by the header
  // adapter and the language panel: two reads of the same document key would
  // agree today and drift the moment one of them learns a new shape.
  const singleTranslations = (
    document as {
      _translations?: Record<string, { translated: boolean; status?: string }>;
    }
  )._translations;

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
    // forward the per-locale translation-status map so the rail's Document panel renders
    // the per-language pills (DocumentPanel reads `entry._translations`). Absent for non-localized
    // singles / when translation-status wasn't requested → pills render nothing.
    _translations: singleTranslations,
  } as unknown as Parameters<typeof EntrySystemHeader>[0]["entry"];

  // i18n: content-locale context for field components + the rail's language panel.
  //
  // `collectionSlug`/`entryId` stay absent because a single genuinely has
  // neither. They used to double as the gate for copy-from-language, which made
  // the action collection-only by accident of addressing rather than by intent;
  // it now gates on `fetchSourceValues`, which a single can answer. Inert for
  // non-localized singles.
  // The Single's own publish-every-language mutation, handed to the shared
  // availability rule through the locale context. A Single is addressed by its
  // slug alone, so it supplies its own action exactly as it supplies its own
  // source read.
  const publishAllSingleLanguages = usePublishAllSingleLocales({
    slug: schema.slug,
  });

  const translationMode = useTranslationSource({
    fields: schema.fields,
    documentLocalized: schema.localized === true,
    translation,
    locale,
    defaultLocale,
    getLocale,
  });

  const localeCtx = useEntryLocaleContext({
    locale,
    defaultLocale,
    getLocale,
    documentLocalized: schema.localized === true,
    fields: schema.fields,
    sourceValues,
    inTranslationMode: translationMode.active,
    onLocaleChange,
    seedFromLocale,
    onSeedHandled,
    onEnterTranslationMode: translationMode.onEnter,
    // A single is addressed by its slug alone, so it supplies its own read and
    // no entry addressing at all.
    fetchSourceValues: singleSourceFetcher(schema.slug),
    publishAllLanguages: {
      slug: schema.slug,
      publish: () => publishAllSingleLanguages.mutate(),
      pending: publishAllSingleLanguages.isPending,
    },
  });

  // Recovery points for this author, the same mechanism the entry editor uses.
  // A Single always exists once its schema does, so unlike an entry there is no
  // pre-creation state -- but the address still comes from the stored document,
  // so a schema whose row has not been materialised yet records nothing rather
  // than addressing a document that is not there.
  const autosaveScope = useMemo(
    () => autosaveScopeFor("single", schema.slug, document?.id),
    [schema.slug, document?.id]
  );
  const autosave = useDocumentAutosave({
    scope: autosaveScope,
    form,
    locale: locale ?? null,
    enabled: !isSubmitting,
  });
  const recovery = useAutosaveRecovery({
    scope: autosaveScope,
  });
  const restoreRecovery = useCallback(() => {
    if (!recovery.offer) return;
    // `keepDefaultValues` so the form goes DIRTY: the recovered values are not
    // what the server holds, and treating them as the new baseline would let
    // the reader navigate away believing they were stored.
    form.reset(recovery.offer.snapshot as Record<string, unknown>, {
      keepDefaultValues: true,
    });
    recovery.dismiss();
  }, [recovery, form]);

  return (
    // A single is only ever edited standalone, so unlike the entry editor there
    // is no embedded case to exclude.
    <UnsavedChangesGuard isDirty={isDirty} disabled={isSubmitting}>
      {/*
        Which document the fields are inside. The entry editor has always
        supplied this and the Single editor did not, so a field rendered here
        could not tell what it was editing — which is fine for an input bound to
        a name, and not fine for one that has to address the document itself.

        `isCreateMode` is false by construction: a Single is materialised before
        its form renders, so there is no create mode to be in.
      */}
      <EntryFormContextProvider
        kind="single"
        collectionSlug={schema.slug}
        entryId={document.id}
        isCreateMode={false}
        // The same status the meta strip below shows, plus the pending-draft
        // fact the strip does not yet surface for a Single. Carrying the richer
        // answer rather than the strip's: "changed" means published with a
        // pending change, so a field reading it says MORE than the strip rather
        // than something different.
        documentStatus={{
          status: documentStatus,
          hasWorkingDraft: hasPendingWorkingDraft(document),
        }}
      >
        <EntryLocaleProvider value={localeCtx}>
          {/* Renders its child alone when there is no source — see the module. */}
          <TranslationPanes
            source={translationMode.source}
            onExit={translationMode.onExit}
            control={form.control}
          >
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
                      autosaveEnabled={autosaveScope !== null}
                      autosaveStatus={autosave.status}
                      autosaveLastSavedAt={autosave.lastSavedAt}
                      mode="edit"
                      titleField={titleField}
                      historyFields={schema.fields}
                      historyEnabled={historyEnabledFrom(schema)}
                      hasStatus={hasStatus}
                      isSubmitting={isSubmitting}
                      isDirty={isDirty}
                      entry={entryLike}
                      collectionSlug={schema.slug}
                      /* i18n: forward the active locale + switch handler so a localized single shows
                   the primary header language switcher (the sidebar pills are unavailable when
                   the rail is collapsed or on narrow layouts). The switcher self-hides when the
                   single isn't localized / localization isn't configured. */
                      locale={locale}
                      onLocaleChange={onLocaleChange}
                      localized={schema.localized === true}
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

                    {/* Inside the main column, below the header, matching the entry
                  editor. Placed above the flex row it sat UNDER the sticky
                  header, which intercepted pointer events: the offer was
                  visible and its buttons were not clickable. */}
                    {recovery.offer ? (
                      <AutosaveRecoveryBanner
                        savedAt={recovery.offer.savedAt}
                        onRestore={restoreRecovery}
                        onDismiss={recovery.dismiss}
                        className="mx-6 mt-3"
                      />
                    ) : null}

                    {/* The language panel, inline. The rail that otherwise carries it
                  is `hidden @4xl/content:flex`, so this is the exact
                  complement: shown only where the rail is not, and rendered
                  unconditionally once the author collapses the rail. Without
                  it a single loses its language workflow entirely at narrow
                  widths, which is the failure this panel exists to remove. */}
                    {localizationEnabled && (
                      <div
                        className={cn(
                          "px-6 pt-4",
                          !railCollapsed && "@4xl/content:hidden"
                        )}
                      >
                        <LanguagePanel
                          {...(singleTranslations === undefined
                            ? {}
                            : { translations: singleTranslations })}
                          {...(locale === undefined
                            ? {}
                            : { activeLocale: locale })}
                          {...(onLocaleChange === undefined
                            ? {}
                            : { onSelect: onLocaleChange })}
                          hasStatus={hasStatus}
                        />
                      </div>
                    )}

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
                          {...(locale === undefined ? {} : { locale })}
                          {...(onLocaleChange === undefined
                            ? {}
                            : { onLocaleChange })}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </EntryFormProvider>
            </div>
          </TranslationPanes>
        </EntryLocaleProvider>
      </EntryFormContextProvider>
    </UnsavedChangesGuard>
  );
}
