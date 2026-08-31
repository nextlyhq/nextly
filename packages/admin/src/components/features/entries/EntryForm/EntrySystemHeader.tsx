"use client";

import { Button } from "@nextlyhq/ui";
import { isFieldLocalized, type FieldConfig } from "nextly/config";
import { useEffect, useRef, useState } from "react";
import { useFormContext } from "react-hook-form";

import { useDocumentHistory } from "@admin/components/features/versions/document-history-context";
import { VersionHistorySheet } from "@admin/components/features/versions/VersionHistorySheet";
import {
  Globe,
  History,
  PanelRight,
  PanelRightClose,
} from "@admin/components/icons";
import { useCan } from "@admin/hooks/useCan";
import type { AutosaveStatus } from "@admin/hooks/useDocumentAutosave";
import { useLocalization } from "@admin/hooks/useLocalization";
import { cn } from "@admin/lib/utils";

import { useEntryLocale } from "../EntryLocaleContext";
import { translationCounts } from "../translation-meta";

import { AutoSaveIndicator } from "./AutoSaveIndicator";
import { DiscardDraftConfirmDialog } from "./DiscardDraftConfirmDialog";
import { documentActions } from "./document-actions";
import { DocumentActionBar, type ActionBinding } from "./DocumentActionBar";
import { DocumentStatusLive } from "./DocumentStatusLive";
import { effectiveEntryStatus } from "./entry-address";
import { EntryTitleInput } from "./EntryTitleInput";
import { PreviewActions } from "./PreviewActions";
import { TOOLBAR_CONTAINER, ToolbarLabel } from "./toolbar-density";
import { UnpublishConfirmDialog } from "./UnpublishConfirmDialog";
import { useLeaveWithoutWarning } from "./UnsavedChangesGuard";
import type { EntryData, EntryFormMode } from "./useEntryForm";

// into one component. The title input lives in the action-bar row (autofocus
// on create, blinking caret), the dropdown is a single consolidated menu
// (Discard / Duplicate / Show JSON / View API / Delete), and the rail
// toggle is right-aligned. Status pill moves to the meta strip (when rail
// collapsed) and the Document panel (when rail expanded), so the system
// header itself has no status affordance.

export interface EntrySystemHeaderProps {
  /** Form mode — determines button labels (Create/Publish vs Save/Update) and
   *  whether the More menu shows edit-only items (Duplicate, Show JSON, etc). */
  mode: EntryFormMode;
  /** Title field config (from Builder schema). Determines the placeholder
   *  fallback and the required-validation flag. */
  titleField?: FieldConfig;
  /** Whether the collection has the Draft/Published feature enabled.
   *  Splits the primary submit into Save Draft + Publish/Update. */
  hasStatus: boolean;
  /** Whether the working-draft split is enabled (drafts on a versioned
   *  collection). When `true`, editing a PUBLISHED entry saves a pending
   *  working draft (live row untouched) instead of re-publishing, and a
   *  separate Publish promotes it. */
  draftsEnabled?: boolean;
  /** Whether the form is currently submitting. Disables buttons + spinner. */
  isSubmitting?: boolean;
  /** Whether the form has validation errors. Disables submit. */
  isInvalid?: boolean;
  /** Whether the form has unsaved changes. Toggles Discard menu item. */
  isDirty?: boolean;
  /**
   * Whether recording is possible for this document at all. False for an entry
   * that has never been saved, which has no id for the endpoint to address.
   */
  autosaveEnabled?: boolean;
  /** Recording state of this author's recovery point. */
  autosaveStatus?: AutosaveStatus;
  /** When the server last stored a recovery point, by the server's clock. */
  autosaveLastSavedAt?: Date | null;
  /** Form id for the single submit button when drafts are off. */
  /** Entry data; needed for Show JSON dialog (entry id) and Duplicate (id). */
  entry?: EntryData | null;
  /** Collection slug for the Show JSON dialog. */
  collectionSlug: string;
  /** Active content locale (i18n M7). Shown/selected in the language switcher. */
  locale?: string;
  /** Called when the user switches the active content language (i18n M7). When omitted, the
   *  language switcher is not rendered. */
  /** Whether the entity is localized. Forwarded to the version-history panel as
   *  the authoritative signal for its locale filter (shared writes can produce
   *  null-locale versions, so the rows alone are not conclusive). */
  localized?: boolean;

