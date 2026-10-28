/**
 * Entry Form Component
 *
 * Main entry form component that orchestrates all form parts:
 * - useEntryForm hook for state management
 * - EntryFormProvider for form context
 * - EntrySystemHeader for title input + actions + dropdown + rail toggle
 * - EntryMetaStrip for slug + status pill (when rail collapsed)
 * - EntryFormContent for field rendering (Builder-defined fields only)
 * - EntryFormSidebar for system metadata (Document panel only)
 *
 * Supports both standalone (page) and embedded (modal) modes.
 *
 * @module components/entries/EntryForm/EntryForm
 * @since 1.0.0
 */

import type { JSX, ReactNode } from "react";
import { useCallback, useMemo, useState } from "react";

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
import { CONTENT_MEASURE_LENGTH } from "@admin/components/layout/content-measure";
import { toast } from "@admin/components/ui";
import { buildRoute, ROUTES } from "@admin/constants/routes";
import { usePublishAllLocales } from "@admin/hooks/queries/usePublishAllLocales";
import { useAutosaveRecovery } from "@admin/hooks/useAutosaveRecovery";
import { useAutoSlug } from "@admin/hooks/useAutoSlug";
import { useCan } from "@admin/hooks/useCan";
import { useCanRequest } from "@admin/hooks/useCanRequest";
import {
  autosaveScopeFor,
  useDocumentAutosave,
} from "@admin/hooks/useDocumentAutosave";
import { previewMessage, useEntryPreview } from "@admin/hooks/useEntryPreview";
import { useLocalization } from "@admin/hooks/useLocalization";
import { useTakeoverLayout } from "@admin/hooks/useTakeoverLayout";
import { editsOffered, useUpdateAnswer } from "@admin/hooks/useUpdateAnswer";
import { conditionFieldNames } from "@admin/lib/builder/takeoverLayout";
import { cn } from "@admin/lib/utils";
import type { PreviewLinkDocument } from "@admin/services/previewLinkApi";

import { CopyFromLanguageScope } from "../CopyFromLanguageScope";
import { collectionSourceFetcher } from "../entry-locale-source";
import { EntryLocaleProvider } from "../EntryLocaleContext";
import { DocumentLanguagePanel } from "../LanguagePanel";
import { PreviewPanes } from "../PreviewMode/PreviewPanes";
import { previewRevisionOf } from "../PreviewMode/previewRevision";
import { TranslationPanes } from "../TranslationMode/TranslationPanes";
import { useTranslationSource } from "../TranslationMode/useTranslationSource";
import { useEntryLocaleContext } from "../useEntryLocaleContext";

import { LiveDocumentRecoveryOffer } from "./AutosaveRecoveryBanner";
import type { ContributedAction } from "./DocumentActionBar";
import {
  DocumentActionsHost,
  DocumentSaveShortcuts,
  SaveActionFormProvider,
} from "./DocumentActionsContext";
import { DocumentLockBanner } from "./DocumentLockBanner";
import { DocumentViewBody, type DocumentViewMount } from "./DocumentViewBody";
import {
  effectiveEntryStatus,
  isSlugPerLocale,
  previewLinkLocale,
  useHasPublicAddress,
} from "./entry-address";
import { fieldsBesidePanel } from "./EntryFieldsPanel";
import { EntryFormActions } from "./EntryFormActions";
import { EntryFormContent } from "./EntryFormContent";
import {
  EntryFormContextProvider,
  hasPendingWorkingDraft,
} from "./EntryFormContext";
import { EntryFormProvider } from "./EntryFormProvider";
import { EntryFormSidebar } from "./EntryFormSidebar";
import { EntryMetaStrip } from "./EntryMetaStrip";
import { EntrySystemHeader } from "./EntrySystemHeader";
import { FormErrorSummary } from "./FormErrorSummary";
import { PublicUrlChangeNotice } from "./PublicUrlChangeNotice";
import { deleteHeld, submitHeld } from "./submit-outcome";
import { UnsavedChangesGuard } from "./UnsavedChangesGuard";
import { UnsavedWorkProvider, useFormUnsavedWork } from "./UnsavedWorkContext";
import {
  storingHandlers,
  type DocumentActionBindingsInput,
} from "./useDocumentActionBindings";
import { useDocumentLockSurface } from "./useDocumentLockSurface";
import { useDocumentPanelCollapsed } from "./useDocumentPanelCollapsed";
import {
  useEntryForm,
  getCollectionFields,
  type EntryFormCollection,
  type EntryData,
  type EntryFormMode,
} from "./useEntryForm";

// ============================================================================
// Types
// ============================================================================

export interface EntryFormProps {
  /** Collection configuration with field schema */
  collection: EntryFormCollection;
  /** Existing entry data (for edit mode) */
  entry?: EntryData | null;
  /** Form mode - 'create' or 'edit' */
  mode: EntryFormMode;
  /** Callback when form is successfully submitted */
  onSuccess?: (entry: EntryData) => void;
  /** Callback when form submission fails */
  onError?: (error: unknown) => void;
  /** Callback when entry is deleted (edit mode only) */
  onDelete?: () => void;
  /** Callback when form is cancelled */
  onCancel?: () => void;
  /** Active content locale — saves target this language. */
  locale?: string;
  /**
   * Whether the parent read this entry with the working-draft overlay (`draft`).
   * Forwarded to the update so its optimistic cache key matches the query on
   * screen. Omit for the full-page editor (it reads the overlay for a drafts
   * collection); an embedded editor reading the live row passes `false`.
   */
  readDraft?: boolean;
  /** Called when the user switches the active content language. */
  onLocaleChange?: (locale: string, options?: { seedFrom?: string }) => void;
  /**
   * Default-language field values. Provided while translating a non-default language
   * so each translatable field can show its source text inline. Keyed by field name (camelCase).
   */
  sourceValues?: Record<string, unknown>;
  /** A seed the language switch asked for; forwarded to the copy-from action. */
  seedFromLocale?: string;
  /** Clears that seed once it has been offered. */
  onSeedHandled?: () => void;
  /**
   * Embedded mode for use in modals.
   * When true:
   * - Header is hidden (modal provides its own)
   * - Sidebar is hidden
   * - Layout is single column
   */
  embedded?: boolean;
  /**
   * Opens this entry's API response.
   *
   * Supplied by the route, which is what knows how to navigate. Without it the
   * header offers no way to inspect the document at all: `Show JSON` used to
   * fill that role and the menu now names this instead, so an unwired callback
   * is a capability removed rather than replaced.
   */
  onViewApi?: () => void;
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
  /**
   * A strip about the whole document, such as its scheduled release, drawn in
   * the editor's column directly under the header. Given here rather than
   * placed above the form by the page: the editor's row pulls itself up over
   * the page's top inset, so anything placed before it slides under the
   * sticky header.
   */
  documentBanner?: ReactNode;
  /**
   * @experimental A plugin's document view to draw in place of the form body,
   * when the route names one. Standalone only: an embedded editor has no
   * address for a view to live at.
   */
  documentView?: DocumentViewMount;
  /** Additional CSS classes for the form container */
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
  className?: string;
}

