"use client";

/**
 * Single Form Component
 *
 * Form component for editing Single document data.
 * Singles are single-document entities that always exist and cannot be deleted.
 * This component provides:
 * - Dynamic field rendering based on Single schema
 * - Form validation with Zod
 * - Autosave to a server-side recovery point
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
import { LiveDocumentRecoveryOffer } from "@admin/components/features/entries/EntryForm/AutosaveRecoveryBanner";
import type { ContributedAction } from "@admin/components/features/entries/EntryForm/DocumentActionBar";
import {
  DocumentActionsHost,
  DocumentSaveShortcuts,
  SaveActionFormProvider,
} from "@admin/components/features/entries/EntryForm/DocumentActionsContext";
import { DocumentLockBanner } from "@admin/components/features/entries/EntryForm/DocumentLockBanner";
import {
  DocumentViewBody,
  type DocumentViewMount,
} from "@admin/components/features/entries/EntryForm/DocumentViewBody";
import { EntryFormContent } from "@admin/components/features/entries/EntryForm/EntryFormContent";
import {
  EntryFormContextProvider,
  hasPendingWorkingDraft,
} from "@admin/components/features/entries/EntryForm/EntryFormContext";
import { EntryFormSidebar } from "@admin/components/features/entries/EntryForm/EntryFormSidebar";
import { EntryMetaStrip } from "@admin/components/features/entries/EntryForm/EntryMetaStrip";
import { EntrySystemHeader } from "@admin/components/features/entries/EntryForm/EntrySystemHeader";
import { FormErrorSummary } from "@admin/components/features/entries/EntryForm/FormErrorSummary";
import {
  readerStatusWrite,
  statusWritesHeld,
} from "@admin/components/features/entries/EntryForm/reader-status-write";
import { submitDocument } from "@admin/components/features/entries/EntryForm/submit-document";
import {
  submitBusy,
  submitFailed,
  submitHeld,
  type SubmitOutcome,
} from "@admin/components/features/entries/EntryForm/submit-outcome";
import { UnsavedChangesGuard } from "@admin/components/features/entries/EntryForm/UnsavedChangesGuard";
import {
  UnsavedWorkProvider,
  useFormUnsavedWork,
} from "@admin/components/features/entries/EntryForm/UnsavedWorkContext";
import {
  storingHandlers,
  type DocumentActionBindingsInput,
} from "@admin/components/features/entries/EntryForm/useDocumentActionBindings";
import { useDocumentLockSurface } from "@admin/components/features/entries/EntryForm/useDocumentLockSurface";
import { useDocumentPanelCollapsed } from "@admin/components/features/entries/EntryForm/useDocumentPanelCollapsed";
import {
  mapIntentToPayload,
  passwordFieldNames,
  type EntryFormIntent,
} from "@admin/components/features/entries/EntryForm/useEntryForm";
import { EntryLocaleProvider } from "@admin/components/features/entries/EntryLocaleContext";
import { DocumentLanguagePanel } from "@admin/components/features/entries/LanguagePanel";
import { PreviewPanes } from "@admin/components/features/entries/PreviewMode/PreviewPanes";
import { TranslationPanes } from "@admin/components/features/entries/TranslationMode/TranslationPanes";
import { useTranslationSource } from "@admin/components/features/entries/TranslationMode/useTranslationSource";
import { useEntryLocaleContext } from "@admin/components/features/entries/useEntryLocaleContext";
import { autosaveIntervalFrom } from "@admin/components/features/versions/autosave-interval";
import { DocumentHistoryContext } from "@admin/components/features/versions/document-history-context";
import {
  historyEnabledFrom,
  historyRetentionFrom,
} from "@admin/components/features/versions/history-enabled";
import {
  mayRecordRecovery,
  useViewedVersion,
  writeActionsHeld,
  ViewedVersionBody,
  versionAwareToolbarSlots,
} from "@admin/components/features/versions/viewed-version-host";
import { useDiscardSingleWorkingDraft } from "@admin/hooks/queries/useDiscardSingleWorkingDraft";
import { usePublishAllSingleLocales } from "@admin/hooks/queries/usePublishAllSingleLocales";
import { useAutosaveRecovery } from "@admin/hooks/useAutosaveRecovery";
import { useAutoSlug } from "@admin/hooks/useAutoSlug";
import {
  autosaveScopeFor,
  useDocumentAutosave,
} from "@admin/hooks/useDocumentAutosave";
import { useLocalization } from "@admin/hooks/useLocalization";
import { useTakeoverLayout } from "@admin/hooks/useTakeoverLayout";
import { editsOffered, useUpdateAnswer } from "@admin/hooks/useUpdateAnswer";
import { generateClientSchema } from "@admin/lib/field-validation";
import { getDefaultValues } from "@admin/lib/form/default-values";
import {
  holdsPlaceholders,
  withoutPlaceholders,
} from "@admin/lib/form/stored-references";
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
   * Describing rather than rendering is what leaves the model free to place the
   * action, order it against the built-ins, and disable it with a reason. A
   * rendered node fixes all three at its call site, and the one that matters is
   * the last: a control that cannot say why it is unavailable has to disappear,
   * which an author cannot tell from a feature that does not exist.
   */
  documentActions?: readonly ContributedAction[];
  /** Single schema with field definitions */
  schema: SingleSchema;
  /** Current document data */
  document: SingleDocumentData;
  /** Callback when form is successfully submitted */
  onSubmit: (
    data: Record<string, unknown>
  ) => Promise<SingleDocumentData | void>;
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
  /**
   * @experimental A plugin's document view to draw in place of the form body,
   * when the route names one.
   */
  documentView?: DocumentViewMount;
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
// Editor sub-surfaces
// ============================================================================

