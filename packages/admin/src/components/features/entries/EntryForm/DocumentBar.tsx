"use client";

/**
 * The document bar: one sticky band across the top of the editor, field column
 * and panel alike, holding where the document stands and everything a person
 * acts on.
 *
 * At the left, what the document IS: its status in the language being edited,
 * its save state, and the language code when that language is not the default.
 * At the right, what can be DONE, in one order: a feature's toolbar controls,
 * History, Preview, the document's own verbs (Save draft, the primary action,
 * More), and the panel toggle at the far end.
 *
 * The title is not here. It is the first thing in the editor's column, under
 * the bar and its banners, so no action ever takes its width; and the way back
 * to the list is the top bar's trail, so the bar draws none of its own.
 *
 * The entry and Single editors both draw this, and differ only by what they
 * pass: one bar, one set of rules for when each control shows.
 *
 * @module components/features/entries/EntryForm/DocumentBar
 */

import { Button } from "@nextlyhq/ui";
import type { FieldConfig } from "nextly/config";
import type { JSX } from "react";
import { useState } from "react";
import { useFormContext } from "react-hook-form";

import { useHistoryAddress } from "@admin/components/features/versions/history-address";
import { useVersionActions } from "@admin/components/features/versions/version-actions";
import { VersionHistorySheet } from "@admin/components/features/versions/VersionHistorySheet";
import {
  Globe,
  History,
  PanelRight,
  PanelRightClose,
} from "@admin/components/icons";
import { useCan } from "@admin/hooks/useCan";
import { useCanRequest } from "@admin/hooks/useCanRequest";
import { useLocalization } from "@admin/hooks/useLocalization";
import { cn } from "@admin/lib/utils";
import type { PreviewLinkDocument } from "@admin/services/previewLinkApi";

import { useEntryLocale } from "../EntryLocaleContext";
import { SharePreviewPopover } from "../PreviewShare/SharePreviewPopover";
import { translationCounts } from "../translation-meta";

import { actionsAt } from "./document-actions";
import {
  DocumentActionBar,
  WIDE_ONLY,
  type NarrowMenuItem,
} from "./DocumentActionBar";
import { useHostedDocumentActions } from "./DocumentActionsContext";
import { DocumentStatusLive } from "./DocumentStatusLive";
import { DocumentStatusPill } from "./DocumentStatusPill";
import {
  PreviewActions,
  previewChoices,
  type PreviewActionsProps,
} from "./PreviewActions";
import { SaveStateIndicator } from "./SaveStateIndicator";
import { TOOLBAR_CONTAINER, ToolbarLabel } from "./toolbar-density";
import type { EntryData, EntryFormMode } from "./useEntryForm";

/**
 * The bar's height, which content sticky BELOW it offsets by: the document
 * panel sticks under the bar rather than sliding beneath it. 3.25rem is 52px,
 * the bar's one-row height; a bar that wraps to a second row is taller, and
 * then the panel's top tucks under it rather than leaving a gap.
 */
const DOCUMENT_BAR_MIN_HEIGHT = "min-h-13";

export interface DocumentBarProps {
  /** Form mode — create mode offers no history, menu or panel toggle. */
  mode: EntryFormMode;
  /** Whether the form is currently submitting. Disables buttons + spinner. */
  isSubmitting?: boolean;
  /**
   * The editor's WHOLE unsaved-work state — form dirtiness plus state a
   * field holds outside the form (the page builder commits on exit). The
   * restore confirmation must reflect both: restoring replaces the live
   * document, and the refresh that follows discards work in either place.
   */
  hasUnsavedWork?: boolean;
  /**
   * Whether recording is possible for this document at all. False for an entry
   * that has never been saved, which has no id for the endpoint to address.
   */
  autosaveEnabled?: boolean;
  /** When the server last stored a recovery point, by the server's clock. */
  autosaveLastSavedAt?: Date | null;
  /**
   * When a recovery point NEWER than the stored document was made, while it is
   * still on offer. Its edits live in the recovery point only, so the save
   * indicator says the work is not stored, whatever the form says.
   */
  pendingRecoveryAt?: Date | null;
  /** Entry data; needed for the history panel's address and the live region. */
  entry?: EntryData | null;
  /** Collection or Single slug. */
  collectionSlug: string;
  /** Whether the entity is localized. Forwarded to the version-history panel as
   *  the authoritative signal for its locale filter (shared writes can produce
   *  null-locale versions, so the rows alone are not conclusive). */
  localized?: boolean;

