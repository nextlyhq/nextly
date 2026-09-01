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
import { useEffect, useMemo, useCallback, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { CopyFromLanguageScope } from "@admin/components/features/entries/CopyFromLanguageScope";
import { singleSourceFetcher } from "@admin/components/features/entries/entry-locale-source";
import { AutosaveRecoveryBanner } from "@admin/components/features/entries/EntryForm/AutosaveRecoveryBanner";
import type { ContributedAction } from "@admin/components/features/entries/EntryForm/DocumentActionBar";
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
  UnsavedWorkProvider,
  useFormUnsavedWork,
} from "@admin/components/features/entries/EntryForm/UnsavedWorkContext";
import {
  mapIntentToPayload,
  passwordFieldNames,
  type EntryFormIntent,
} from "@admin/components/features/entries/EntryForm/useEntryForm";
import { useRailCollapsed } from "@admin/components/features/entries/EntryForm/useRailCollapsed";
import { EntryLocaleProvider } from "@admin/components/features/entries/EntryLocaleContext";
import { LanguagePanel } from "@admin/components/features/entries/LanguagePanel";
import { PreviewPanes } from "@admin/components/features/entries/PreviewMode/PreviewPanes";
import { TranslationPanes } from "@admin/components/features/entries/TranslationMode/TranslationPanes";
import { useTranslationSource } from "@admin/components/features/entries/TranslationMode/useTranslationSource";
import { useEntryLocaleContext } from "@admin/components/features/entries/useEntryLocaleContext";
import { historyEnabledFrom } from "@admin/components/features/versions/history-enabled";
import { useDiscardSingleWorkingDraft } from "@admin/hooks/queries/useDiscardSingleWorkingDraft";
import { usePublishAllSingleLocales } from "@admin/hooks/queries/usePublishAllSingleLocales";
import { useAutosaveRecovery } from "@admin/hooks/useAutosaveRecovery";
import { useAutoSlug } from "@admin/hooks/useAutoSlug";
import {
  autosaveScopeFor,
  useDocumentAutosave,
} from "@admin/hooks/useDocumentAutosave";
import { useEntryFormShortcuts } from "@admin/hooks/useKeyboardShortcuts";
import { useLocalization } from "@admin/hooks/useLocalization";
import { useTakeoverLayout } from "@admin/hooks/useTakeoverLayout";
import { generateClientSchema } from "@admin/lib/field-validation";
import { getDefaultValues } from "@admin/lib/form/default-values";
import { cn } from "@admin/lib/utils";
import type { SingleAdminOptions } from "@admin/types/entities";