/**
 * The form's values for a stored document: its fields, with the Single's
 * identity (title and slug) pinned to its config, so the read-only display and
 * the submitted payload always reflect the definition rather than any stale
 * stored value. One derivation for the first render and for every save after.
 */
function singleFormDefaults(
  schema: SingleSchema,
  document: SingleDocumentData
): Record<string, unknown> {
  const values = getDefaultValues(schema.fields, document);
  values.title = schema.label;
  values.slug = schema.slug;
  return values;
}

/** Which stored version of which document, in which language, is on screen. */
function singleResetKey(document: SingleDocumentData, locale: unknown): string {
  return `${document.id}:${String(document.updatedAt)}:${String(locale)}`;
}

/**
 * The inline language panel, shown where the rail is not.
 *
 * The rail that otherwise carries the language workflow is
 * `hidden @4xl/content:flex`, so this is the exact complement: shown only
 * where the rail is not, and rendered unconditionally once the author
 * collapses it. Without it a single loses its language workflow entirely at
 * narrow widths, which is the failure this panel exists to remove.
 */
function SingleFormLanguagePanel({
  actionsDisabled,
  navigationDisabled,
  publishAllDisabled,
  enabled,
  hasStatus,
  locale,
  onLocaleChange,
  railCollapsed,
  translations,
}: {
  actionsDisabled: boolean;
  navigationDisabled: boolean;
  publishAllDisabled: boolean;
  enabled: boolean;
  hasStatus: boolean;
  locale?: string;
  onLocaleChange?: (locale: string, options?: { seedFrom?: string }) => void;
  railCollapsed: boolean;
  translations?: Record<string, { translated: boolean; status?: string }>;
}) {
  if (!enabled) return null;
  return (
    <div className={cn("px-6 pt-4", !railCollapsed && "@4xl/content:hidden")}>
      <DocumentLanguagePanel
        translations={translations}
        locale={locale}
        onLocaleChange={onLocaleChange}
        hasStatus={hasStatus}
        actionsDisabled={actionsDisabled}
        navigationDisabled={navigationDisabled}
        publishAllDisabled={publishAllDisabled}
      />
    </div>
  );
}