  /**
   * Whether the document has the Draft/Published lifecycle, which decides
   * whether there is a status to show.
   */
  hasStatus?: boolean;
  /**
   * The document's status in the language being edited, and whether a
   * published document has a working draft pending. Read by the status pill;
   * absent means there is no status to show.
   */
  documentStatus?: { status: string; hasWorkingDraft: boolean } | undefined;

  /* Preview. Two independent actions rendered by one control — see
     `PreviewActions`, which decides its own shape from which of them are
     available and renders nothing when neither is. */

  /** Whether a preview URL can be built for this entry. */
  isPreviewAvailable?: boolean;
  /** Opens the preview using the editor's own session. May be asynchronous. */
  onPreview?: () => void | Promise<void>;
  /**
   * What this entry's preview is called, where it is not called "Preview".
   * Names both the open-in-a-tab action and the pane toggle, which are one
   * thing to an author.
   */
  previewLabel?: string;
  /**
   * Opens and closes the preview PANE, a different action from opening the
   * preview in a tab. Absent means the surface offers no pane at all.
   */
  onTogglePreviewPane?: () => void;
  /** Whether that pane is currently open, for the control's pressed state. */
  previewPaneOpen?: boolean;
  /**
   * Whether there is a saved document for a link to name. Deliberately not
   * ANDed with `update-{slug}`: the mint endpoint authorizes against the
   * collection's real access rules, which the flat permission list may not
   * carry.
   */
  isLinkAvailable?: boolean;
  /**
   * The document a shared link names. Absent means nothing can be shared yet:
   * an unsaved entry has no id to name.
   */
  shareDocument?: PreviewLinkDocument;

  /**
   * Resource scope for the history panel's address.
   *
   * @default "collection"
   */
  scope?: "collection" | "single";
  /**
   * Whether a colleague's claim withholds writing, which withholds restoring a
   * past version as it withholds every other write.
   */
  documentLocked?: boolean;

  /** Rail collapsed state. */
  isRailCollapsed?: boolean;
  /** Rail toggle handler. */
  onToggleRail?: () => void;
  /**
   * Plugin-contributed toolbar controls, rendered first in the bar's action
   * group. Kept as an opaque node so the bar stays plugin-agnostic — the
   * caller builds it from `entryFormToolbarSlot`.
   */
  toolbarSlot?: React.ReactNode;
  /**
   * Current schema fields, used to render a stored version in the history
   * panel. Absent means the caller cannot show history, so the control hides.
   */
  historyFields?: FieldConfig[];
  /**
   * Whether this entity captures versions. Undefined means the caller could not
   * determine it, in which case the control is still offered and the panel
   * reports honestly.
   */
  historyEnabled?: boolean;
  /** How many versions the entity keeps, which the history states. */
  historyRetention?: number | false;
  /**
   * Whether the entity has the Draft/Published lifecycle, which decides what
   * the history pins as published and as the current draft.
   */
  historyLifecycle?: boolean;
}