  /* Preview. Two independent actions rendered by one control — see
     `PreviewActions`, which decides its own shape from which of them are
     available and renders nothing when neither is. They are separate props
     rather than one `preview` object because they are answered by different
     things: whether a URL can be built for this entry, and whether this author
     may hand out a grant to read it. A caller that can answer one and not the
     other passes one and not the other. */

  /** Whether a preview URL can be built for this entry. */
  isPreviewAvailable?: boolean;
  /** Opens the preview using the editor's own session. May be asynchronous. */
  onPreview?: () => void | Promise<void>;
  /**
   * What this entry's preview is called, where it is not called "Preview".
   *
   * Names BOTH controls below — the open-in-a-tab action and the pane toggle —
   * because they are one thing to an author, and a second prop for the second
   * control is a second thing to keep in step. Absent rather than defaulted, so
   * each control can apply the default its own sentence needs: "Preview" as a
   * button's name, "preview" as a noun inside "Show preview".
   */
  previewLabel?: string;
  /**
   * Opens and closes the preview PANE, which is a different action from opening
   * the preview in a tab.
   *
   * Two controls rather than one with a mode, because they answer different
   * questions: a tab is for looking at the page on its own — on a phone, on a
   * second monitor, to send to someone standing beside you — and the pane is
   * for watching it while you edit. A single control would have to guess which,
   * and the wrong guess costs a page load and the editor's place on screen.
   *
   * Absent means the surface offers no pane at all, which is what an embedded
   * editor in a modal does.
   */
  onTogglePreviewPane?: () => void;
  /** Whether that pane is currently open, for the control's pressed state. */
  previewPaneOpen?: boolean;
  /**
   * Whether there is a saved document for a link to name.
   *
   * Deliberately NOT ANDed with `update-{slug}` here. The mint endpoint
   * authorizes the request against the collection's real access rules, and
   * `update` can be granted by a code-first `access.update` rule that the flat
   * permission list does not carry — so a client-side check on that list is a
   * false negative for exactly the arrangement it would claim to protect,
   * hiding the link from an author who can edit the document. This is the same
   * reasoning the Discard Draft affordance below is built on, and the sibling
   * Save controls are not gated on it either.
   */
  isLinkAvailable?: boolean;
  /** Mints a shareable link and copies it. */
  onCopyLink?: () => void;
  /** Whether a link is being minted right now. */
  isCopyingLink?: boolean;

  /** Save Draft handler — routed through useEntryForm.handleSubmit('save-draft').
   *  Used in create mode and when editing a draft entry. */
  onSaveDraft?: () => void;
  /** Publish handler — routed through useEntryForm.handleSubmit('publish').
   *  Used in create mode and when promoting a draft to published. */
  onPublish?: () => void;
  /** Save changes handler — routed through useEntryForm.handleSubmit('save-changes').
   *  Used when editing a published entry on a NON-drafts collection; submits
   *  dirty fields with status="published" so the lifecycle stays the same. */
  onSaveChanges?: () => void;
  /** Save working draft handler — routed through
   *  useEntryForm.handleSubmit('save-working-draft'). Used when editing a
   *  published entry on a drafts-enabled collection: stores a pending working
   *  draft (status-less) instead of writing the live row. */
  onSaveWorkingDraft?: () => void;
  /** Unpublish handler — routed through useEntryForm.handleSubmit('unpublish').
   *  Fires only after the user confirms the modal. Sends `{ status: "draft" }`
   *  with no other field changes (matches Payload's Unpublish pattern). */
  onUnpublish?: () => void;
  /** Discard-working-draft handler (draft/published split). Throws away the
   *  pending working draft and reverts the editor to the live published row.
   *  Shown as a confirmed menu action for a Changed document. */
  onDiscardWorkingDraft?: () => void | Promise<void>;
  /** Discard / Cancel handler. */
  onCancel?: () => void;
  /** Delete handler (edit mode only). */
  onDelete?: () => void;
  /** Duplicate handler (edit mode only). When provided, the menu item is
   *  enabled; otherwise hidden. */
  onDuplicate?: () => void;
  /** View API response handler — opens a modal styled like Show JSON. */
  onViewApi?: () => void;