// ============================================================================
// Component
// ============================================================================

/**
 * EntryForm - Complete entry create/edit form
 *
 * A fully-featured form component for creating and editing collection entries.
 * Automatically generates form fields from collection schema, handles validation
 * with Zod, and manages create/update/delete operations.
 *
 * ## Modes
 *
 * - **Standalone (default)**: Full-featured form with header, two-column layout,
 *   sidebar, and action buttons. Used on dedicated create/edit pages.
 *
 * - **Embedded**: Simplified layout for use in modals (e.g., RelationshipCreateModal).
 *   No header, no sidebar, single column layout.
 *
 * ## Features
 *
 * - Dynamic form generation from collection schema
 * - Zod validation from field configurations
 * - Create and edit modes
 * - Two-column layout with metadata sidebar (standalone)
 * - Actions dropdown with delete/duplicate (edit mode)
 * - Loading and submitting states
 * - Dirty state tracking
 * - **Unsaved changes protection** - prompts before navigation when dirty (standalone only)
 * - **Server error mapping** - maps server validation errors to form fields with summary
 * - **Autosave** - a debounced server-side recovery point, offered back on return (standalone only)
 *
 * @example Standalone create mode
 * ```tsx
 * <EntryForm
 *   collection={collection}
 *   mode="create"
 *   onSuccess={(entry) => navigate(`/entries/${entry.id}`)}
 *   onCancel={() => navigate("/entries")}
 * />
 * ```
 *
 * @example Standalone edit mode
 * ```tsx
 * <EntryForm
 *   collection={collection}
 *   entry={existingEntry}
 *   mode="edit"
 *   onSuccess={() => toast.success("Saved!")}
 *   onDelete={() => navigate("/entries")}
 *   onDuplicate={handleDuplicate}
 *   onCancel={() => navigate("/entries")}
 * />
 * ```
 *
 * @example Embedded in modal
 * ```tsx
 * <Dialog open={open} onOpenChange={setOpen}>
 *   <DialogContent>
 *     <DialogHeader>
 *       <DialogTitle>Create New {collection.label}</DialogTitle>
 *     </DialogHeader>
 *     <EntryForm
 *       collection={collection}
 *       mode="create"
 *       embedded
 *       onSuccess={(entry) => {
 *         onCreated(entry);
 *         setOpen(false);
 *       }}
 *       onCancel={() => setOpen(false)}
 *     />
 *   </DialogContent>
 * </Dialog>
 * ```
 */