export function DocumentBar(props: DocumentBarProps): JSX.Element | null {
  const {
    mode,
    autosaveEnabled = false,
    autosaveLastSavedAt = null,
    pendingRecoveryAt = null,
    entry,
    collectionSlug,
    hasStatus = false,
    documentStatus,
    toolbarSlot,
  } = props;
  const form = useFormContext();
  // The share popover, opened by the preview control on a wide screen and by
  // the document menu's row on a narrow one.
  const [shareOpen, setShareOpen] = useState(false);
  const entryLocale = useEntryLocale();
  // The document's actions and what each runs, decided once by the editor
  // hosting the form (`DocumentActionsHost`) for every surface that offers
  // one; this bar draws them.
  const documentActions = useHostedDocumentActions();

  // Read before anything returns early, and the address opens history only
  // when it is offered, so a link naming it on a document without it opens
  // nothing.
  const mayReadHistory = useCanRequest(collectionSlug, "readHistory");
  const historyOffered = isHistoryOffered(props, mayReadHistory);
  const { open: historyOpen, setOpen: setHistoryOpen } =
    useHistoryAddress(historyOffered);

  if (!form) {
    return null;
  }

  return (
    <div
      data-testid="document-bar"
      className={cn(
        TOOLBAR_CONTAINER,
        // Sticky at the top of the editor's scroll area, above the panel
        // (which sticks under it) and above every field.
        "sticky top-0 z-30 border-b border-border bg-background"
      )}
    >
      <div
        className={cn(
          DOCUMENT_BAR_MIN_HEIGHT,
          "flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 @lg/toolbar:px-6"
        )}
      >
        <DocumentBarState
          mode={mode}
          hasStatus={hasStatus}
          documentStatus={documentStatus}
          languageCode={
            entryLocale.isNonDefaultLocale ? entryLocale.locale : undefined
          }
          saveState={
            <SaveStateIndicator
              saveState={documentActions.saveState}
              recovery={{
                enabled: autosaveEnabled,
                storedAt: autosaveLastSavedAt,
                pendingOfferAt: pendingRecoveryAt,
              }}
              // The indicator reserves the width of its widest state so that
              // nothing after it moves as the state changes. On a bar as
              // narrow as the one where the preview's and History's words
              // step aside, that reserve is width the actions need, and kept
              // it wraps the bar onto a second row, so there it takes only
              // what it shows.
              className="@max-[51rem]/toolbar:min-w-0"
            />
          }
        />

        {/* Every action, right-aligned, in the bar's one order: a feature's
          controls, History, Preview, the document's own verbs, then the panel
          toggle at the far end.

          On a narrow screen History and the preview fold into the document's
          menu and the panel toggle goes (the panel is a page there), so the
          actions stay one row. The group also wraps inside itself, never past
          the editor's edge: a preview pane can narrow the editor on a wide
          screen, and a feature's contributed controls, which this cannot size,
          must never push the bar's own off it. */}
        <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1.5">
          {/* What a feature contributes, such as a takeover's mode switch:
            first, so the document's own verbs keep their place at the end. It
            stays while a past version is on screen, showing that version's
            own mode. */}
          {toolbarSlot}
          <DocumentBarActions
            {...props}
            historyOffered={historyOffered}
            historyOpen={historyOpen}
            onOpenHistory={() => setHistoryOpen(true)}
            documentActions={documentActions}
            shareOpen={shareOpen}
            onShareOpenChange={setShareOpen}
          />
        </div>
      </div>

      <DocumentBarLive
        saveState={documentActions.saveState}
        pendingRecovery={pendingRecoveryAt !== null}
        entry={entry}
      />

      {/* Mounted at the bar's root so the panel survives whichever set of
          actions is drawn. */}
      {props.historyFields && entry?.id ? (
        <DocumentBarHistory
          {...props}
          entryId={String(entry.id)}
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          liveStatus={documentActions.effectiveStatus}
          editingLocale={entryLocale.locale}
        />
      ) : null}
    </div>
  );
}

/**
 * The bar's actions after a feature's controls: History, then either the live
 * document's verbs or, while a past version is on screen, that version's own,
 * then the panel toggle, and the anchor the share popover hangs from.
 */
function DocumentBarActions({
  historyOffered,
  historyOpen,
  onOpenHistory,
  documentActions,
  shareOpen,
  onShareOpenChange,
  ...props
}: DocumentBarProps & {
  historyOffered: boolean;
  historyOpen: boolean;
  onOpenHistory: () => void;
  documentActions: HostedActions;
  shareOpen: boolean;
  onShareOpenChange: (open: boolean) => void;
}) {
  const pending = props.isSubmitting === true;
  // What the version on screen offers in place of the document's own verbs.
  // A colleague's claim or a submit in flight withholds restoring, as it
  // withholds every other write.
  const versionActions = useVersionActions(
    props.documentLocked === true || pending
  );
  // What the preview control is given, once: the control draws from it on a
  // wide screen, and the menu lists the same choices on a narrow one.
  const previewProps = previewPropsFor(props, () => onShareOpenChange(true));
  return (
    <>
      {historyOffered ? (
        <HistoryButton open={historyOpen} onOpen={onOpenHistory} />
      ) : null}
      {versionActions ? (
        <VersionOnScreenActions
          versionActions={versionActions}
          documentActions={documentActions}
          pending={pending}
        />
      ) : (
        <DocumentVerbs
          previewProps={previewProps}
          documentActions={documentActions}
          pending={pending}
          narrowItems={narrowItemsFor(
            historyOffered ? onOpenHistory : undefined,
            previewProps
          )}
        />
      )}
      {/* Not while history is open, which takes the panel's place. */}
      {props.onToggleRail && !historyOpen ? (
        <PanelToggle
          collapsed={props.isRailCollapsed === true}
          onToggle={props.onToggleRail}
        />
      ) : null}
      {/* What the share popover hangs from: the end of this row, which
            stays on screen at every width, unlike the preview control that
            folds into the document menu on a narrow one. */}
      {props.shareDocument === undefined ? null : (
        <SharePreviewPopover
          document={props.shareDocument}
          open={shareOpen}
          onOpenChange={onShareOpenChange}
        >
          <span className="h-0 w-0 self-end" aria-hidden="true" />
        </SharePreviewPopover>
      )}
    </>
  );
}

