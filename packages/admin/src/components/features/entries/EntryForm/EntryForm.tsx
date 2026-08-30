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

import { useCallback, useMemo, useState } from "react";

import {
  DocumentHistoryContext,
  type RestoreAffordance,
  type ViewedVersion,
} from "@admin/components/features/versions/document-history-context";
import { HistoricalDocumentBanner } from "@admin/components/features/versions/HistoricalDocumentBanner";
import { historyEnabledFrom } from "@admin/components/features/versions/history-enabled";
import { snapshotToFormValues } from "@admin/components/features/versions/snapshot-to-form-values";
import { VersionSnapshotForm } from "@admin/components/features/versions/VersionSnapshotForm";
import { CONTENT_MEASURE_LENGTH } from "@admin/components/layout/content-measure";
import { Alert, AlertDescription, Skeleton, toast } from "@admin/components/ui";
import { usePublishAllLocales } from "@admin/hooks/queries/usePublishAllLocales";
import { useAutosaveRecovery } from "@admin/hooks/useAutosaveRecovery";
import { useAutoSlug } from "@admin/hooks/useAutoSlug";
import {
  autosaveScopeFor,
  useDocumentAutosave,
} from "@admin/hooks/useDocumentAutosave";
import { previewMessage, useEntryPreview } from "@admin/hooks/useEntryPreview";
import { useEntryFormShortcuts } from "@admin/hooks/useKeyboardShortcuts";
import { useLocalization } from "@admin/hooks/useLocalization";
import { usePreviewLink } from "@admin/hooks/usePreviewLink";
import { useTakeoverLayout } from "@admin/hooks/useTakeoverLayout";
import { computeMainFields } from "@admin/lib/builder/takeoverLayout";
import { cn } from "@admin/lib/utils";

import { CopyFromLanguageScope } from "../CopyFromLanguageScope";
import { collectionSourceFetcher } from "../entry-locale-source";
import { EntryLocaleProvider } from "../EntryLocaleContext";
import { LanguagePanel } from "../LanguagePanel";
import { PreviewPanes } from "../PreviewMode/PreviewPanes";
import { previewRevisionOf } from "../PreviewMode/previewRevision";
import { TranslationPanes } from "../TranslationMode/TranslationPanes";
import { useTranslationSource } from "../TranslationMode/useTranslationSource";
import { useEntryLocaleContext } from "../useEntryLocaleContext";