/**
 * The document body: the live editor's fields, or the version the history
 * panel published. The swap itself is the shared host's; this surface owns
 * what the single renders on the live side of it.
 */
function SingleFormFieldsPanel({
  historicalFields,
  historicalValues,
  isSubmitting,
  mainFields,
  readOnly,
  versionActionsHeld,
}: {
  historicalFields: FieldConfig[] | null;
  historicalValues: Record<string, unknown> | null;
  isSubmitting: boolean;
  mainFields: FieldConfig[];
  readOnly: boolean;
  /** Why a past version's restore is withheld (see `useVersionActions`). */
  versionActionsHeld: boolean;
}) {
  return (
    <ViewedVersionBody
      fields={historicalFields ?? mainFields}
      values={historicalValues ?? undefined}
      actionsDisabled={versionActionsHeld}
    >
      {mainFields.length > 0 && (
        <div className="@4xl/content:p-8 pt-6">
          <EntryFormContent
            fields={mainFields}
            disabled={isSubmitting}
            readOnly={readOnly}
            withCard
          />
        </div>
      )}
    </ViewedVersionBody>
  );
}

/**
 * The metadata rail. Same shape and width as the entry editor's. Collapsed by
 * the shared pref; its document actions act on the LIVE document, so they are
 * withheld while a past version is on screen — the same withholding the
 * header's save affordances observe.
 */