/**
 * Whether the document offers its history. A document only has history once
 * it has been saved, and rendering a snapshot needs the schema, so both are
 * required. The history is read in every language, as the server judges it,
 * so a user who may read only some is not offered it.
 */
function isHistoryOffered(
  props: DocumentBarProps,
  mayReadHistory: boolean
): boolean {
  return (
    props.mode === "edit" &&
    Boolean(props.entry?.id) &&
    props.historyFields !== undefined &&
    props.historyEnabled !== false &&
    mayReadHistory
  );
}

/** What the preview control is given, from the bar's props. */
function previewPropsFor(
  props: DocumentBarProps,
  openShare: () => void
): PreviewActionsProps {
  const { onPreview, previewLabel, onTogglePreviewPane } = props;
  return {
    isPreviewAvailable: props.isPreviewAvailable === true,
    ...(onPreview === undefined ? {} : { onPreview }),
    ...(previewLabel === undefined ? {} : { previewLabel }),
    ...(onTogglePreviewPane === undefined ? {} : { onTogglePreviewPane }),
    previewPaneOpen: props.previewPaneOpen === true,
    isLinkAvailable: props.isLinkAvailable === true,
    ...(props.shareDocument === undefined ? {} : { onShareLink: openShare }),
    disabled: props.isSubmitting === true,
  };
}

/**
 * The bar's own controls as menu rows, for a screen too narrow to keep them
 * beside the document's verbs: History when it is offered, then the preview's
 * choices.
 */
function narrowItemsFor(
  openHistory: (() => void) | undefined,
  previewProps: PreviewActionsProps
): NarrowMenuItem[] {
  return [
    ...(openHistory
      ? [{ id: "history", label: "History", onSelect: openHistory }]
      : []),
    ...previewChoices(previewProps).map(choice => ({
      id: `preview-${choice.id}`,
      label: choice.label,
      onSelect: choice.run,
      disabled: choice.disabled,
    })),
  ];
}

function HistoryButton({
  open,
  onOpen,
}: {
  open: boolean;
  onOpen: () => void;
}) {
  return (
    <Button
      type="button"
      variant={open ? "secondary" : "outline"}
      size="sm"
      className={cn("gap-1.5", WIDE_ONLY)}
      // Pressed while history is open, so the control says which state the
      // document is in as well as offering to change it.
      aria-pressed={open}
      onClick={onOpen}
      // Named for a pointer once its word has stepped aside for the icon.
      title="History"
    >
      <History className="h-4 w-4" aria-hidden="true" />
      {/* A supporting action like the preview, so its word gives way at the
          same bar width: with history open beside the editor the bar is
          narrow, and the version's own actions need the room. */}
      <ToolbarLabel priority="secondary">History</ToolbarLabel>
    </Button>
  );
}

type HostedActions = ReturnType<typeof useHostedDocumentActions>;

/**
 * While a past version is on screen, its own actions take the document's
 * place: Back to current, and Restore this version where the primary action
 * sits. Save and
 * Publish act on the LIVE document, which is not what is being read, so they
 * are replaced rather than greyed. On a phone these two sit in the bar at the
 * bottom instead, under the thumb.
 */
function VersionOnScreenActions({
  versionActions,
  documentActions,
  pending,
}: {
  versionActions: NonNullable<ReturnType<typeof useVersionActions>>;
  documentActions: HostedActions;
  pending: boolean;
}) {
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={WIDE_ONLY}
        onClick={versionActions.returnToCurrent}
      >
        Back to current
      </Button>
      {versionActions.restore ? (
        <Button
          type="button"
          size="sm"
          className={WIDE_ONLY}
          disabled={versionActions.restoreDisabled}
          onClick={versionActions.restore}
        >
          {/* Names what it restores, beside Back to current; the confirmation
              that follows says what happens to the live document. */}
          Restore this version
        </Button>
      ) : null}
      {/* The menu stays, with only its own rows: View API response reads what
        the server returns and is most useful while reading a version; each
        writing row carries the model's reason it is held. The primary and
        toolbar verbs are what the two buttons above replace. */}
      <DocumentActionBar
        actions={actionsAt(documentActions.actions, "menu")}
        bindings={documentActions.bindings}
        pending={pending}
      />
    </>
  );
}