import { relaxIdentityRequired } from "./identity-fields";
import { useSinglePreviewLink } from "./useSinglePreviewLink";
import { useSinglePreviewPane } from "./useSinglePreviewPane";

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
  /*
   * The shared declaration rather than an inline copy. This one had drifted
   * already — it was missing `order` and `sidebarGroup`, which the server
   * sends — and a second shape for one payload is how a field the server
   * provides stays invisible to the editor that wants it.
   */
  admin?: SingleAdminOptions;
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
  /**
   * Whether a status-less save to this published Single is HELD as a pending
   * change rather than written live (the draft/published split). Derived
   * server-side from the same eligibility rule the write uses, so the editor
   * cannot offer an affordance the engine will not honour.
   */
  draftsEnabled?: boolean;
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
  /**
   * Document-level actions the PAGE owns, folded in with the form's own.
   *
   * DESCRIPTIONS paired with handlers, not rendered controls. Adding a document
   * to a release is a fact about this document, so its control belongs with
   * Publish and Duplicate — but releases are the page's concern, and a form that
   * imported them would have to import translations and every later one too.
   *
   * It was a `ReactNode`, which could only ever be a button in one fixed spot:
   * unable to sit in the overflow menu, unable to be ordered against the
   * built-ins, and unable to say why it was unavailable — so it VANISHED where
   * a permission withheld it, which reads as the feature not existing.
   */
  documentActions?: readonly ContributedAction[];
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
  documentActions,
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

  /*
   * Whether the preview pane is open, and how many times this form has saved.
   *
   * The count feeds the preview revision, and it is needed for the reason the
   * entry editor needs it: a status-less save of a PUBLISHED document writes
   * the working-draft sidecar and leaves the live row alone, so from the second
   * such save onward the document's own `updatedAt` and its working-draft flag
   * both stand still while its content changes underneath them. Counting saves
   * is the only signal to that write available on this side of the wire.
   */
  const [savedCount, setSavedCount] = useState(0);

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
          // After the write lands and before the reset: this is the only point
          // that knows a save succeeded, and a revision that misses one leaves
          // the pane showing the previous draft.
          setSavedCount(n => n + 1);
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

  /*
   * Work a FIELD holds that the form's values do not contain — the page builder
   * commits its document on exit, so the form is not dirty while it is open.
   *
   * Declared HERE rather than beside the autosave below, because the shortcut
   * registration that reads it comes first: a save shortcut guarded on the
   * form's own flag declines for the whole time the editor is open.
   */
  const unsavedWork = useFormUnsavedWork(isDirty);
  const hasUnsavedWork = unsavedWork.hasUnsavedWork;

  useEntryFormShortcuts({
    onSave: () => {
      void handleSubmit();
    },
    onCancel: handleCancel,
    isDirty: hasUnsavedWork,
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
  // Asked of the shared hook so the entry editor cannot answer it differently.
  const { mainFields, controllerNames } = useTakeoverLayout(allFields, form);

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

  // One decision rather than three: which language the link is for, whether it
  // can be offered at all, and the mint itself. No site URL is computed here —
  // a link that travels by email or chat has to name a host, and the server is
  // the only place that can.
  const previewLink = useSinglePreviewLink({
    slug: schema.slug,
    localized: schema.localized === true,
    hasStatus,
    locale,
    defaultLocale,
  });

  // The per-locale translation-status map, read once and shared by the header
  // adapter and the language panel: two reads of the same document key would
  // agree today and drift the moment one of them learns a new shape.
  const singleTranslations = (
    document as {
      _translations?: Record<string, { translated: boolean; status?: string }>;
    }
  )._translations;

  // Throwing away this language's pending change. Scoped to the active locale:
  // a localized Single holds one per language, so discarding without naming one
  // would remove work in a language the author never opened.
  const discardMutation = useDiscardSingleWorkingDraft({
    slug: schema.slug,
    documentId: document.id,
    locale,
  });

  // Adapt the SingleDocumentData shape into what EntrySystemHeader and the
  // rail panels expect (entry.id / entry.status / entry.created_at /
  // entry.updated_at). The structural alignment is straightforward — singles
  // already carry id and updatedAt; status/createdAt are passed through if
  // present.
  const entryLike = {
    id: document.id,
    status: documentStatus,
    // The flag the header reads to show Changed and offer Discard. Forwarded
    // rather than recomputed: the server sets it only when a pending change was
    // actually overlaid, which is what makes it per-language.
    _isWorkingDraft:
      (document as { _isWorkingDraft?: boolean })._isWorkingDraft === true,
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

  // Every part of the in-place preview, decided together — see the module.
  const previewPane = useSinglePreviewPane({
    link: previewLink,
    document,
    savedCount,
    inTranslationMode: translationMode.source !== undefined,
    admin: schema.admin,
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
    form,
  });

  return (
    // A single is only ever edited standalone, so unlike the entry editor there
    // is no embedded case to exclude.
    <UnsavedChangesGuard
      isDirty={hasUnsavedWork}
      disabled={isSubmitting}
      // Same rule as the entry editor: a refused switch takes its seed with it.
      onCancel={onSeedHandled}
    >
      <UnsavedWorkProvider report={unsavedWork.report}>
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
            {/* Renders its child alone when it is closed — see the module. */}
            <PreviewPanes
              /*
               * Withheld while translation mode is on, and while the preview
               * cannot be offered at all. That mode already splits the editor,
               * and a third pane inside it would produce two nested resizable
               * groups and two chrome requests disagreeing about how much of
               * the admin is left — the same reason the entry editor withholds
               * it there.
               */
              open={previewPane.open}
              onClose={previewPane.onClose}
              scope={previewPane.scope}
              label={previewPane.label}
              revision={previewPane.revision}
            >
              {/* Renders its child alone when there is no source — see the module. */}
              <TranslationPanes
                source={translationMode.source}
                onExit={translationMode.onExit}
                control={form.control}
              >
                <div className={cn("space-y-0", className)}>
                  <EntryFormProvider form={form} onSubmit={handleSubmit}>
                    <CopyFromLanguageScope>
                      <FormErrorSummary
                        errors={errors}
                        submitCount={submitCount}
                        className="mx-6 mt-3"
                      />

                      <div className="flex flex-col @4xl/content:flex-row @4xl/content:min-h-[calc(100vh-4rem)] items-stretch @4xl/content:-my-8">
                        {/* Main column */}
                        <div className="flex-1 min-w-0 flex flex-col">
                          {/* No horizontal compensation here, and none needed. The
                parent's `-my-8` cancels the page's VERTICAL inset only; the
                horizontal inset is spent as grid columns on a measured page and
                is not a padding any margin can pull back from. A horizontal one here
                would not cancel anything — it would push the header and meta
                strip past the content column, which is what it did when the
                parent still cancelled both axes. */}
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
                            /* The active language, which the header reads to decide
                             which row's status its save buttons act on — a
                             localized single's default row and its translations
                             can be in different publish states. Switching
                             language is the language panel's job, so no handler
                             is forwarded here. */
                            locale={locale}
                            localized={schema.localized === true}
                            /* A Single has a draft lifecycle, so it has drafts worth
                   sharing. The control is offered whenever the Single carries
                   that lifecycle; whether a link can actually be minted is the
                   server's call, and it refuses with a message naming what is
                   missing rather than handing out one that 404s. */
                            isLinkAvailable={previewLink.isAvailable}
                            onCopyLink={previewLink.copy}
                            isCopyingLink={previewLink.isCopying}
                            /* The pane is offered on exactly the terms the
                           shareable link is: a Single with a draft lifecycle
                           and a resolvable language. Withheld in translation
                           mode, where the pane itself is withheld — a button
                           that toggles a flag nothing reads is worse than no
                           button. */
                            {...previewPane.toggle}
                            contributedActions={documentActions}
                            toolbarSlot={
                              <>
                                <EntryFormToolbarSlots
                                  context="single"
                                  controllerField={controllerNames[0]}
                                />
                              </>
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
                            /* The draft/published split. Without this the header
                   takes its `draftsEnabled: false` branch, whose Save names the
                   status — and a write that names one is never held, so the
                   engine's pending-change support stayed dark for every Single.
                   The label is the visible tell: "Save changes" rather than
                   "Save". */
                            draftsEnabled={schema.draftsEnabled === true}
                            onSaveWorkingDraft={() => {
                              void handleSubmit(
                                undefined,
                                "save-working-draft"
                              );
                            }}
                            onUnpublish={() => {
                              void handleSubmit(undefined, "unpublish");
                            }}
                            onDiscardWorkingDraft={async () => {
                              await discardMutation.mutateAsync();
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
                              onRestore={recovery.restore}
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
                    </CopyFromLanguageScope>
                  </EntryFormProvider>
                </div>
              </TranslationPanes>
            </PreviewPanes>
          </EntryLocaleProvider>
        </EntryFormContextProvider>
      </UnsavedWorkProvider>
    </UnsavedChangesGuard>
  );
}