export function EntryForm({
  collection,
  entry,
  mode,
  onSuccess,
  onError,
  onDelete,
  onCancel,
  locale,
  readDraft,
  onLocaleChange,
  seedFromLocale,
  onSeedHandled,
  sourceValues,
  translation,
  embedded = false,
  className,
  onViewApi,
  documentActions,
  documentBanner,
  documentView,
}: EntryFormProps): JSX.Element {
  /*
   * Whether the preview pane is open, and when the document last saved.
   *
   * Held by the form rather than the page: the pane wraps the editor, and the
   * save that refreshes it is this component's own. A page-level flag would
   * have to be threaded back down through props that exist for nothing else.
   */
  const [previewOpen, setPreviewOpen] = useState(false);

  /*
   * How many times THIS form has saved, which the preview revision folds in.
   *
   * Needed because the derived half of that revision goes blind for the most
   * ordinary edit there is. A status-less save of a published entry writes the
   * working-draft sidecar and leaves the live row untouched, so from the second
   * such save onward the document's `updatedAt` and its working-draft flag both
   * stand still while its content changes underneath them. Counting saves is
   * the only signal to that write available on this side of the wire.
   *
   * A count rather than a timestamp: two saves inside the same millisecond are
   * indistinguishable by clock, and nothing here needs to know WHEN.
   */
  const [savedCount, setSavedCount] = useState(0);

  const {
    form,
    handleSubmit: submitEntry,
    handleDelete: deleteEntry,
    handleDiscardWorkingDraft: discardWorkingDraft,
    handleCancel,
    isSubmitting,
    isDirty,
  } = useEntryForm({
    collection,
    entry,
    mode,
    locale,
    readDraft,
    onSuccess: data => {
      // Before the caller's handler, which may navigate away: this is the only
      // point that knows a write landed, and a revision that misses one leaves
      // the pane showing the previous draft.
      setSavedCount(n => n + 1);
      onSuccess?.(data);
    },
    onError,
    onDelete,
    onCancel,
  });

  // Content-locale context for field components — the active locale's writing
  // direction (RTL for Arabic/Hebrew/…), the collection's master localization switch (so a
  // field can tell whether it is translatable), and whether the active language differs from
  // the app default (per-field affordances only apply while translating a non-default language).
  // All inert for LTR / non-localized editors — the plain path is unchanged.
  const {
    getLocale,
    defaultLocale,
    enabled: localizationEnabled,
  } = useLocalization();
  // The entry's own publish-every-language mutation, handed to the shared
  // availability rule through the locale context. Called unconditionally with
  // the resolved slug; the seam below is what decides whether the action is
  // offered, so a create form supplies none and nothing renders.
  const publishAllEntryLocales = usePublishAllLocales({
    collectionSlug: collection.slug ?? collection.name,
  });

  // Publish-every-language rides the same kind of seam `fetchSourceValues`
  // does, and its ABSENCE is what keeps the action off a create form: there is
  // no saved entry to publish until one exists.
  const publishAllLanguages = useMemo(() => {
    const entryId = entry?.id ?? undefined;
    if (!entryId) return undefined;
    return {
      slug: collection.slug ?? collection.name,
      publish: () => publishAllEntryLocales.mutate(entryId),
      pending: publishAllEntryLocales.isPending,
    };
  }, [entry?.id, collection.slug, collection.name, publishAllEntryLocales]);

  const translationMode = useTranslationSource({
    fields: getCollectionFields(collection),
    documentLocalized: collection.localized === true,
    // A document view is one full-screen surface editing the language it
    // opened in, so translation mode never splits it, whatever the address
    // asks. Withheld at the source so every surface that reads the mode —
    // the panes, the locale context — agrees it is off.
    translation: documentView ? undefined : translation,
    locale,
    defaultLocale,
    getLocale,
  });

  const collectionSlug = collection.slug ?? collection.name;

  const localeCtx = useEntryLocaleContext({
    locale,
    defaultLocale,
    getLocale,
    documentLocalized: collection.localized === true,
    fields: getCollectionFields(collection),
    sourceValues,
    inTranslationMode: translationMode.active,
    onLocaleChange,
    seedFromLocale,
    onSeedHandled,
    onEnterTranslationMode: translationMode.onEnter,
    collectionSlug,
    entryId: entry?.id ?? undefined,
    fetchSourceValues: collectionSourceFetcher(
      collectionSlug,
      entry?.id ?? undefined
    ),
    publishAllLanguages,
  });

  // Get all fields. Title and slug are extracted as system fields rendered in
  // their own header card (this PR keeps the existing title/slug special-case;
  // PR 6 of the redesign moves them into the new pinned-headline + rail-slug
  // layout). Per Q-D1=B in the redesign spec, the rail is system-content only:
  // no user-defined fields may use `admin.position: 'sidebar'`, and any
  // legacy `seoField` name match is dropped — components (including ones
  // named "seo") render inline like every other field.
  const allFields = getCollectionFields(collection);
  const slugField = allFields.find(f => f.name === "slug");
  const titleField = allFields.find(f => f.name === "title");

  // Takeover layout: when a field whose type is flagged `layout: "takeover"` is
  // active (its condition passes), show only that field + its condition controller;
  // otherwise the full body. Generic — driven by field-type metadata, not by any
  // specific plugin. (title/slug/status are separate system components, always kept.)
  // Asked of the shared hook so the Single editor cannot answer it differently.
  const { mainFields, controllerNames, takeoverTypes } = useTakeoverLayout(
    allFields,
    form
  );

  /*
   * A renderer for the entry's OTHER fields, handed to whatever surface takes
   * the body over.
   *
   * A full-screen field — the page builder is the one that ships — covers the
   * form completely, so its author cannot reach the SEO fields, the relations
   * or anything else this collection declares without closing the editor and
   * losing its undo history. This is what lets that surface offer them back.
   *
   * Takes the asking field's path, so the surface is never offered ITSELF:
   * rendering the page builder inside the page builder's own settings panel
   * would nest an editor in its own chrome. Keyed on the path rather than on
   * `layout: "takeover"` because no shipped plugin declares that flag, so a
   * rule conditioned on it would never fire.
   *
   * Built from THIS form's `control`, so what the surface draws and what the
   * form submits are one thing. A second `EntryForm` would fork the state and
   * lose the edit made in whichever copy did not save.
   */
  // Get form errors and submit attempt count. submitCount gates the
  // top-level "Please fix the following errors" toast in FormErrorSummary
  // so it only appears after the user actually clicks Save / Publish, not
  // when a field-level revalidation runs after that first attempt.
  const { errors, submitCount } = form.formState;

  // Rail collapse state. Toggle lives in EntrySystemHeader; the rail itself
  // reads `railCollapsed` to decide whether to render. Persisted in
  // localStorage so the choice survives reloads.
  // Out of the way when the author collapsed it, and while history is open,
  // which takes its place.
  const { collapsed: railCollapsed, toggle: toggleRail } =
    useDocumentPanelCollapsed(historyEnabledFrom(collection) !== false);
  // Which past version the document area is showing, the context value that
  // publishes it to the panel, and the version's own body layout — held by the
  // shared host so the Single editor answers the panel identically.
  const viewedVersionHost = useViewedVersion(allFields, takeoverTypes);
  const {
    viewingVersion,
    documentHistory,
    historicalFields,
    historicalValues,
  } = viewedVersionHost;

  // Whether this collection has Draft/Published status enabled at the meta
  // level. When true, the system header splits into Save Draft + Publish/Update
  // and the Document panel + meta strip surface the status pill. When false,
  // the system header collapses to a single Save/Create button and the pill
  // is hidden.
  const hasStatus = collection.status === true;

  // Auto-fill slug from title while the slug looks auto-generated. Why a
  // form-level hook: the title input lives in EntrySystemHeader as a plain
  // <input> bound via form.register, not through TextInput, so the per-field
  // slug-gen logic that used to live in TextInput never fired for the
  // configured title. Mounting the hook here closes that gap and follows the
  // configured title field name (not a hardcoded "title"/"name").
  // Once an entry has a public address its slug stops following its title. That address is in
  // links, feeds, sitemaps and search results, so re-deriving it from an edited title retires a URL
  // the author never chose to change and the old one 404s. Editing the slug directly still works;
  // this only stops the automatic rewrite.
  // The auto-injected slug is shared across languages, so one address serves them all and any
  // published language keeps it frozen. Only a slug the author opted into localizing belongs to
  // the language in view.
  const hasPublicAddress = useHasPublicAddress({
    mode,
    hasStatus,
    entry,
    locale,
    slugLocalized: isSlugPerLocale(slugField, collection.localized === true),
    collectionLocalized: collection.localized === true,
    defaultLocale,
    mutationPending: isSubmitting,
  });

  /*
   * The values every field CONDITION watches, read through `watch` so the panel
   * recomputes as an author changes them rather than only when the form
   * remounts.
   *
   * `watch` answers a name list POSITIONALLY, so the result is zipped back onto
   * the names it was asked for — the same shape `useTakeoverLayout` needs, and
   * for the same reason: handed the bare array, every condition would be
   * evaluated against `undefined` and each conditional field would be judged on
   * a value nobody supplied.
   */
  const conditionNames = useMemo(
    () => conditionFieldNames(allFields),
    [allFields]
  );
  const watchedConditions = form.watch(conditionNames);
  const conditionValues = useMemo(
    () =>
      Object.fromEntries(
        conditionNames.map((name, i) => [name, watchedConditions[i]])
      ),
    [conditionNames, watchedConditions]
  );

  /*
   * Delegated whole, including the decision to answer NULL when there is
   * nothing to draw — which is what withholds the panel rather than opening an
   * empty one. Kept out of this callback so the rule is reachable by a test
   * without standing up the entire form.
   *
   * Declared here rather than beside the other field derivations because it
   * needs `hasPublicAddress`: a surface offering the slug has to carry the same
   * warning the meta strip it covers would have shown.
   */
  const renderEntryFields = useCallback(
    (excludePath: string) =>
      fieldsBesidePanel(allFields, excludePath, {
        disabled: isSubmitting,
        mode,
        values: conditionValues,
        hasPublicAddress,
      }),
    [allFields, isSubmitting, mode, conditionValues, hasPublicAddress]
  );

  useAutoSlug({
    form,
    titleFieldName: titleField?.name ?? "title",
    slugFieldName: slugField?.name ?? "slug",
    enabled: !!titleField && !!slugField,
    frozen: hasPublicAddress,
  });

  // A link names one saved document, so there is nothing to mint against until
  // the entry exists. The id is read here rather than inside the hook because
  // hooks run unconditionally: on create the mutation is constructed and never
  // reachable, since the control that would call it is not rendered.
  const savedEntryId = entry?.id === undefined ? "" : String(entry.id);

  // Recovery points for this author, recorded while they type. Addressed only
  // once the entry has an id: a document that has never been saved has nothing
  // for the endpoint to address, and `null` turns recording off rather than
  // inventing one.

  /*
   * An advisory claim on the document, so two editors are told about each other
   * rather than discovering it when one overwrites the other.
   *
   * Off while creating: a document with no id is nothing to claim, and nobody
   * else can be in it.
   *
   * 🔴 Held THROUGH a past version, which reading alone would not need. The
   * history view offers Restore, and restoring writes the live document — so
   * dropping the claim here would let someone study an old snapshot, never see
   * the colleague who arrived meanwhile, and overwrite them from a surface that
   * looked read-only. The autosave is still held off while a version is on
   * screen, which is a different question: what it would RECORD.
   */
  // A user who may read this entry but not change it gets the same page,
  // read-only, with no claim made on the document.
  const updateAnswer = useUpdateAnswer(collectionSlug);
  const readOnlyForReader = updateAnswer === "refused" && mode === "edit";
  // While a language switch's answer is on its way, nothing that saves is
  // offered and a submit is held, though the page is not read-only.
  const mayEdit = mode === "create" || editsOffered(updateAnswer);
  // What changing the entry needs is held with it: previewing and sharing a
  // preview (minting a link needs it on the server) and a version's restore,
  // for a reader and while a language switch's answer is on its way.
  const updatesHeld = !mayEdit;
  const lock = useDocumentLockSurface({
    scopeKind: "collection",
    slug: collectionSlug,
    entryId: entry?.id,
    enabled: mode === "edit",
    readOnlyForReader,
  });
  // One answer for every surface offering a write: the header reads the same
  // through the document-actions model, the rail, the language panel and the
  // submission handlers from here. Derived from the HOST's state, not the
  // context — this body renders ABOVE the provider this component creates, so
  // a context read here would report no version on screen even while one is.
  const writesHeld = writeActionsHeld(viewingVersion, lock.actionsDisabled);
  // Changing the content is held for a reader as well. Deleting is not: it
  // follows its own permission, and is offered only with it.
  const editsHeld = writesHeld || !mayEdit;
  // A colleague's claim or a reader's page, without the version on screen:
  // what holds the actions a version's own surfaces offer, Restore among them.
  const versionWritesHeld = lock.actionsDisabled || updatesHeld;
  // Delete is offered only to a caller who may delete in this collection.
  // The quick-edit and quick-create modals save only with the update or
  // create permission their mode needs: those modals open from a related
  // field, not through the route guard the full editor sits behind.
  const canDelete = useCan(`delete-${collectionSlug}`);
  // The modals send no language, so the server writes the default one: a
  // create is answered so already, and an update by its own cell.
  const canCreate = useCan(`create-${collectionSlug}`);
  const canUpdateUnnamed = useCanRequest(
    collectionSlug,
    "updateInDefaultLanguage"
  );
  const canSave = mode === "create" ? canCreate : canUpdateUnnamed;

  /*
   * The one gate every write passes through.
   *
   * 🔴 Not the controls. Save, Publish, Unpublish, Delete, discarding a working
   * draft, the keyboard shortcut, a native form submit and the quick-edit modal
   * all reach these three functions. Disabling the affordances one at a time is
   * a list that the next write path gets added without, and the failure is
   * silent: the banner says the document is somebody else's while the editor
   * overwrites them. The affordances ARE disabled, so nothing offers what it
   * cannot do — this is the guard that does not depend on remembering. Reading
   * a past version is part of the same claim: the handlers below act on the
   * live document, which is not what is on screen.
   */
  const handleSubmit: typeof submitEntry = (event, intent) => {
    // The native submit is ALWAYS prevented, before any gate: this handler
    // is the entry form's onSubmit, and returning without preventing the
    // default lets the browser submit the form natively — reloading the page
    // and dropping the reader's history state.
    event?.preventDefault();
    return editsHeld ? Promise.resolve(submitHeld) : submitEntry(event, intent);
  };
  const handleDelete = () =>
    writesHeld ? Promise.resolve(deleteHeld) : deleteEntry();
  const handleDiscardWorkingDraft = () =>
    editsHeld ? Promise.resolve() : discardWorkingDraft();

  const autosaveScope = useMemo(
    () => autosaveScopeFor("collection", collection.name, savedEntryId),
    [savedEntryId, collection.name]
  );
  // The other half of recording: offer the work back when the editor opens, and
  // write it into this form when the author accepts.
  const recovery = useAutosaveRecovery({
    // A reader is offered no recovery point: restoring one would make the
    // read-only form dirty with work it cannot save.
    scope: readOnlyForReader ? null : autosaveScope,
    form,
    savedCount,
  });

  /*
   * Work a FIELD holds that the form's values do not contain. The page builder
   * keeps its document in its own store and commits on exit, so without this
   * the form is not dirty through an entire editing session — and the guard,
   * the save shortcut and the header are all wrong together.
   */
  const unsavedWork = useFormUnsavedWork(isDirty);
  const hasUnsavedWork = unsavedWork.hasUnsavedWork;

  const autosave = useDocumentAutosave({
    scope: autosaveScope,
    form,
    locale: locale ?? null,
    /*
     * Held off while a real save is in flight: the document is about to change
     * underneath the snapshot, so a recovery point written now would describe a
     * state that never existed. And held off while a PAST VERSION is on screen:
     * the live form is not what the author is looking at, so recording during
     * the reading describes work against a document nobody is tending. The
     * shared predicate states the rule once for both editors.
     */
    // Nor is a reader's form recorded, which cannot change the document, nor
    // one whose language's answer is on its way, which may not yet.
    enabled: !updatesHeld && mayRecordRecovery(isSubmitting, viewingVersion),
    // The pace the collection configures, else the editor's default.
    debounceMs: autosaveIntervalFrom(collection),
  });
  const linkLocale = previewLinkLocale({
    localized: collection.localized === true,
    locale,
    defaultLocale,
  });
  // No site URL is computed here. A link that travels by email or chat has to
  // name a host, and the server is the only place that can: `settings` is a
  // system resource the `editor` and `author` presets cannot read, and those
  // are exactly the roles that share preview links.
  // The document the share popover makes links for and lists. Absent until
  // the entry is saved, which is when it has an id to name, and while the
  // language is unknown: a link minted without a resolvable locale is either
  // refused or a grant over every translation.
  // Withheld from a reader too, so the share popover cannot stay mounted
  // once the user may no longer change the entry.
  const shareDocument: PreviewLinkDocument | undefined =
    updatesHeld || savedEntryId === "" || linkLocale.kind === "unresolved"
      ? undefined
      : {
          collection: collection.name,
          entryId: savedEntryId,
          ...(linkLocale.kind === "scoped"
            ? { locale: linkLocale.locale }
            : {}),
        };

  /*
   * Opening the preview, which is a different action from minting the link
   * beside it: this one uses the editor's OWN session and hands out no
   * credential, so it is offered wherever the collection declares a preview
   * rather than only where a link may be shared.
   *
   * Given the SAVED entry rather than the form's current values. The site's
   * draft route renders the saved row, so resolving the address from an unsaved
   * slug would open a page that does not exist yet — the address and the
   * content have to agree.
   */
  const entryPreview = useEntryPreview({
    collection,
    entry,
    // The SAME resolution the shareable link uses, for the same reason: the
    // token's scope is what the preview route redirects from, so an unscoped
    // token on a localized collection opens the default language whichever one
    // is being edited. `unscoped` is right only where there are no
    // translations, which is what this answers.
    ...(linkLocale.kind === "scoped" ? { locale: linkLocale.locale } : {}),
    onUnavailable: reason => {
      toast.error(previewMessage(reason));
    },
  });

  /*
   * Decided ONCE and used for both the flag and the handler.
   *
   * `PreviewActions` needs the pair and draws nothing without either, so
   * answering this question twice — once for each prop — is a divergence the
   * control's own shape would hide: a handler passed where the flag says no
   * looks identical to no preview at all, and the disagreement only surfaces
   * when someone later reads one of them alone.
   *
   * The saved-id half is not about permission. What opens renders the saved
   * row, so on a create form there is nothing at the address yet.
   *
   * An unresolved language withholds it too, on the same grounds as the link
   * beside it. The reasons differ and both bite: a link minted without one is a
   * grant over every translation, while a preview opened without one silently
   * shows the wrong one.
   */
  const previewRevision = previewRevisionOf(entry, savedCount);

  // Previewing, and sharing a preview, are offered only to a user who may
  // change the entry: minting a link needs that on the server.
  const canPreview =
    !updatesHeld &&
    entryPreview.isPreviewAvailable &&
    savedEntryId !== "" &&
    linkLocale.kind !== "unresolved";

  // The ACTIVE language's state, matching the meta strip beside it: a
  // field that covers the editor's chrome has to report the same thing the
  // chrome would have. Omitted while creating, where nothing is persisted yet
  // and a guessed "draft" would be a claim nobody made. Derived once for both
  // layouts below, so a field or a document view reads the same answer in a
  // modal as on the full page.
  const contextDocumentStatus =
    mode === "create"
      ? {}
      : {
          documentStatus: {
            status:
              effectiveEntryStatus(entry, locale, defaultLocale) ?? "draft",
            hasWorkingDraft: hasPendingWorkingDraft(entry),
          },
        };

  /*
   * What deciding this document's actions reads. Every write handler goes
   * through the gate above, and the storing ones hand back their outcome so an
   * action run from outside the header can say what it came to.
   */
  const documentActionsInput: DocumentActionBindingsInput = {
    mode,
    hasStatus,
    draftsEnabled: collection.draftsEnabled === true,
    isSubmitting,
    // Includes work a field holds, so Save is offered for it — and Mod+S,
    // which runs Save — while the page builder holds the change.
    isDirty: hasUnsavedWork,
    entry,
    collectionSlug: collection.name,
    locale,
    // A colleague's claim, which withholds every write: a reader's read-only
    // page withholds only the edits, through `canEdit`.
    documentLocked: lock.actionsDisabled,
    canEdit: mayEdit,
    contributedActions: documentActions,
    ...(onViewApi === undefined ? {} : { onViewApi }),
    ...storingHandlers(handleSubmit),
    onCancel: handleCancel,
    // No handler, no Delete: the action bar draws no action it cannot run.
    ...(canDelete ? { onDelete: handleDelete } : {}),
    onDiscardWorkingDraft: handleDiscardWorkingDraft,
  };

  // Embedded mode: simplified single-column layout for modals
  // Note: Preview is typically not shown in embedded mode (modals)
  if (embedded) {
    return (
      <EntryFormContextProvider
        kind="collection"
        entryId={entry?.id}
        collectionSlug={collection.name}
        isCreateMode={mode === "create"}
        {...contextDocumentStatus}
      >
        <EntryFormProvider
          form={form}
          // The quick-edit form submits natively and reports through its own
          // toasts, so what the save came to is not read here. A caller who
          // may not save sends nothing: Enter in a field submits even with
          // no Save on screen.
          onSubmit={async event => {
            if (!canSave) {
              event?.preventDefault();
              return;
            }
            await handleSubmit(event);
          }}
          className={className}
        >
          <div className="space-y-6">
            {/* 🔴 Here too, not only in the standalone layout. Quick-edit from a
                relationship picker claims the related entry exactly as the full
                editor does, so without this a colleague's claim renders every
                field in the modal uneditable with nothing saying why and no way
                to take it over — a locked form that reads as a broken one. */}
            <DocumentLockBanner
              notice={lock.notice}
              onTakeOver={lock.takeOver}
              onRequestAccess={lock.requestAccess}
            />
            {/* Error summary at top of form */}
            <FormErrorSummary errors={errors} submitCount={submitCount} />
            {/* This branch renders every collection field, the editable slug among them, but not
                the meta strip that carries the notice in the standalone layout. Quick-edit from a
                relationship picker lands here on existing entries, so without this the one place
                the warning is skipped is also a place a live URL can be rewritten and saved. */}
            {slugField && (
              <PublicUrlChangeNotice
                slugName={slugField.name ?? "slug"}
                active={hasPublicAddress}
                className="block"
              />
            )}
            {/* Forward the form mode so write-only password fields render
                their edit-mode affordance: on edit a blank password input
                means "keep the current password" (the stored hash never
                round-trips), so it is not treated as a required-field miss. */}
            <EntryFormContent
              fields={getCollectionFields(collection)}
              disabled={isSubmitting}
              // Without the permission to save, the entry is shown as it is
              // rather than as a form whose changes go nowhere.
              readOnly={lock.readOnly || !canSave}
              mode={mode}
            />
            <EntryFormActions
              mode={mode}
              isSubmitting={isSubmitting}
              onCancel={handleCancel}
              canSave={canSave}
            />
          </div>
        </EntryFormProvider>
      </EntryFormContextProvider>
    );
  }

  // Standalone mode: compact layout — system header, meta strip, fields,
  // and (optional) right rail. No breadcrumbs, no DocumentTabs, no separate
  // page title h1; the title input lives inside EntrySystemHeader.
  return (
    // Standalone only. An embedded editor lives in a modal, where leaving is
    // closing the dialog rather than a history move — and a modal opened FROM
    // this editor would mount a second interceptor over this one, so two
    // dialogs would answer one navigation.
    <UnsavedChangesGuard
      isDirty={hasUnsavedWork}
      disabled={isSubmitting}
      fields={getCollectionFields(collection)}
      // A refused switch takes its seed with it. The request to fill the target
      // from this language was made ALONGSIDE a navigation; if the navigation
      // does not happen, the request did not either — and a seed left behind
      // fires the moment the author reaches that language by any other route,
      // offering a copy they declined minutes earlier.
      onCancel={onSeedHandled}
    >
      <UnsavedWorkProvider report={unsavedWork.report}>
        <EntryLocaleProvider value={localeCtx}>
          <DocumentHistoryContext.Provider value={documentHistory}>
            {/* Renders its child alone when there is no source — see the module. */}
            <PreviewPanes
              /*
               * Withheld while translation mode is on. That mode already splits
               * the editor and takes the window, and a third pane inside it is
               * a different layout question than this one answers — offering it
               * would produce two nested resizable groups and two chrome
               * requests disagreeing about how much of the admin is left.
               */
              // Nor beside a document view, which takes the window alone; the
              // flag survives a move from the edit screen into the view.
              // Nor for a reader, who is offered no preview: an open pane
              // closes once the user may no longer change the entry.
              open={
                previewOpen &&
                translationMode.source === undefined &&
                !documentView &&
                !updatesHeld
              }
              onClose={() => setPreviewOpen(false)}
              scope={{
                collection: collection.name,
                entryId: savedEntryId,
                ...(linkLocale.kind === "scoped"
                  ? { locale: linkLocale.locale }
                  : {}),
              }}
              label={entryPreview.label}
              revision={previewRevision}
            >
              <TranslationPanes
                source={translationMode.source}
                onExit={translationMode.onExit}
                control={form.control}
              >
                <EntryFormContextProvider
                  entryId={entry?.id}
                  collectionSlug={collection.name}
                  isCreateMode={mode === "create"}
                  {...contextDocumentStatus}
                  // Only where a takeover can happen. The embedded branch renders
                  // the whole body in a modal and hides nothing, so a panel there
                  // would offer a second copy of fields already on screen.
                  renderEntryFields={renderEntryFields}
                >
                  {/* A document view replaces the form body and nothing around
                      it: every provider above, the guard, the claim, the
                      recovery, the shortcut and the document's actions are
                      this editor's own either way. */}
                  <DocumentActionsHost input={documentActionsInput}>
                    {/* Standalone only: an embedded editor in a modal takes no
                      shortcuts. Mod+S runs the Save action, so the shortcut
                      and the button cannot save by different rules. A
                      document view owns Escape — it clears its own selections
                      — so the cancel binding is withheld there; the save
                      chords stay. */}
                    <DocumentSaveShortcuts
                      onCancel={documentView ? undefined : handleCancel}
                      hasUnsavedWork={hasUnsavedWork}
                      isSubmitting={isSubmitting}
                    />
                    {documentView ? (
                      <DocumentViewBody
                        view={documentView}
                        target={{ collectionSlug, entryId: savedEntryId }}
                        form={form}
                        lock={lock}
                        recovery={recovery}
                        viewingVersion={viewingVersion}
                        fields={getCollectionFields(collection)}
                        // A document view has no header, so the banner goes
                        // in among its own: an author working in the view
                        // still sees the document is in a scheduled release.
                        banner={documentBanner}
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

                            {/* Vertical only, not both axes. The vertical half still cancels
                          `PageContainer`'s `py-8` so the editor's two columns
                          reach the top and bottom of the panel. The horizontal
                          half cancelled its `px-8`, and there is none left to
                          cancel: a page that asks for a measure spends its inset
                          as GRID COLUMNS, so the same negative margin now pulls
                          the editor 32px past the content column on each side
                          rather than back to the panel edge. Measured at a
                          1600px viewport: 960px of editor in an 896px column.
                          The two modal callers never had that padding either. */}
                            <div className="flex flex-col @4xl/content:flex-row @4xl/content:min-h-[calc(100vh-4rem)] items-stretch @4xl/content:-my-8">
                              {/* Main column */}
                              <div
                                className="flex-1 min-w-0 flex flex-col mx-auto w-full"
                                // The measure lives on the FIELD column, not on
                                // the page: the rail is a fixed-width sibling,
                                // so a page-level cap would bound the two
                                // together and spend the rail's width out of
                                // the author's. `mx-auto` centres what is left
                                // once the rail has taken its share.
                                style={{ maxWidth: CONTENT_MEASURE_LENGTH }}
                              >
                                {/* No horizontal negative inset here. These bands fill the Main column,
                    which is already as wide as the content column allows;
                    pulling them wider pushed both ~32px past the page edges
                    and clipped the title's first character on the left and
                    the rail toggle on the right. */}
                                <EntrySystemHeader
                                  mode={mode}
                                  documentLocked={lock.readOnly}
                                  titleField={titleField}
                                  isSubmitting={isSubmitting}
                                  // The whole unsaved-work state, so the restore
                                  // confirmation covers builder-held work too.
                                  hasUnsavedWork={hasUnsavedWork}
                                  autosaveEnabled={autosaveScope !== null}
                                  // A recovery point newer than the stored document, still on offer:
                                  // its edits are not stored, whatever the form says.
                                  pendingRecoveryAt={
                                    recovery.offer?.savedAt ?? null
                                  }
                                  autosaveLastSavedAt={autosave.lastSavedAt}
                                  entry={entry}
                                  collectionSlug={collection.name}
                                  // Back to this collection's list, named as the
                                  // navigation names it.
                                  backLink={{
                                    href: buildRoute(
                                      ROUTES.COLLECTION_ENTRIES,
                                      {
                                        slug: collection.name,
                                      }
                                    ),
                                    label:
                                      collection.labels?.plural ||
                                      collection.label ||
                                      collection.name,
                                  }}
                                  historyFields={getCollectionFields(
                                    collection
                                  )}
                                  historyEnabled={historyEnabledFrom(
                                    collection
                                  )}
                                  historyRetention={historyRetentionFrom(
                                    collection
                                  )}
                                  historyLifecycle={hasStatus}
                                  localized={collection.localized === true}
                                  isPreviewAvailable={canPreview}
                                  {...(entryPreview.declaredLabel === undefined
                                    ? {}
                                    : {
                                        previewLabel:
                                          entryPreview.declaredLabel,
                                      })}
                                  {...(canPreview &&
                                  translationMode.source === undefined
                                    ? {
                                        onTogglePreviewPane: () =>
                                          setPreviewOpen(open => !open),
                                        previewPaneOpen: previewOpen,
                                      }
                                    : {})}
                                  {...(canPreview
                                    ? { onPreview: entryPreview.openPreview }
                                    : {})}
                                  // Withheld while the language is unknown as well as while
                                  // the entry is unsaved: a link minted without a resolvable
                                  // locale is either refused by the mint route or, if the claim
                                  // were dropped to avoid that, a grant over every translation.
                                  isLinkAvailable={
                                    !updatesHeld &&
                                    savedEntryId !== "" &&
                                    linkLocale.kind !== "unresolved"
                                  }
                                  {...(shareDocument === undefined
                                    ? {}
                                    : { shareDocument })}
                                  toolbarSlot={versionAwareToolbarSlots(
                                    viewedVersionHost,
                                    // A reader's page holds the slot's writes too.
                                    versionWritesHeld,
                                    "collection",
                                    controllerNames[0]
                                  )}
                                  isRailCollapsed={railCollapsed}
                                  onToggleRail={
                                    mode === "edit" ? toggleRail : undefined
                                  }
                                />
                                {documentBanner}
                                {/* First of the strips: a document somebody else is in
                      changes what every affordance below it means, so it is read
                      before the offer to restore work into it. */}
                                <DocumentLockBanner
                                  notice={lock.notice}
                                  onTakeOver={lock.takeOver}
                                  onRequestAccess={lock.requestAccess}
                                />
                                {/* Above the fields and below the header: the reader sees
                      the document it refers to without the offer covering it. */}
                                <LiveDocumentRecoveryOffer
                                  recovery={recovery}
                                  viewingVersion={viewingVersion}
                                />
                                <EntryMetaStrip
                                  slugField={slugField}
                                  hasStatus={hasStatus}
                                  // The slug is a write, and the same claim withholds it.
                                  lockSlug={lock.readOnly}
                                  // The pill reports the language being edited, matching the header's submit
                                  // affordances. Reading the main row instead would show "Published" beside a
                                  // Publish button whenever a translation lags its default language.
                                  status={
                                    effectiveEntryStatus(
                                      entry,
                                      locale,
                                      defaultLocale
                                    ) ?? "draft"
                                  }
                                  hasWorkingDraft={hasPendingWorkingDraft(
                                    entry
                                  )}
                                  isRailCollapsed={railCollapsed}
                                  hasPublicAddress={hasPublicAddress}
                                  documentId={entry?.id}
                                />

                                {/* The language panel, inline. Its rail mount is
                        `hidden @4xl/content:flex`, so this is the exact
                        complement: shown only where the rail is not. When the
                        rail cannot carry it at all — create mode, or the author
                        collapsed it — the panel renders unconditionally instead,
                        because "the actions live in the rail" is precisely the
                        failure this stage removes. */}
                                {localizationEnabled && (
                                  <div
                                    className={cn(
                                      "px-6 pt-4",
                                      mode === "edit" &&
                                        !railCollapsed &&
                                        "@4xl/content:hidden"
                                    )}
                                  >
                                    <DocumentLanguagePanel
                                      translations={
                                        entry?._translations as
                                          | Record<
                                              string,
                                              {
                                                translated: boolean;
                                                status?: string;
                                              }
                                            >
                                          | undefined
                                      }
                                      locale={locale}
                                      onLocaleChange={onLocaleChange}
                                      hasStatus={hasStatus}
                                      actionsDisabled={editsHeld}
                                      // A reader may still open the other languages.
                                      navigationDisabled={writesHeld}
                                    />
                                  </div>
                                )}

                                {/* Reading a past version replaces the document rather than
                      opening beside it: the question an editor is asking is how
                      this page read then, and that is answered by the page. The
                      live form stays mounted underneath — the historical values
                      are rendered against a form of their own, so nothing typed
                      here is disturbed and nothing historical can reach a save.
                      The swap itself is the shared host's, so the Single editor
                      answers a published version through the same surface. */}
                                <ViewedVersionBody
                                  fields={historicalFields ?? mainFields}
                                  values={historicalValues ?? undefined}
                                  // A submit in flight withholds restore too: a
                                  // restore racing the ordinary save would let
                                  // completion order decide which contents
                                  // survive.
                                  // A reader's page holds restoring as well.
                                  actionsDisabled={
                                    versionWritesHeld || isSubmitting
                                  }
                                >
                                  {mainFields.length > 0 && (
                                    <div className="@4xl/content:p-8 pt-6">
                                      {/* Forward the form mode: in edit mode a blank password
                        field means "keep the current password" rather than a
                        required-field violation (see note on the layout form
                        above). */}
                                      <EntryFormContent
                                        fields={mainFields}
                                        disabled={isSubmitting}
                                        readOnly={lock.readOnly}
                                        withCard
                                        mode={mode}
                                      />
                                    </div>
                                  )}
                                </ViewedVersionBody>
                              </div>

                              {/* Rail (collapsible). Width 320px. Hidden until the content panel
                  is wide enough (@4xl) to fit it beside the main column, until a
                  future mobile sheet ships.

                  The mode === "edit" gate: in create mode the entry does not
                  exist yet, so DocumentPanel returns null and the rail has
                  nothing to show. Rendering it anyway left an empty 320px
                  strip down the right side of the page, which reads as a
                  failed load rather than as an absence. */}
                              {mode === "edit" && !railCollapsed && (
                                <div className="hidden @4xl/content:flex w-[320px] shrink-0 border-l border-border bg-background flex-col relative z-10">
                                  <div className="@4xl/content:sticky @4xl/content:top-0 @4xl/content:h-[calc(100vh-4rem)] overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] flex flex-col">
                                    <EntryFormSidebar
                                      mode={mode}
                                      entry={entry}
                                      hasStatus={hasStatus}
                                      {...(locale === undefined
                                        ? {}
                                        : { locale })}
                                      {...(onLocaleChange === undefined
                                        ? {}
                                        : { onLocaleChange })}
                                      actionsDisabled={editsHeld}
                                      // A reader may still open the other languages.
                                      navigationDisabled={writesHeld}
                                      isDirty={isDirty}
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          </CopyFromLanguageScope>
                        </SaveActionFormProvider>
                      </div>
                    )}
                  </DocumentActionsHost>
                </EntryFormContextProvider>
              </TranslationPanes>
            </PreviewPanes>
          </DocumentHistoryContext.Provider>
        </EntryLocaleProvider>
      </UnsavedWorkProvider>
    </UnsavedChangesGuard>
  );
}