/**
 * The live document's verbs: the preview control, then Save draft, the one
 * primary action and More, each drawn where the model said it belongs.
 */
function DocumentVerbs({
  previewProps,
  documentActions,
  pending,
  narrowItems,
}: {
  previewProps: PreviewActionsProps;
  documentActions: HostedActions;
  pending: boolean;
  narrowItems: NarrowMenuItem[];
}) {
  return (
    <>
      {/* ONE control for the preview: the pane, a new tab and a share link
        are destinations for one intent. Directly before the document's verbs,
        since checking how something reads is part of deciding to publish it.
        `disabled` follows the submit buttons: minting a link and opening a
        preview both act on what is already saved, so a submit in flight is a
        race with them. */}
      <div className={cn("contents", WIDE_ONLY)}>
        <PreviewActions size="sm" {...previewProps} />
      </div>
      <DocumentActionBar
        actions={documentActions.actions}
        bindings={documentActions.bindings}
        pending={pending}
        narrowItems={narrowItems}
      />
    </>
  );
}

/**
 * The panel toggle, at the far end after a thin divider. Not on a narrow
 * screen, where the panel is a page rather than beside.
 */
function PanelToggle({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const label = collapsed ? "Show rail" : "Hide rail";
  return (
    <>
      <span
        className={cn("mx-1 h-5 w-px bg-border", WIDE_ONLY)}
        aria-hidden="true"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn("px-2", WIDE_ONLY)}
        onClick={onToggle}
        aria-label={label}
        title={label}
        aria-pressed={collapsed}
      >
        {collapsed ? (
          <PanelRightClose className="h-4 w-4" />
        ) : (
          <PanelRight className="h-4 w-4" />
        )}
      </Button>
    </>
  );
}

/**
 * The spoken half of the save state. Rendered unconditionally, because a live
 * region has to be PRESENT BEFORE the text it will announce changes: mounting
 * a region and populating it in the same commit is not reliably announced.
 */
function DocumentBarLive({
  saveState,
  pendingRecovery,
  entry,
}: {
  saveState: HostedActions["saveState"];
  pendingRecovery: boolean;
  entry: EntryData | null | undefined;
}) {
  const { defaultLocale, locales } = useLocalization();
  // Present only when the entry was fetched with `?translation-status=1` on a
  // localized collection; undefined otherwise, which the region treats as
  // "nothing to report" rather than as zero progress.
  const entryTranslations = entry?._translations as
    | Record<string, { translated: boolean; status?: string }>
    | undefined;
  const counts = translationCounts(
    entryTranslations,
    locales.map(l => l.code),
    defaultLocale
  );
  return (
    <DocumentStatusLive
      saveState={saveState}
      pendingRecovery={pendingRecovery}
      {...(entryTranslations === undefined
        ? {}
        : { translatedCount: counts.translated, localeCount: counts.total })}
    />
  );
}

/** The version history panel, addressed by the document it belongs to. */
function DocumentBarHistory({
  entryId,
  open,
  onOpenChange,
  liveStatus,
  editingLocale,
  ...props
}: DocumentBarProps & {
  entryId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  liveStatus: HostedActions["effectiveStatus"];
  editingLocale: string | undefined;
}) {
  const { defaultLocale } = useLocalization();
  // Both collections and singles authorize a document write as `update-{slug}`.
  const canUpdateDocument = useCan(`update-${props.collectionSlug}`);
  const busy = props.documentLocked === true || props.isSubmitting === true;
  return (
    <VersionHistorySheet
      open={open}
      onOpenChange={onOpenChange}
      scope={
        props.scope === "single"
          ? { kind: "single", slug: props.collectionSlug, documentId: entryId }
          : { kind: "collection", slug: props.collectionSlug, entryId }
      }
      // Authoritative localized signal for the panel's locale filter.
      entityLocalized={props.localized}
      // Restore reuses the ordinary edit permission, so a caller who may only
      // read history is not offered a write that would be refused.
      canRestore={canUpdateDocument}
      // The restore's confirmation must disclose what happens to unsaved work
      // in the live editor — the WHOLE unsaved-work state, not just form
      // dirtiness: state a field holds outside the form is lost the same way.
      liveDirty={props.hasUnsavedWork === true}
      // A claim arriving while the confirmation is open: the trigger removes
      // itself, and the open dialog must refuse as well.
      restoreRefused={busy}
      // The live document's status, which is what a restore changes — the
      // selected version's own status describes the past.
      liveStatus={liveStatus}
      lifecycle={props.historyLifecycle === true}
      editingLocale={editingLocale ?? defaultLocale ?? null}
      {...(props.historyRetention !== undefined
        ? { retention: props.historyRetention }
        : {})}
    />
  );
}