import { AutosaveRecoveryBanner } from "./AutosaveRecoveryBanner";
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
import { EntryFormToolbarSlots } from "./EntryFormToolbarSlots";
import { EntryMetaStrip } from "./EntryMetaStrip";
import { EntrySystemHeader } from "./EntrySystemHeader";
import { FormErrorSummary } from "./FormErrorSummary";
import { PublicUrlChangeNotice } from "./PublicUrlChangeNotice";
import { UnsavedChangesGuard } from "./UnsavedChangesGuard";
import { UnsavedWorkProvider, useFormUnsavedWork } from "./UnsavedWorkContext";
import {
  useEntryForm,
  getCollectionFields,
  resolveDefaultSaveIntent,
  type EntryFormCollection,
  type EntryData,
  type EntryFormMode,
} from "./useEntryForm";
import { useRailCollapsed } from "./useRailCollapsed";

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
  /** Active content locale (i18n M7) — saves target this language. */
  locale?: string;
  /**
   * Whether the parent read this entry with the working-draft overlay (`draft`).
   * Forwarded to the update so its optimistic cache key matches the query on
   * screen. Omit for the full-page editor (it reads the overlay for a drafts
   * collection); an embedded editor reading the live row passes `false`.
   */
  readDraft?: boolean;
  /** Called when the user switches the active content language (i18n M7). */
  onLocaleChange?: (locale: string, options?: { seedFrom?: string }) => void;
  /**
   * Default-language field values (i18n M7). Provided while translating a non-default language
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
 * - **Auto-save to localStorage** - debounced saves with visual indicator (standalone only)
 * - **Draft recovery** - offers to recover unsaved changes on page revisit
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
}: EntryFormProps) {
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
    handleSubmit,
    handleDelete,
    handleDiscardWorkingDraft,
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

  // i18n M7: content-locale context for field components — the active locale's writing
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
    translation,
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
  /*
   * Delegated whole, including the decision to answer NULL when there is
   * nothing to draw — which is what withholds the panel rather than opening an
   * empty one. Kept out of this callback so the rule is reachable by a test
   * without standing up the entire form.
   */
  const renderEntryFields = useCallback(
    (excludePath: string) =>
      fieldsBesidePanel(allFields, excludePath, {
        disabled: isSubmitting,
        mode,
      }),
    [allFields, isSubmitting, mode]
  );

  // Get form errors and submit attempt count. submitCount gates the
  // top-level "Please fix the following errors" toast in FormErrorSummary
  // so it only appears after the user actually clicks Save / Publish, not
  // when a field-level revalidation runs after that first attempt.
  const { errors, submitCount } = form.formState;

  // Rail collapse state. Toggle lives in EntrySystemHeader; the rail itself
  // reads `railCollapsed` to decide whether to render. Persisted in
  // localStorage so the choice survives reloads.
  const { collapsed: railCollapsed, toggle: toggleRail } = useRailCollapsed();
  // Which past version the document area is showing, or null for the live
  // document. Held here because this is the component that swaps the document,
  // and published downward because the panel that chooses it is mounted from
  // the header, several levels below.
  const [viewingVersion, setViewingVersion] = useState<ViewedVersion | null>(
    null
  );
  // Published by the history panel while it is mounted, so the banner can
  // offer restoring without a second copy of the permission or the mutation.
  const [restoreAffordance, setRestoreAffordance] =
    useState<RestoreAffordance | null>(null);
  const documentHistory = useMemo(
    () => ({
      viewing: viewingVersion,
      setViewing: setViewingVersion,
      restore: restoreAffordance,
      setRestore: setRestoreAffordance,
    }),
    [viewingVersion, restoreAffordance]
  );

  // One question — is the chosen version actually on screen? — answered once,
  // because the document body and the restore affordance must never disagree
  // about it. A read that has not returned leaves `isLoading` false with no
  // error and no snapshot: the query is disabled whenever the scope is not yet
  // addressable, and a paused one reports the same. Deciding from `isLoading`
  // alone would render an empty document as though it were the version, and
  // offer to restore what nobody has seen.
  const versionOnScreen =
    viewingVersion !== null &&
    viewingVersion.error === null &&
    !viewingVersion.isLoading &&
    viewingVersion.snapshot !== undefined;

  // Which fields a version HAD, decided by that version's own values. The
  // takeover layout is value-driven, so computing it from the live entry would
  // show today's layout over yesterday's document — omitting fields the version
  // stored, or offering fields it never had.
  const historicalFields = useMemo(() => {
    if (!viewingVersion) return null;
    return computeMainFields(allFields, {
      takeoverTypes,
      values: snapshotToFormValues(allFields, viewingVersion.snapshot),
    });
  }, [viewingVersion, allFields, takeoverTypes]);

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

  useAutoSlug({
    form,
    titleFieldName: titleField?.name ?? "title",
    slugFieldName: slugField?.name ?? "slug",
    enabled: !!titleField && !!slugField,
    frozen: hasPublicAddress,
  });

  // ---------------------------------------------------------------------------
  // Keyboard Shortcuts (standalone mode only)
  // ---------------------------------------------------------------------------

  // Route Cmd/Ctrl+S to the same intent the primary Save button uses for this
  // document's state, so a keyboard save and a button save behave identically:
  // on a drafts collection a published entry stores a working draft
  // (status-less), on a non-drafts collection it re-asserts published, and any
  // other editing state saves a draft. Create mode and non-status collections
  // keep the intent-less single-Save behavior.
  const keyboardSaveIntent = resolveDefaultSaveIntent({
    mode,
    hasStatus,
    // The ACTIVE locale's status, not the main row's — the same effective status
    // the header's submit buttons use, so a keyboard save and a button save agree.
    effectiveStatus: effectiveEntryStatus(entry, locale, defaultLocale),
    draftsEnabled: collection.draftsEnabled === true,
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
  const autosaveScope = useMemo(
    () => autosaveScopeFor("collection", collection.name, savedEntryId),
    [savedEntryId, collection.name]
  );
  // The other half of recording: offer the work back when the editor opens, and
  // write it into this form when the author accepts.
  const recovery = useAutosaveRecovery({
    scope: autosaveScope,
    form,
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
     * state that never existed.
     *
     * And held off while a PAST VERSION is on screen, which is the sharper
     * case. Choosing a version replaces the form's values, so the form goes
     * dirty exactly as it would for typing — and recording that stores an old
     * version as this author's unsaved work. The offer on the next visit then
     * reads "you have unsaved changes", and accepting it silently reverts the
     * document to whatever the reader happened to be looking at. Reading is not
     * editing, and the write is the only part of that which is recoverable.
     */
    enabled: !isSubmitting && viewingVersion === null,
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
  const previewLink = usePreviewLink({
    collection: collection.name,
    entryId: savedEntryId,
    ...(linkLocale.kind === "scoped" ? { locale: linkLocale.locale } : {}),
  });

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

  const canPreview =
    entryPreview.isPreviewAvailable &&
    savedEntryId !== "" &&
    linkLocale.kind !== "unresolved";

  // Only enable shortcuts in standalone mode (not embedded modals)
  useEntryFormShortcuts({
    onSave: () => {
      void handleSubmit(undefined, keyboardSaveIntent);
    },
    onCancel: handleCancel,
    // Includes work a field holds. Without it the save shortcut DECLINES inside
    // the page builder — correctly, on a flag that cannot be true there — which
    // reads to an author as the shortcut being broken.
    isDirty: hasUnsavedWork,
    isSubmitting,
    enabled: !embedded,
  });

  // Embedded mode: simplified single-column layout for modals
  // Note: Preview is typically not shown in embedded mode (modals)
  if (embedded) {
    return (
      <EntryFormContextProvider
        kind="collection"
        entryId={entry?.id}
        collectionSlug={collection.name}
        isCreateMode={mode === "create"}
        // The ACTIVE language's state, matching the meta strip beside it: a
        // field that covers the editor's chrome has to report the same thing
        // the chrome would have. Omitted while creating, where nothing is
        // persisted yet and a guessed "draft" would be a claim nobody made.
        {...(mode === "create"
          ? {}
          : {
              documentStatus: {
                status:
                  effectiveEntryStatus(entry, locale, defaultLocale) ?? "draft",
                hasWorkingDraft: hasPendingWorkingDraft(entry),
              },
            })}
      >
        <EntryFormProvider
          form={form}
          onSubmit={handleSubmit}
          className={className}
        >
          <div className="space-y-6">
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
              mode={mode}
            />
            <EntryFormActions
              mode={mode}
              isSubmitting={isSubmitting}
              onCancel={handleCancel}
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
              open={previewOpen && translationMode.source === undefined}
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
                  // Only where a takeover can happen. The embedded branch renders
                  // the whole body in a modal and hides nothing, so a panel there
                  // would offer a second copy of fields already on screen.
                  renderEntryFields={renderEntryFields}
                >
                  <div className={cn("space-y-0", className)}>
                    <EntryFormProvider form={form} onSubmit={handleSubmit}>
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
                              titleField={titleField}
                              hasStatus={hasStatus}
                              draftsEnabled={collection.draftsEnabled === true}
                              isSubmitting={isSubmitting}
                              isDirty={isDirty}
                              autosaveEnabled={autosaveScope !== null}
                              autosaveStatus={autosave.status}
                              autosaveLastSavedAt={autosave.lastSavedAt}
                              entry={entry}
                              collectionSlug={collection.name}
                              historyFields={getCollectionFields(collection)}
                              historyEnabled={historyEnabledFrom(collection)}
                              locale={locale}
                              localized={collection.localized === true}
                              isPreviewAvailable={canPreview}
                              {...(entryPreview.declaredLabel === undefined
                                ? {}
                                : { previewLabel: entryPreview.declaredLabel })}
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
                                savedEntryId !== "" &&
                                linkLocale.kind !== "unresolved"
                              }
                              {...(savedEntryId === ""
                                ? {}
                                : {
                                    onCopyLink: () => {
                                      previewLink.mutate();
                                    },
                                  })}
                              isCopyingLink={previewLink.isPending}
                              toolbarSlot={
                                <EntryFormToolbarSlots
                                  context="collection"
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
                              onSaveWorkingDraft={() => {
                                void handleSubmit(
                                  undefined,
                                  "save-working-draft"
                                );
                              }}
                              onUnpublish={() => {
                                void handleSubmit(undefined, "unpublish");
                              }}
                              onCancel={handleCancel}
                              onDelete={handleDelete}
                              onDiscardWorkingDraft={handleDiscardWorkingDraft}
                              isRailCollapsed={railCollapsed}
                              onToggleRail={
                                mode === "edit" ? toggleRail : undefined
                              }
                            />
                            {/* Above the fields and below the header: the reader sees
                      the document it refers to without the offer covering it. */}
                            {recovery.offer ? (
                              <AutosaveRecoveryBanner
                                savedAt={recovery.offer.savedAt}
                                onRestore={recovery.restore}
                                onDismiss={recovery.dismiss}
                              />
                            ) : null}
                            {viewingVersion ? (
                              <HistoricalDocumentBanner
                                versionNo={viewingVersion.versionNo}
                                locale={viewingVersion.locale}
                                // Routed through the panel when one is mounted, so its
                                // selection clears with the shared state. The direct
                                // fallback keeps the banner working without a panel.
                                onReturnToCurrent={
                                  restoreAffordance?.returnToCurrent ??
                                  (() => setViewingVersion(null))
                                }
                                // Offered only when the panel says this caller may write.
                                onRestore={
                                  restoreAffordance?.canRestore
                                    ? restoreAffordance.request
                                    : undefined
                                }
                                // And only once the version is actually on screen:
                                // restoring from a skeleton, or from a failed read, is a
                                // decision made without having seen what is being chosen.
                                restoreDisabled={!versionOnScreen}
                              />
                            ) : null}
                            <EntryMetaStrip
                              slugField={slugField}
                              hasStatus={hasStatus}
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
                              hasWorkingDraft={hasPendingWorkingDraft(entry)}
                              isRailCollapsed={railCollapsed}
                              hasPublicAddress={hasPublicAddress}
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
                                <LanguagePanel
                                  {...(entry?._translations === undefined
                                    ? {}
                                    : {
                                        translations:
                                          entry._translations as Record<
                                            string,
                                            {
                                              translated: boolean;
                                              status?: string;
                                            }
                                          >,
                                      })}
                                  {...(locale === undefined
                                    ? {}
                                    : { activeLocale: locale })}
                                  {...(onLocaleChange === undefined
                                    ? {}
                                    : { onSelect: onLocaleChange })}
                                  hasStatus={hasStatus}
                                  actionsDisabled={viewingVersion !== null}
                                />
                              </div>
                            )}

                            {/* Reading a past version replaces the document rather than
                      opening beside it: the question an editor is asking is how
                      this page read then, and that is answered by the page. The
                      live form stays mounted underneath — the historical values
                      are rendered against a form of their own, so nothing typed
                      here is disturbed and nothing historical can reach a save. */}
                            {viewingVersion ? (
                              <div className="@4xl/content:p-8 pt-6">
                                {viewingVersion.error ? (
                                  // A failed read must not render as an empty document:
                                  // that is a different and wrong claim about the version.
                                  <Alert variant="destructive">
                                    <AlertDescription>
                                      This version could not be loaded.
                                    </AlertDescription>
                                  </Alert>
                                ) : !versionOnScreen ? (
                                  <div
                                    className="flex flex-col gap-4"
                                    aria-busy="true"
                                  >
                                    <span className="sr-only" role="status">
                                      Loading version {viewingVersion.versionNo}
                                    </span>
                                    {[0, 1, 2, 3].map(i => (
                                      <div
                                        key={i}
                                        className="flex flex-col gap-1"
                                      >
                                        <Skeleton className="h-3 w-24" />
                                        <Skeleton className="h-9 w-full" />
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <VersionSnapshotForm
                                    fields={historicalFields ?? mainFields}
                                    snapshot={viewingVersion.snapshot}
                                  />
                                )}
                              </div>
                            ) : (
                              mainFields.length > 0 && (
                                <div className="@4xl/content:p-8 pt-6">
                                  {/* Forward the form mode: in edit mode a blank password
                        field means "keep the current password" rather than a
                        required-field violation (see note on the layout form
                        above). */}
                                  <EntryFormContent
                                    fields={mainFields}
                                    disabled={isSubmitting}
                                    withCard
                                    mode={mode}
                                  />
                                </div>
                              )
                            )}
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
                                  {...(locale === undefined ? {} : { locale })}
                                  {...(onLocaleChange === undefined
                                    ? {}
                                    : { onLocaleChange })}
                                  actionsDisabled={viewingVersion !== null}
                                  isDirty={isDirty}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </CopyFromLanguageScope>
                    </EntryFormProvider>
                  </div>
                </EntryFormContextProvider>
              </TranslationPanes>
            </PreviewPanes>
          </DocumentHistoryContext.Provider>
        </EntryLocaleProvider>
      </UnsavedWorkProvider>
    </UnsavedChangesGuard>
  );
}