  /**
   * Resource scope passed through to the Show JSON dialog and used by the
   * `View API response` URL display. Determines whether the dialog hits
   * `/api/collections/{slug}/entries/{id}` or `/api/singles/{slug}`.
   *
   * @default "collection"
   */
  scope?: "collection" | "single";

  /**
   * When true (Singles), the title is fixed by the single's config: render the
   * title input read-only and drop its required validation. Defaults to false
   * so collection entry forms keep the editable, optionally-required title.
   */
  lockIdentity?: boolean;

  /** Rail collapsed state. */
  isRailCollapsed?: boolean;
  /** Rail toggle handler. */
  onToggleRail?: () => void;
  /**
   * Plugin-contributed toolbar controls, rendered at the start of the action
   * cluster (left of Save/Publish). Kept as an opaque node so the header stays
   * plugin-agnostic — the caller builds it from `entryFormToolbarSlot`.
   */
  toolbarSlot?: React.ReactNode;

  /**
   * Current schema fields, used to render a stored version in the history
   * panel. Absent means the caller cannot show history, so the control hides.
   */
  historyFields?: FieldConfig[];

  /**
   * Whether this entity captures versions. Only writes on a versioning-enabled
   * entity record a snapshot, so offering history elsewhere leads to a panel
   * that can never fill. Undefined means the caller could not determine it, in
   * which case the control is still offered and the panel reports honestly.
   */
  historyEnabled?: boolean;
}