/**
 * The language code as the bar draws it: small, boxed and in capitals, beside
 * the status, both for the language being edited and, on a phone, the language
 * a new document starts in.
 */
const LANGUAGE_CODE_CHIP =
  "rounded border border-border px-1.5 font-mono text-[11px] uppercase text-muted-foreground";

/**
 * Below this bar width the words "Creating in English" give way to the
 * language's code. 30rem is a phone's bar: there, the status pill, Save draft
 * and the primary action leave too little room for the words, and keeping
 * them would wrap the sticky bar onto a second row.
 */
const CREATING_IN_WORDS = "@max-[30rem]/toolbar:sr-only";
const CREATING_IN_CODE = "hidden @max-[30rem]/toolbar:inline";
const CREATING_IN_ICON = "@max-[30rem]/toolbar:hidden";

/**
 * The bar's left group: where the document stands. The status pill, then the
 * save state, then the language code off the default language; and while a
 * document is being created in a localized site, the language it is being
 * created in, since it has no translations yet to switch between.
 *
 * Never narrower than what it holds (no `min-w-0`): where the actions leave it
 * too little room, the row wraps rather than letting the actions draw over the
 * status.
 */
function DocumentBarState({
  mode,
  hasStatus,
  documentStatus,
  languageCode,
  saveState,
}: {
  mode: EntryFormMode;
  hasStatus: boolean;
  documentStatus: DocumentBarProps["documentStatus"];
  languageCode: string | undefined;
  saveState: React.ReactNode;
}) {
  const {
    enabled: localizationEnabled,
    defaultLocale,
    getLocale,
  } = useLocalization();
  return (
    <div className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-[13px] leading-[18px] text-muted-foreground">
      {hasStatus && documentStatus ? (
        <DocumentStatusPill
          status={documentStatus.status}
          hasWorkingDraft={documentStatus.hasWorkingDraft}
        />
      ) : null}
      {saveState}
      {languageCode ? (
        <span
          className={LANGUAGE_CODE_CHIP}
          title={`Editing ${getLocale(languageCode)?.label ?? languageCode}`}
        >
          {languageCode}
        </span>
      ) : null}
      {localizationEnabled && mode === "create" ? (
        <CreatingInLanguage
          code={defaultLocale}
          label={getLocale(defaultLocale)?.label ?? defaultLocale}
        />
      ) : null}
    </div>
  );
}

/**
 * Which language a new document starts in, said as fully as the bar has room
 * for: the whole sentence on a wide bar, "Creating in English" on a narrower
 * one, and the language's code on a phone, so the sticky bar stays one row.
 * A screen reader hears the whole sentence at every width, and a pointer finds
 * it in the tooltip.
 */
function CreatingInLanguage({ code, label }: { code: string; label: string }) {
  const explanation = "— other languages can be added after the first save";
  return (
    <span
      data-testid="document-bar-creating-in"
      className="inline-flex items-center gap-1.5 text-xs"
      title={`Creating in ${label} ${explanation}`}
    >
      <Globe
        className={cn("h-3.5 w-3.5 shrink-0", CREATING_IN_ICON)}
        aria-hidden="true"
      />
      <span className={CREATING_IN_WORDS}>Creating in {label}</span>
      {/* The same width at which the preview's and History's words step
          aside: the explanation is the first thing the bar gives up. */}
      <ToolbarLabel priority="secondary"> {explanation}</ToolbarLabel>
      <span
        className={cn(LANGUAGE_CODE_CHIP, CREATING_IN_CODE)}
        aria-hidden="true"
      >
        {code}
      </span>
    </span>
  );
}