function SingleFormRail({
  actionsDisabled,
  navigationDisabled,
  publishAllDisabled,
  entry,
  hasStatus,
  isDirty,
  locale,
  onLocaleChange,
  railCollapsed,
}: {
  actionsDisabled: boolean;
  navigationDisabled: boolean;
  publishAllDisabled: boolean;
  entry: React.ComponentProps<typeof EntryFormSidebar>["entry"];
  hasStatus: boolean;
  isDirty: boolean;
  locale?: string;
  onLocaleChange?: (locale: string, options?: { seedFrom?: string }) => void;
  railCollapsed: boolean;
}) {
  if (railCollapsed) return null;
  return (
    <div className="hidden @4xl/content:flex w-[320px] shrink-0 border-l border-border bg-background flex-col relative z-10">
      <div className="@4xl/content:sticky @4xl/content:top-0 @4xl/content:h-[calc(100vh-4rem)] overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] flex flex-col">
        <EntryFormSidebar
          mode="edit"
          entry={entry}
          hasStatus={hasStatus}
          isDirty={isDirty}
          actionsDisabled={actionsDisabled}
          navigationDisabled={navigationDisabled}
          publishAllDisabled={publishAllDisabled}
          {...(locale === undefined ? {} : { locale })}
          {...(onLocaleChange === undefined ? {} : { onLocaleChange })}
        />
      </div>
    </div>
  );
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
 * - Autosave to a server-side recovery point, offered back on return
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
  documentView,
}: SingleFormProps): React.JSX.Element {
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
  const defaultValues = useMemo(
    () => singleFormDefaults(schema, document),
    [schema, document]
  );

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
  //
  // The stored document this author's own save produced arrives here too, and
  // resetting to it blindly would wipe whatever they typed while the save was
  // in flight; the save has already made it the form's starting point, so that
  // echo keeps unsaved edits. Recognised while the save is in flight, and
  // afterwards by the key of the document it stored. Any other new version —
  // a restore, a colleague's change, another language — resets the form to
  // it, as Restore promises when it warns unsaved work is discarded.
  const lastResetKeyRef = useRef<string | null>(null);
  // Which document, in which language, the form was last reset to: a new
  // version of that is the case an own-save echo can be.
  const lastResetPlaceRef = useRef<string | null>(null);
  const ownSave = useRef<{ inFlight: boolean; storedKey?: string }>({
    inFlight: false,
  });
  useEffect(() => {
    if (!document) return;
    const resetKey = singleResetKey(document, locale);
    if (lastResetKeyRef.current === resetKey) return;
    const place = JSON.stringify([document.id, locale ?? null]);
    const sameDocument = lastResetPlaceRef.current === place;
    lastResetKeyRef.current = resetKey;
    lastResetPlaceRef.current = place;
    const echoOfOwnSave =
      sameDocument &&
      (ownSave.current.inFlight || resetKey === ownSave.current.storedKey);
    form.reset(defaultValuesRef.current, { keepDirtyValues: echoOfOwnSave });
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
  /*
   * The advisory claim, derived before the first write is defined because every
   * write has to be able to ask about it.
   */
  // A user who may read this Single but not change it gets the same page,
  // read-only, with no claim made on the document.
  const updateAnswer = useUpdateAnswer(schema.slug);
  const readOnlyForReader = updateAnswer === "refused";
  // While a language switch's answer is on its way, nothing that saves is
  // offered and a submit is held, though the page is not read-only.
  const mayEdit = editsOffered(updateAnswer);
  // What changing the Single needs is held with it: previewing and sharing a
  // preview (minting a link needs it on the server) and a version's restore,
  // for a reader and while a language switch's answer is on its way.
  const updatesHeld = !mayEdit;
  const lock = useDocumentLockSurface({
    scopeKind: "single",
    slug: schema.slug,
    entryId: document.id,
    readOnlyForReader,
  });

  // System fields: title (system header) and slug (meta strip). Per the
  // special-casing. Any user-defined field with admin.position: "sidebar"
  // now renders inline like every other Builder field.
  const allFields = schema.fields;
  const titleField = allFields.find(f => "name" in f && f.name === "title");
  const slugField = allFields.find(f => "name" in f && f.name === "slug");
  // Takeover layout: a field flagged `layout: "takeover"` (when active) collapses the
  // body to itself + its condition controller. Generic — driven by field-type metadata.
  // Asked of the shared hook so the entry editor cannot answer it differently.
  const { mainFields, controllerNames, takeoverTypes } = useTakeoverLayout(
    allFields,
    form
  );

  // Which past version the document area is showing, the context value that
  // publishes it to the history panel, and the version's own body layout. The
  // same host the entry editor uses: the panel is mounted from the system
  // header for singles too, so the document side has to answer it the same
  // way — without this, a click in the panel publishes a version nothing
  // draws.
  const viewedVersionHost = useViewedVersion(allFields, takeoverTypes);
  const {
    viewingVersion,
    documentHistory,
    historicalFields,
    historicalValues,
  } = viewedVersionHost;
  // One answer for every surface offering a write — the header reads the same
  // through the document-actions model, and the rail, the language panel and
  // the submission handlers below take it from here. Derived from the HOST's
  // state, not the context: this body renders ABOVE the provider this
  // component creates, so a context read here would report no version on
  // screen even while one is.
  const writesHeld = writeActionsHeld(viewingVersion, lock.actionsDisabled);
  // Changing the content is held for a reader as well.
  const editsHeld = writesHeld || !mayEdit;
  // Publishing every language changes only each language's status, so a
  // reader whose document nothing else holds is still offered it.
  const publishAllHeld = statusWritesHeld({
    editsHeld,
    refused: readOnlyForReader,
    writesHeld,
  });
  // A colleague's claim or a reader's page, without the version on screen:
  // what holds the actions a version's own surfaces offer, Restore among them.
  const versionWritesHeld = lock.actionsDisabled || updatesHeld;

  //
  // The synchronous half of the same gate. `isSubmitting` is render state: it
  // publishes one render behind the mutation, so two submissions in the same
  // turn both read false and both write. The latch is set the moment the
  // first submission enters and released when it settles, closing that gap.
  //
  const submissionLatch = useRef(false);

  // Throwing away this language's pending change. Scoped to the active locale:
  // a localized Single holds one per language, so discarding without naming one
  // would remove work in a language the author never opened. Declared beside
  // the busy state because the busy state counts its in-flight flag — restore
  // racing a discard would let completion order decide which document state
  // survives, exactly as with a save.
  const discardMutation = useDiscardSingleWorkingDraft({
    slug: schema.slug,
    documentId: document.id,
    locale,
  });
  const busy = isSubmitting || discardMutation.isPending;

  // A write of the status alone, as a reader's publish or unpublish sends it:
  // it names no field, so the server judges it by that permission alone, and
  // it does not read the form, which a reader cannot change.
  const writeStatus = useCallback(
    async (status: "published" | "draft"): Promise<SubmitOutcome> => {
      if (busy || submissionLatch.current) return submitBusy;
      submissionLatch.current = true;
      try {
        const stored = await onSubmit({ status });
        setSavedCount(n => n + 1);
        if (stored) {
          ownSave.current.storedKey = singleResetKey(stored, locale);
        }
        return { ok: true, item: { id: document.id } };
      } catch (error) {
        return submitFailed(error);
      } finally {
        submissionLatch.current = false;
      }
    },
    [busy, onSubmit, locale, document.id]
  );

  // Resolves to what the submission came to, never rejects, as the entry
  // editor's does: the toasts report to the author, the outcome to the caller.
  const handleSubmit = useCallback(
    async (
      e?: React.BaseSyntheticEvent,
      intent?: EntryFormIntent
    ): Promise<SubmitOutcome> => {
      e?.preventDefault();

      // 🔴 The one gate every write passes through. Save, Publish, Unpublish, the
      // keyboard shortcut and a native form submit all reach this function, and
      // disabling the affordances one at a time is a list that the next write
      // path gets added without. The affordances ARE disabled, so nothing offers
      // what it cannot do - this is the guard that does not depend on anyone
      // remembering. Reading a past version is part of the same claim: this
      // handler acts on the live document, which is not what is on screen. And
      // so is a submit already in flight — parallel writes would let completion
      // order decide which contents survive.
      if (editsHeld) {
        // A reader's publish and unpublish still go, as the status alone.
        const status = readerStatusWrite(intent, {
          refused: readOnlyForReader,
          writesHeld,
        });
        return status === undefined ? submitHeld : writeStatus(status);
      }
      if (busy || submissionLatch.current) return submitBusy;
      submissionLatch.current = true;

      try {
        return await submitDocument({
          form,
          event: e,
          // Why: shared intent→payload helper mirrors the EntryForm
          // contract (see useEntryForm.mapIntentToPayload). Unpublish
          // strips other dirty fields so a confirm-modal misclick can't
          // ship unrelated changes to the public site.
          toPayload: values =>
            mapIntentToPayload(values, intent, blankPasswordFields),
          write: async data => {
            // A link the editor cannot see is held in the form as a
            // placeholder and written as the reference it stands for.
            ownSave.current.inFlight = true;
            const stored = await onSubmit(
              withoutPlaceholders(schema.fields, data)
            ).finally(() => {
              ownSave.current.inFlight = false;
            });
            // After the write lands and before the reset: this is the only
            // point that knows a save succeeded, and a revision that misses
            // one leaves the pane showing the previous draft.
            setSavedCount(n => n + 1);
            if (stored) {
              ownSave.current.storedKey = singleResetKey(stored, locale);
            }
            return {
              // A Single is one document, so what was saved is the one on
              // screen; `onSubmit` reports no row of its own.
              item: { id: document.id },
              // A host that reports no stored document leaves the form at
              // what was sent, the best starting point there is. So does a
              // save that sent a placeholder: the stored document leaves out
              // the link it stands for, and taking it in would drop the link
              // from the form, for the next save to remove.
              stored:
                stored && !holdsPlaceholders(schema.fields, data)
                  ? singleFormDefaults(schema, stored)
                  : null,
            };
          },
        });
      } finally {
        submissionLatch.current = false;
      }
    },
    [
      form,
      onSubmit,
      blankPasswordFields,
      busy,
      editsHeld,
      readOnlyForReader,
      writesHeld,
      writeStatus,
      document.id,
      schema,
      locale,
    ]
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
   * Declared HERE rather than beside the autosave below: the document's
   * actions and the save shortcut read it, and a save guarded on the form's
   * own flag declines for the whole time the editor is open.
   */
  const unsavedWork = useFormUnsavedWork(isDirty);
  const hasUnsavedWork = unsavedWork.hasUnsavedWork;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

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
  // Out of the way when the author collapsed it (shared with the collection
  // editor), and while history is open, which takes its place.
  const { collapsed: railCollapsed, toggle: toggleRail } =
    useDocumentPanelCollapsed(historyEnabledFrom(schema) !== false);

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
    // Never split under a document view, whatever the address asks — the
    // reason the entry editor gives.
    translation: documentView ? undefined : translation,
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
  /*
   * The same advisory claim the entry editor holds, on the same terms. A single
   * is addressed by its slug and the row behind it, and before that row exists
   * there is nothing to claim and nobody else can be in it.
   */

  const autosave = useDocumentAutosave({
    scope: autosaveScope,
    form,
    locale: locale ?? null,
    // Recording is for editing: held off while a real save is in flight and
    // while a PAST VERSION is on screen — the shared predicate states the
    // rule, and the entry editor records on exactly the same terms. A
    // colleague's claim deliberately does not stop it: the recovery point is
    // this author's own work, which is what a takeover preserves.
    // Nor is a reader's form recorded, which cannot change the document, nor
    // one whose language's answer is on its way, which may not yet.
    enabled: !updatesHeld && mayRecordRecovery(busy, viewingVersion),
    // The pace the Single configures, else the editor's default.
    debounceMs: autosaveIntervalFrom(schema),
  });
  const recovery = useAutosaveRecovery({
    // A reader is offered no recovery point: restoring one would make the
    // read-only form dirty with work it cannot save.
    scope: readOnlyForReader ? null : autosaveScope,
    form,
    savedCount,
  });

  /*
   * Throwing away this language's pending change, through the same gate as a
   * save: it reaches the row directly and never passes `handleSubmit`. The
   * latch is held for its duration so a save started in the same turn cannot
   * run against it.
   */
  const discardWorkingDraft = async () => {
    if (editsHeld || busy || submissionLatch.current) {
      return;
    }
    submissionLatch.current = true;
    try {
      await discardMutation.mutateAsync();
    } finally {
      submissionLatch.current = false;
    }
  };

  /*
   * What deciding this document's actions reads. The storing handlers hand
   * back their outcome so an action run from outside the header can say what
   * it came to.
   */
  const documentActionsInput: DocumentActionBindingsInput = {
    mode: "edit",
    hasStatus,
    /* The draft/published split. Without this the actions take their
       `draftsEnabled: false` branch, whose Save names the status — and a write
       that names one is never held, so the engine's pending-change support
       stayed dark for every Single. The label is the visible tell: "Save
       changes" rather than "Save". */
    draftsEnabled: schema.draftsEnabled === true,
    // The whole busy state: the disabled reasons and the discard question
    // reflect a discard in flight as well as a save.
    isSubmitting: busy,
    // Includes work a field holds, so Save is offered for it — and Mod+S,
    // which runs Save — while the page builder holds the change.
    isDirty: hasUnsavedWork,
    entry: entryLike,
    collectionSlug: schema.slug,
    /* The active language, whose row's status the save actions act on — a
       localized single's default row and its translations can be in
       different publish states. */
    locale,
    // A colleague's claim, which withholds every write: a reader's read-only
    // page withholds only the edits, through `canEdit`.
    documentLocked: lock.actionsDisabled,
    canEdit: mayEdit,
    contributedActions: documentActions,
    ...storingHandlers(handleSubmit),
    onDiscardWorkingDraft: discardWorkingDraft,
    onCancel: handleCancel,
    ...(onViewApi === undefined ? {} : { onViewApi }),
  };

  return (
    // A single is only ever edited standalone, so unlike the entry editor there
    // is no embedded case to exclude.
    <UnsavedChangesGuard
      isDirty={hasUnsavedWork}
      disabled={isSubmitting}
      fields={schema.fields}
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
            {/* Above the header — which mounts the history panel — and above
                the body, so a version the panel publishes is one both of them
                see. The entry editor provides the same context at the same
                depth. */}
            <DocumentHistoryContext.Provider value={documentHistory}>
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
                // Nor beside a document view, which takes the window alone.
                open={previewPane.open && !documentView && !updatesHeld}
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
                  {/* A document view replaces the form body and nothing around
                      it, as in the entry editor. */}
                  <DocumentActionsHost input={documentActionsInput}>
                    {/* Mod+S runs the Save action, so a Single saves by the
                      same rule the entry editor does. The view owns Escape;
                      the save chords stay. */}
                    <DocumentSaveShortcuts
                      onCancel={documentView ? undefined : handleCancel}
                      hasUnsavedWork={hasUnsavedWork}
                      isSubmitting={isSubmitting}
                    />
                    {documentView ? (
                      <DocumentViewBody
                        view={documentView}
                        target={{ singleSlug: schema.slug }}
                        form={form}
                        lock={lock}
                        recovery={recovery}
                        viewingVersion={viewingVersion}
                        fields={schema.fields}
                      />
                    ) : (
                      <div className={cn("space-y-0", className)}>
                        {/* Its native submit — Enter in a field, or a
                            submit-typed Save — runs the Save action, so it
                            stores what Mod+S does and waits for what Save
                            waits for. */}
                        <SaveActionFormProvider form={form}>
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
                                  // A recovery point newer than the stored document, still on offer:
                                  // its edits are not stored, whatever the form says.
                                  pendingRecoveryAt={
                                    recovery.offer?.savedAt ?? null
                                  }
                                  autosaveLastSavedAt={autosave.lastSavedAt}
                                  mode="edit"
                                  titleField={titleField}
                                  historyFields={schema.fields}
                                  historyEnabled={historyEnabledFrom(schema)}
                                  historyRetention={historyRetentionFrom(
                                    schema
                                  )}
                                  historyLifecycle={hasStatus}
                                  // The whole busy state: the header's spinner,
                                  // disabled reasons and discard dialog all
                                  // reflect a discard in flight as well as a save.
                                  isSubmitting={busy}
                                  hasUnsavedWork={hasUnsavedWork}
                                  entry={entryLike}
                                  collectionSlug={schema.slug}
                                  localized={schema.localized === true}
                                  /* A Single has a draft lifecycle, so it has drafts worth
                   sharing. The control is offered whenever the Single carries
                   that lifecycle; whether a link can actually be minted is the
                   server's call, and it refuses with a message naming what is
                   missing rather than handing out one that 404s. */
                                  // Sharing a preview needs the permission to change
                                  // the Single on the server, so a reader is not offered it.
                                  isLinkAvailable={
                                    previewLink.isAvailable && !updatesHeld
                                  }
                                  // Withheld from a reader, so the share
                                  // popover cannot stay mounted for them.
                                  {...(previewLink.shareDocument ===
                                    undefined || updatesHeld
                                    ? {}
                                    : {
                                        shareDocument:
                                          previewLink.shareDocument,
                                      })}
                                  /* The pane is offered on exactly the terms the
                           shareable link is: a Single with a draft lifecycle
                           and a resolvable language. Withheld in translation
                           mode, where the pane itself is withheld — a button
                           that toggles a flag nothing reads is worse than no
                           button. */
                                  // A reader is offered no preview, as the
                                  // share link beside it: opening one mints a
                                  // credential the server grants only to a
                                  // user who may change the Single.
                                  {...(updatesHeld ? {} : previewPane.toggle)}
                                  toolbarSlot={versionAwareToolbarSlots(
                                    viewedVersionHost,
                                    // A reader's page holds the slot's writes too.
                                    versionWritesHeld,
                                    "single",
                                    controllerNames[0]
                                  )}
                                  /* Why: Singles share the Show JSON dialog with collections,
                 but at the /api/singles/{slug} URL pattern. Passing
                 `scope="single"` routes the dialog through singleApi
                 instead of entryApi. */
                                  scope="single"
                                  lockIdentity
                                  documentLocked={lock.readOnly}
                                  isRailCollapsed={railCollapsed}
                                  onToggleRail={toggleRail}
                                />
                                <EntryMetaStrip
                                  slugField={slugField}
                                  hasStatus={hasStatus}
                                  status={documentStatus}
                                  // The pill shows wherever the panel is off
                                  // screen, a phone included, so it reports a
                                  // pending working draft as the panel does.
                                  hasWorkingDraft={hasPendingWorkingDraft(
                                    document
                                  )}
                                  isRailCollapsed={railCollapsed}
                                  lockSlug
                                  documentId={document.id}
                                />

                                {/* Inside the main column, below the header, matching the entry
                  editor. Placed above the flex row it sat UNDER the sticky
                  header, which intercepted pointer events: the offer was
                  visible and its buttons were not clickable. */}
                                <DocumentLockBanner
                                  notice={lock.notice}
                                  onTakeOver={lock.takeOver}
                                  onRequestAccess={lock.requestAccess}
                                  className="mx-6 mt-3"
                                />
                                <LiveDocumentRecoveryOffer
                                  recovery={recovery}
                                  viewingVersion={viewingVersion}
                                  className="mx-6 mt-3"
                                />

                                {/* The language panel, inline: the exact complement
                              of the rail, shown where the rail is not. */}
                                <SingleFormLanguagePanel
                                  actionsDisabled={editsHeld}
                                  publishAllDisabled={publishAllHeld}
                                  // A reader may still open the other languages.
                                  navigationDisabled={writesHeld}
                                  enabled={localizationEnabled}
                                  hasStatus={hasStatus}
                                  railCollapsed={railCollapsed}
                                  {...(singleTranslations === undefined
                                    ? {}
                                    : { translations: singleTranslations })}
                                  {...(locale === undefined ? {} : { locale })}
                                  {...(onLocaleChange === undefined
                                    ? {}
                                    : { onLocaleChange })}
                                />

                                {/* Reading a past version replaces the document rather
                              than opening beside it — see the fields panel. */}
                                <SingleFormFieldsPanel
                                  historicalFields={historicalFields}
                                  historicalValues={historicalValues}
                                  isSubmitting={isSubmitting}
                                  mainFields={mainFields}
                                  readOnly={lock.readOnly}
                                  // A submit in flight withholds restore too: a
                                  // restore racing the ordinary save would let
                                  // completion order decide which contents
                                  // survive.
                                  // A reader's page holds restoring as well.
                                  versionActionsHeld={versionWritesHeld || busy}
                                />
                              </div>

                              {/* Rail (collapsible). */}
                              <SingleFormRail
                                actionsDisabled={editsHeld}
                                publishAllDisabled={publishAllHeld}
                                navigationDisabled={writesHeld}
                                entry={entryLike}
                                hasStatus={hasStatus}
                                isDirty={isDirty}
                                railCollapsed={railCollapsed}
                                {...(locale === undefined ? {} : { locale })}
                                {...(onLocaleChange === undefined
                                  ? {}
                                  : { onLocaleChange })}
                              />
                            </div>
                          </CopyFromLanguageScope>
                        </SaveActionFormProvider>
                      </div>
                    )}
                  </DocumentActionsHost>
                </TranslationPanes>
              </PreviewPanes>
            </DocumentHistoryContext.Provider>
          </EntryLocaleProvider>
        </EntryFormContextProvider>
      </UnsavedWorkProvider>
    </UnsavedChangesGuard>
  );
}