export function EntrySystemHeader({
  mode,
  titleField,
  hasStatus,
  draftsEnabled = false,
  isSubmitting = false,
  isInvalid = false,
  isDirty = false,
  autosaveEnabled = false,
  autosaveStatus = "idle",
  autosaveLastSavedAt = null,
  entry,
  collectionSlug,
  locale,
  onSaveDraft,
  onPublish,
  onSaveChanges,
  onSaveWorkingDraft,
  onUnpublish,
  onDiscardWorkingDraft,
  onCancel,
  onDelete,
  onDuplicate,
  onViewApi,
  scope = "collection",
  historyFields,
  historyEnabled,
  lockIdentity = false,
  isRailCollapsed = false,
  onToggleRail,
  toolbarSlot,
  localized,
  isPreviewAvailable = false,
  onPreview,
  previewLabel,
  onTogglePreviewPane,
  previewPaneOpen = false,
  isLinkAvailable = false,
  onCopyLink,
  isCopyingLink = false,
}: EntrySystemHeaderProps) {
  const form = useFormContext();
  const entryLocale = useEntryLocale();
  // The default language is edited with `locale === undefined`, and its status
  // can live on the companion, so resolve it to read the right lifecycle.
  const {
    enabled: localizationEnabled,
    defaultLocale,
    locales,
    getLocale,
  } = useLocalization();
  const defaultLocaleLabel = getLocale(defaultLocale)?.label ?? defaultLocale;
  /*
   * A declared label is used VERBATIM, not built into a sentence.
   *
   * `previewLabel` is a complete button label, not a noun: collections
   * legitimately name one "View page", and "Show View page" is not English.
   * Where the author supplied nothing there is no such risk and the control
   * keeps its own wording, which says what the click will do.
   *
   * Losing "Show"/"Hide" for a declared label costs nothing that is not carried
   * elsewhere — `aria-pressed` states it for assistive technology and the
   * variant states it visually, which is how a toggle button reports itself.
   */
  const previewToggleLabel =
    previewLabel ?? (previewPaneOpen ? "Hide preview" : "Show preview");
  const previewToggleTitle =
    previewLabel ?? (previewPaneOpen ? "Hide the preview" : "Show the preview");
  // Present only when the entry was fetched with `?translation-status=1` on a
  // localized collection; undefined otherwise, which both consumers below
  // treat as "nothing to report" rather than as zero progress.
  const entryTranslations = entry?._translations as
    | Record<string, { translated: boolean; status?: string }>
    | undefined;
  // Derived once and handed to both the visible instrument and the spoken
  // region, so the two can never disagree about how far along the document is.
  const counts = translationCounts(
    entryTranslations,
    locales.map(l => l.code),
    defaultLocale
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const [unpublishOpen, setUnpublishOpen] = useState(false);
  const [discardDraftOpen, setDiscardDraftOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // True while the document area is showing a past version rather than the
  // live document.
  const { viewing: viewingVersion } = useDocumentHistory();
  const isReadingHistory = viewingVersion !== null;

  // Both collections and singles authorize a document write as `update-{slug}`.
  // Read here, inside the guard this header renders under, so a deliberate
  // discard can say so before it navigates.
  const leaveWithoutWarning = useLeaveWithoutWarning();
  const canUpdateDocument = useCan(`update-${collectionSlug}`);

  // Publishing is its own permission, distinct from editing. Without it the
  // Publish affordance is hidden — matching the server, which refuses a write
  // that moves a document into `published` from a caller lacking it. An author
  // keeps Save Draft and stops there. Unpublish is gated separately, since
  // taking content down is a different responsibility from putting it up.
  const canPublishDocument = useCan(`publish-${collectionSlug}`);
  const canUnpublishDocument = useCan(`unpublish-${collectionSlug}`);

  // Why: autofocus the title input on create so the cursor blinks ready for
  // typing. Skip in edit mode — focusing a populated title interrupts the
  // user's reading flow.
  useEffect(() => {
    if (mode === "create") {
      inputRef.current?.focus();
    }
  }, [mode]);

  if (!form) {
    return null;
  }

  const titleName =
    titleField && "name" in titleField ? (titleField.name as string) : "title";
  const titleRequired =
    (titleField as { required?: boolean } | undefined)?.required === true;
  const titleLabel =
    (titleField as { label?: string } | undefined)?.label ?? "Title";

  // the title input bypasses FieldWrapper, so apply the same per-field RTL rule here —
  // flip to RTL only when the title is a translatable field AND the active locale is RTL (a
  // shared/LTR title stays LTR). Uses the same classifier as FieldWrapper for consistency.
  const titleRtl =
    entryLocale.rtl &&
    !!titleField &&
    isFieldLocalized(
      {
        type: (titleField as { type?: string }).type ?? "text",
        name: titleName,
        localized: (titleField as { localized?: boolean }).localized,
      },
      entryLocale.collectionLocalized
    );

  const showEditMenuItems = mode === "edit" && entry?.id;

  // - hasStatus + create or hasStatus+edit+draft → Save Draft + Publish
  //   (the user is working on something not yet live).
  // - hasStatus + edit + published → Save changes + Unpublish (the user
  //   is editing live content). Save changes is disabled when there are
  //   no dirty edits — there's nothing to save in that state, so the
  //   button greys out and Unpublish becomes the only enabled action.
  // - !hasStatus → single Save button (collections without drafts).
  // On a localized draft collection each language has its own lifecycle, so the
  // active locale's status — not the main/default row's — decides which submit
  // affordances to show. Shared with the slug freeze and the public-URL notice,
  // which ask the same question and must not answer it differently.
  const effectiveStatus = effectiveEntryStatus(entry, locale, defaultLocale);
  const isPublishedEditState =
    mode === "edit" && effectiveStatus === "published";
  // A drafts-enabled published entry that has a pending working draft: the
  // server flags the overlay read with `_isWorkingDraft`. This is Payload's
  // "Changed" state — Publish promotes it and the status pill reflects it.
  const hasWorkingDraft =
    draftsEnabled &&
    (entry as { _isWorkingDraft?: boolean } | null | undefined)
      ?._isWorkingDraft === true;
  // The "Discard draft" revert is offered for a Changed document (a pending
  // working draft over a published row). The server authorizes it as an update,
  // and the working-draft split is code-first only, so update can be granted by a
  // collection `access.update` rule that the flat `update-{slug}` permission does
  // not list. Gating on that permission here would hide Discard from an editor who
  // can create and keep saving the very draft this reverts, so it is not gated on
  // it — the sibling Save affordances are not either, and the endpoint refuses if
  // the caller truly may not update.
  const showDiscardDraft = hasWorkingDraft && !!onDiscardWorkingDraft;
  /*
   * What an author may do to this document, and what each verb runs.
   *
   * The two are separate on purpose. `documentVerbs` is about permissions and
   * document state and is decided in a module with no React in it, so every
   * combination is testable without rendering a header. The BINDINGS below are
   * about this form at this instant — mid-submit, invalid, nothing changed —
   * which only the form knows, and about which handler a verb runs, which only
   * the host knows.
   */
  const documentVerbs = documentActions({
    mode,
    hasStatus,
    draftsEnabled: draftsEnabled === true,
    status: effectiveStatus === "published" ? "published" : "draft",
    hasWorkingDraft: hasWorkingDraft === true,
    readingHistory: isReadingHistory,
    canPublish: canPublishDocument,
    canUnpublish: canUnpublishDocument,
    canDelete: onDelete !== undefined,
    isDirty: isDirty === true,
    canDuplicate: onDuplicate !== undefined,
  });

  /*
   * Saving means three different calls depending on where the work lands, which
   * is a fact about this host rather than about the document: a drafts-enabled
   * published entry stores a working draft and leaves the live one alone, a
   * drafts-disabled one re-asserts published, and anything else writes a draft.
   * The model deliberately does not know this — it names ONE verb, `save`, and
   * the label already says which of the three an author is about to get.
   */
  const runSave =
    isPublishedEditState && draftsEnabled
      ? onSaveWorkingDraft
      : isPublishedEditState
        ? onSaveChanges
        : onSaveDraft;

  /**
   * Why a verb cannot run at this instant, or undefined when it can.
   *
   * Separate from the model's own reasons, which are about permission and
   * document state. A save is additionally refused while a submit is in flight,
   * while the form is invalid, and — on a published document — while nothing has
   * changed, which is the existing behaviour kept rather than re-decided.
   */
  const busyReason = isSubmitting ? "Saving…" : undefined;
  const invalidReason = isInvalid
    ? "Fix the errors on this page first."
    : undefined;
  const saveReason =
    busyReason ??
    invalidReason ??
    (isPublishedEditState && isDirty !== true
      ? "Nothing has changed yet."
      : undefined);

  const actionBindings: Record<string, ActionBinding | undefined> = {
    ...(runSave === undefined
      ? {}
      : { save: { onSelect: runSave, disabledReason: saveReason } }),
    ...(onPublish === undefined
      ? {}
      : {
          publish: {
            onSelect: onPublish,
            disabledReason: busyReason ?? invalidReason,
          },
        }),
    ...(onDuplicate === undefined
      ? {}
      : { duplicate: { onSelect: onDuplicate, disabledReason: busyReason } }),
    ...(onViewApi === undefined ? {} : { "view-api": { onSelect: onViewApi } }),
    ...(showDiscardDraft
      ? {
          "discard-draft": {
            onSelect: () => setDiscardDraftOpen(true),
            disabledReason: busyReason,
          },
        }
      : {}),
    ...(onCancel === undefined
      ? {}
      : {
          "discard-changes": {
            // Says so before leaving: this action IS the answer to the
            // unsaved-changes question, so being asked it again reads as a
            // warning rather than as the confirmation just given.
            onSelect: () => {
              leaveWithoutWarning();
              onCancel();
            },
            disabledReason: busyReason,
          },
        }),
    ...(onUnpublish === undefined
      ? {}
      : {
          unpublish: {
            onSelect: () => setUnpublishOpen(true),
            disabledReason: busyReason,
          },
        }),
    ...(onDelete === undefined
      ? {}
      : { delete: { onSelect: onDelete, disabledReason: busyReason } }),
  };

  const entryLabel =
    typeof entry?.title === "string" && entry.title.trim().length > 0
      ? entry.title
      : ((entry?.slug as string | undefined) ?? null);

  return (
    <div
      className={cn(
        TOOLBAR_CONTAINER,
        "sticky top-0 z-30 bg-background border-b border-border"
      )}
    >
      {/* The row WRAPS on a phone rather than overflowing. Even with every label
        collapsed the cluster needs about 370px, which does not fit beside a
        title on a 390px screen — so below that the title takes its own line and
        the actions sit beneath it, which is what vertical space is for.

        The container declaration sits on the PARENT because an element cannot
        query its own width, and this row now responds to that width itself. */}
      <div
        className={cn(
          "px-6 py-3 flex items-center gap-3",
          "@max-lg/toolbar:flex-wrap @max-lg/toolbar:gap-y-2"
        )}
      >
        {/* Title input — borderless, 19px, autofocus on create.

          The floor is the point: as a bare `flex-1 min-w-0` beside a cluster
          that never shrank, the title was whatever was left over, and at common
          window widths that was nothing. It now keeps a readable minimum and the
          actions collapse around it (see `toolbar-density`). */}
        <div className="flex-1 min-w-[10rem] @max-lg/toolbar:basis-full">
          {/* The title is part of the document, so reading a past version
            locks it with everything else. Left editable it would mutate the
            LIVE document while the banner says the page cannot be edited — and
            go to autosave as unsaved work nobody typed on purpose. */}
          <EntryTitleInput
            name={titleName}
            control={form.control}
            label={titleLabel}
            required={titleRequired && !isReadingHistory}
            locked={lockIdentity || isReadingHistory}
            submitting={isSubmitting}
            rtl={titleRtl}
            inputRef={(el: HTMLInputElement | null) => {
              inputRef.current = el;
            }}
          />
        </div>

        {/* Action cluster — right-aligned */}
        {/* Wraps on a phone for the same reason the row does: with every label
          already collapsed the controls still need more width than the screen
          has, and a cluster that cannot wrap pushes them off the edge instead.

          `basis-full` is what makes the wrap real. Sized to its content the
          cluster is always exactly as wide as its widest possible line, so
          `flex-wrap` alone had nothing to wrap against; taking the whole line
          first gives it a width to break inside. Right-aligned so the wrapped
          controls still read as one group. */}
        <div
          className={cn(
            "flex items-center gap-1.5 shrink-0",
            "@max-lg/toolbar:basis-full @max-lg/toolbar:min-w-0",
            "@max-lg/toolbar:flex-wrap @max-lg/toolbar:justify-end @max-lg/toolbar:gap-y-2"
          )}
        >
          {toolbarSlot}
          {/* A document only has history once it has been saved, and rendering a
            snapshot needs the schema, so both are required to offer this. */}
          {showEditMenuItems && historyFields && historyEnabled !== false ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="px-2"
              aria-label="Version history"
              title="Version history"
              onClick={() => setHistoryOpen(true)}
            >
              <History className="h-4 w-4" />
            </Button>
          ) : null}
          {/* Directly left of the submit cluster, which is where an author looks
            for it: checking how something reads is part of deciding to publish
            it, not a document-management action like Duplicate or Delete. The
            `sm` size is the band's, so it lines up with Save beside it rather
            than standing a few pixels taller.

            `disabled` follows the submit buttons rather than the whole form:
            minting a link and opening a preview both act on what is already
            saved, so a submit in flight is a race with them and not merely a
            busy form. */}
          <PreviewActions
            size="sm"
            isPreviewAvailable={isPreviewAvailable}
            {...(onPreview === undefined ? {} : { onPreview })}
            {...(previewLabel === undefined ? {} : { previewLabel })}
            isLinkAvailable={isLinkAvailable}
            {...(onCopyLink === undefined ? {} : { onCopyLink })}
            isCopyingLink={isCopyingLink}
            disabled={isSubmitting}
          />
          {/* The pane toggle, beside the preview actions rather than inside
              them: `PreviewActions` decides its own shape from which of OPEN
              and COPY are available, and a third action would make that a
              three-way decision for a control whose whole design is that it
              collapses to one button when only one thing can be done.

              Offered only where a pane exists to open — an embedded editor in
              a modal passes no handler and gets no control. */}
          {onTogglePreviewPane !== undefined && (
            <Button
              type="button"
              variant={previewPaneOpen ? "secondary" : "ghost"}
              size="sm"
              onClick={onTogglePreviewPane}
              disabled={isSubmitting}
              aria-pressed={previewPaneOpen}
              title={previewToggleTitle}
            >
              <PanelRight className="h-4 w-4" aria-hidden="true" />
              <ToolbarLabel priority="secondary">
                {previewToggleLabel}
              </ToolbarLabel>
            </Button>
          )}
          {/* Sits with the actions rather than beside the title: it reports on
            the same work the save buttons act on, and reads as status for that
            cluster.

            The condition is only whether recording is POSSIBLE, never whether
            there is anything to show. `AutoSaveIndicator` already returns null
            when it has no state to report, and restating that here suppressed
            its "Not saved" state for the whole debounce window: on the first
            edit to a saved entry the status is still idle and no recovery point
            exists yet, which is exactly when the reader most wants to be told
            their change is not stored. */}
          {autosaveEnabled ? (
            <AutoSaveIndicator
              lastSavedAt={autosaveLastSavedAt}
              isSaving={autosaveStatus === "saving"}
              isDirty={isDirty}
            />
          ) : null}
          {/* The spoken half of the same information. `AutoSaveIndicator` reports
            visually only — it carries no live region — so an author using a
            screen reader was never told whether their work had been stored.
            This is rendered unconditionally rather than beside the indicator's
            own condition, because a live region has to be PRESENT BEFORE the
            text it will announce changes: mounting a region and populating it
            in the same commit is not reliably announced. */}
          <DocumentStatusLive
            autosaveEnabled={autosaveEnabled}
            isSaving={autosaveStatus === "saving"}
            isDirty={isDirty}
            lastSavedAt={autosaveLastSavedAt}
            {...(entryTranslations === undefined
              ? {}
              : {
                  translatedCount: counts.translated,
                  localeCount: counts.total,
                })}
          />
          {/*
            Every document verb, drawn where the model said each belongs.

            One control leads and the rest are demoted, which the header could
            not express while each button decided its own placement in JSX: a
            published document with a pending draft drew Save, Publish and
            Unpublish at equal weight, and Unpublish sat one slip from Publish.

            No save affordances survive a historical view. They act on the live
            document, which is not what is being read — an editor offered "Save"
            over a past version has been invited to decide about something they
            cannot see. Restoring is offered instead, from the banner over the
            version itself. The model states that rule once, for every action,
            rather than each control testing `isReadingHistory` for itself.
          */}
          <DocumentActionBar
            actions={documentVerbs}
            bindings={actionBindings}
            pending={isSubmitting}
          />

          {/* Rail toggle — far right, separated by a thin divider */}
          {onToggleRail && (
            <>
              <span className="w-px h-5 bg-border mx-1" />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="px-2"
                onClick={onToggleRail}
                aria-label={isRailCollapsed ? "Show rail" : "Hide rail"}
                aria-pressed={isRailCollapsed}
              >
                {isRailCollapsed ? (
                  <PanelRightClose className="h-4 w-4" />
                ) : (
                  <PanelRight className="h-4 w-4" />
                )}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* The language row. Its own row rather than the action cluster: sharing
          one flex row starved the title input to zero width in a localized
          collection, since the cluster is shrink-0 and the strip is the widest
          thing in it. Rendered only when localization applies, so
          non-localized editors keep a single-row header.

          While a past version is on screen, switching language or running a
          language action would act on the live document under a banner saying
          the page cannot be edited — so both are withheld, and only there. */}
      {/* Create mode ONLY. A document that does not exist yet has no
          translations to report and no language to switch to, so the one thing
          worth saying is which language this first save will be in.

          Everything else this row used to carry — the language pills, the
          untranslated count and the language actions menu — is gone. The
          document rail's language panel says all three, and saying them twice
          in different words on one screen is what made the feature hard to
          read: the pills and the panel reported the SAME number from the same
          function, one as what was done and one as what was left. The pills
          could not be fixed in place either; past six languages they overflowed
          a clipped row, so a fourteen-language site could not reach eight of
          them at all. */}
      {localizationEnabled && mode === "create" && (
        <div className="flex flex-wrap items-center gap-3 border-t border-border px-6 py-2">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Globe className="h-3.5 w-3.5" aria-hidden="true" />
            Creating in {defaultLocaleLabel} — other languages can be added
            after the first save
          </span>
        </div>
      )}

      {/* Why: render the confirm modal at the component root so it's
          mounted regardless of which button matrix branch fired. The
          dialog itself controls open state via the prop; we close
          immediately on confirm and let the parent's mutation toast
          handle success/error feedback. Loading state is intentionally
          short-lived since unpublish is a single-field PATCH. */}
      <UnpublishConfirmDialog
        open={unpublishOpen}
        onOpenChange={setUnpublishOpen}
        entryLabel={entryLabel}
        onConfirm={() => {
          setUnpublishOpen(false);
          onUnpublish?.();
        }}
        isLoading={isSubmitting}
      />

      {/* Discarding a working draft deletes saved-but-unpublished edits, so it
          is confirmed like Unpublish. Mounted at the root for the same reason:
          it must survive whichever button-matrix branch rendered. */}
      <DiscardDraftConfirmDialog
        open={discardDraftOpen}
        onOpenChange={setDiscardDraftOpen}
        entryLabel={entryLabel}
        onConfirm={async () => {
          // Keep the dialog open (and its in-flight spinner visible) while the
          // discard runs, then close only once it SUCCEEDS. Closing first — as
          // this did — hid the progress state; closing on failure too would drop
          // the retry context. A rejection leaves the dialog open; its error was
          // already surfaced by the mutation's onError toast.
          try {
            await onDiscardWorkingDraft?.();
            setDiscardDraftOpen(false);
          } catch {
            // Stay open for a retry.
          }
        }}
        isLoading={isSubmitting}
      />

      {/* Mounted at the component root for the same reason as the dialog above:
          the panel must survive whichever button matrix branch rendered. */}
      {historyFields && entry?.id ? (
        <VersionHistorySheet
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          scope={
            scope === "single"
              ? {
                  kind: "single",
                  slug: collectionSlug,
                  documentId: String(entry.id),
                }
              : {
                  kind: "collection",
                  slug: collectionSlug,
                  entryId: String(entry.id),
                }
          }
          // Authoritative localized signal for the panel's locale filter.
          entityLocalized={localized}
          // Restore reuses the ordinary edit permission, so a caller who may
          // only read history is not offered a write that would be refused.
          canRestore={canUpdateDocument}
          // The live document's status, which is what a restore changes — the
          // selected version's own status describes the past.
          liveStatus={effectiveStatus}
        />
      ) : null}
    </div>
  );
}
