"use client";

import { Button } from "@nextlyhq/ui";
import { isFieldLocalized, type FieldConfig } from "nextly/config";
import { useEffect, useRef } from "react";
import { useFormContext } from "react-hook-form";

import { useDocumentHistory } from "@admin/components/features/versions/document-history-context";
import { useHistoryAddress } from "@admin/components/features/versions/history-address";
import { useVersionActions } from "@admin/components/features/versions/version-actions";
import { VersionHistorySheet } from "@admin/components/features/versions/VersionHistorySheet";
import {
  ChevronLeft,
  Globe,
  History,
  PanelRight,
  PanelRightClose,
} from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { useCan } from "@admin/hooks/useCan";
import { useLocalization } from "@admin/hooks/useLocalization";
import { cn } from "@admin/lib/utils";

import { useEntryLocale } from "../EntryLocaleContext";
import { translationCounts } from "../translation-meta";

import {
  DocumentActionBar,
  WIDE_ONLY,
  type NarrowMenuItem,
} from "./DocumentActionBar";
import { useHostedDocumentActions } from "./DocumentActionsContext";
import { DocumentStatusLive } from "./DocumentStatusLive";
import { EntryTitleInput } from "./EntryTitleInput";
import {
  PreviewActions,
  previewChoices,
  type PreviewActionsProps,
} from "./PreviewActions";
import { SaveStateIndicator } from "./SaveStateIndicator";
import { TOOLBAR_CONTAINER } from "./toolbar-density";
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
  /** Entry data; needed for Show JSON dialog (entry id) and Duplicate (id). */
  entry?: EntryData | null;
  /** Collection slug for the Show JSON dialog. */
  collectionSlug: string;
  /** Called when the user switches the active content language. When omitted, the
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
  /**
   * Whether a colleague's claim withholds writing.
   *
   * Separate from `lockIdentity`, which is about a Single's fixed title: this one
   * comes and goes while the editor is open. The title is a WRITE like any other,
   * and it also drives the slug through `useAutoSlug`, so leaving it editable
   * under someone else's claim contradicts the strip above it.
   */
  documentLocked?: boolean;

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
   * Where the header's back link goes, and what it is called: the list this
   * document belongs to. Omitted where there is no such list (a Single), and
   * then no link is drawn rather than an empty one.
   */
  backLink?: { href: string; label: string };
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
  isSubmitting = false,
  hasUnsavedWork = false,
  autosaveEnabled = false,
  autosaveLastSavedAt = null,
  pendingRecoveryAt = null,
  entry,
  collectionSlug,
  scope = "collection",
  historyFields,
  historyEnabled,
  lockIdentity = false,
  documentLocked = false,
  isRailCollapsed = false,
  onToggleRail,
  toolbarSlot,
  backLink,
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
  // The language a first save is made in, named on the create-mode row.
  const {
    enabled: localizationEnabled,
    defaultLocale,
    locales,
    getLocale,
  } = useLocalization();
  const defaultLocaleLabel = getLocale(defaultLocale)?.label ?? defaultLocale;
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
  // Whether history is open lives in the address, so a reload or a shared link
  // opens it again and the back button closes it.
  // True while the document area is showing a past version rather than the
  // live document.
  const { viewing: viewingVersion } = useDocumentHistory();
  const isReadingHistory = viewingVersion !== null;
  // What the version on screen offers in place of the document's own verbs.
  // A colleague's claim or a submit in flight withholds restoring, as it
  // withholds every other write.
  const versionActions = useVersionActions(documentLocked || isSubmitting);

  // Both collections and singles authorize a document write as `update-{slug}`.
  const canUpdateDocument = useCan(`update-${collectionSlug}`);

  // The document's actions and what each runs, decided once by the editor
  // hosting the form (`DocumentActionsHost`) for every surface that offers
  // one. Decided there rather than here because a plugin's document view
  // replaces the form body without this header and still offers, and runs, the
  // same actions; this header draws them.
  const documentActions = useHostedDocumentActions();
  const { effectiveStatus } = documentActions;

  // Why: autofocus the title input on create so the cursor blinks ready for
  // typing. Skip in edit mode — focusing a populated title interrupts the
  // user's reading flow.
  useEffect(() => {
    if (mode === "create") {
      inputRef.current?.focus();
    }
  }, [mode]);

  // A document only has history once it has been saved, and rendering a
  // snapshot needs the schema, so both are required to offer it. Read before
  // anything returns early, and the address opens history only then, so a
  // link naming it on a document without it opens nothing.
  const historyOffered =
    mode === "edit" &&
    Boolean(entry?.id) &&
    historyFields !== undefined &&
    historyEnabled !== false;
  const { open: historyOpen, setOpen: setHistoryOpen } =
    useHistoryAddress(historyOffered);

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

  const showHistory = historyOffered;

  // What the preview control is given, once: the control draws from it on a
  // wide screen, and the menu lists the same choices on a narrow one.
  const previewProps: PreviewActionsProps = {
    isPreviewAvailable,
    ...(onPreview === undefined ? {} : { onPreview }),
    ...(previewLabel === undefined ? {} : { previewLabel }),
    ...(onTogglePreviewPane === undefined ? {} : { onTogglePreviewPane }),
    previewPaneOpen,
    isLinkAvailable,
    ...(onCopyLink === undefined ? {} : { onCopyLink }),
    isCopyingLink,
    disabled: isSubmitting,
  };

  // The header's own controls as menu rows, for a screen too narrow to keep
  // them beside the document's verbs.
  const narrowItems: NarrowMenuItem[] = [
    ...(showHistory
      ? [
          {
            id: "history",
            label: "History",
            onSelect: () => setHistoryOpen(true),
          },
        ]
      : []),
    ...previewChoices(previewProps).map(choice => ({
      id: `preview-${choice.id}`,
      label: choice.label,
      onSelect: choice.run,
      disabled: choice.disabled,
    })),
  ];

  return (
    <div
      className={cn(
        TOOLBAR_CONTAINER,
        "sticky top-0 z-30 bg-background border-b border-border"
      )}
    >
      {/* The combined editor header: a top row with the way back at the left and
        every action at the right, then the title on a line of its own at full
        width, then the status line. One row of title and actions cut the title
        to a few words wherever the actions took the width (a narrow window, or
        beside the document panel); on its own line the title never shrinks,
        and the main action keeps its corner.

        The container declaration sits on the PARENT because an element cannot
        query its own width, and the rows respond to that width themselves. */}
      <div className="px-6 pt-2.5 pb-3 @max-lg/toolbar:px-4">
        <div
          className={cn("flex min-h-9 flex-wrap items-center gap-x-3 gap-y-2")}
        >
          {backLink ? (
            <Link
              href={backLink.href}
              className={cn(
                "inline-flex min-w-0 items-center gap-0.5 text-[13px]",
                "text-muted-foreground hover:text-foreground"
              )}
            >
              <ChevronLeft
                className="h-3.5 w-3.5 shrink-0"
                aria-hidden="true"
              />
              <span className="truncate">{backLink.label}</span>
            </Link>
          ) : null}

          {/* Every action, right-aligned, in the header's one order: History
            first, then what a feature contributes, then the document's own
            verbs, then the panel toggle at the far right.

            On a narrow screen History and the preview fold into the document's
            menu and the panel toggle goes (the panel is a page there), so the
            actions stay one row. If the cluster cannot sit beside the way back,
            the row wraps and it takes a line of its own. It also wraps inside
            itself, never past the editor's edge: a preview pane can narrow the
            editor on a wide screen, and a feature's contributed controls, which
            this cannot size, must never push the header's own off it. */}
          <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1.5">
            {showHistory ? (
              <Button
                type="button"
                variant={historyOpen ? "secondary" : "outline"}
                size="sm"
                className={cn("gap-1.5", WIDE_ONLY)}
                // Pressed while history is open, so the control says which
                // state the document is in as well as offering to change it.
                aria-pressed={historyOpen}
                onClick={() => setHistoryOpen(true)}
              >
                <History className="h-4 w-4" aria-hidden="true" />
                History
              </Button>
            ) : null}
            {/* What a feature contributes, such as a takeover's mode switch.
              It stays while a past version is on screen, showing that
              version's own mode. */}
            {toolbarSlot}
            {/* While a past version is on screen, its own actions take the
              document's place: Back to current, and Restore… where Publish
              sits. Save and Publish act on the LIVE document, which is not
              what is being read, so they are replaced rather than greyed; an
              editor offered "Save" over a past version has been invited to
              decide about something they cannot see. On a phone these two sit
              in the bar at the bottom instead, under the thumb. */}
            {versionActions ? (
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
                    Restore…
                  </Button>
                ) : null}
              </>
            ) : (
              <>
                {/* Directly left of the submit cluster, which is where an author looks
                for it: checking how something reads is part of deciding to publish
                it, not a document-management action like Duplicate or Delete. The
                `sm` size is the band's, so it lines up with Save beside it rather
                than standing a few pixels taller.

                `disabled` follows the submit buttons rather than the whole form:
                minting a link and opening a preview both act on what is already
                saved, so a submit in flight is a race with them and not merely a
                busy form. */}
                {/* ONE control for the preview, not three. The pane toggle used to
                sit beside this looking like a second preview button, with opening
                and copying already sharing a menu of their own — three of the
                header's controls for one idea. */}
                <div className={cn("contents", WIDE_ONLY)}>
                  <PreviewActions size="sm" {...previewProps} />
                </div>
                {/*
                Every document verb, drawn where the model said each belongs.

                One control leads and the rest are demoted, which the header could
                not express while each button decided its own placement in JSX: a
                published document with a pending draft drew Save, Publish and
                Unpublish at equal weight, and Unpublish sat one slip from Publish.

                While a past version is on screen they give way to its own
                actions, above.
              */}
                <DocumentActionBar
                  actions={documentActions.actions}
                  bindings={documentActions.bindings}
                  pending={isSubmitting}
                  narrowItems={narrowItems}
                  narrowPending={isCopyingLink}
                />
              </>
            )}

            {/* Rail toggle — far right, separated by a thin divider. Not on a
              narrow screen, where the panel is a page rather than beside, and
              not while history is open, which takes the panel's place. */}
            {onToggleRail && !historyOpen && (
              <>
                <span
                  className={cn("w-px h-5 bg-border mx-1", WIDE_ONLY)}
                  aria-hidden="true"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={cn("px-2", WIDE_ONLY)}
                  onClick={onToggleRail}
                  aria-label={isRailCollapsed ? "Show rail" : "Hide rail"}
                  title={isRailCollapsed ? "Show rail" : "Hide rail"}
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

        {/* The title, on its own line at full width, so no action can take its
          width. A size smaller on a phone, where the larger one cut short a
          title of a few ordinary words. */}
        <div className="mt-1.5">
          {/* The title is part of the document, so reading a past version
            locks it with everything else. Left editable it would mutate the
            LIVE document while the version on screen cannot be edited — and
            go to autosave as unsaved work nobody typed on purpose. */}
          <EntryTitleInput
            className="text-2xl leading-8 @max-lg/toolbar:text-xl @max-lg/toolbar:leading-[26px]"
            name={titleName}
            control={form.control}
            label={titleLabel}
            required={titleRequired && !isReadingHistory}
            locked={lockIdentity || isReadingHistory || documentLocked}
            submitting={isSubmitting}
            rtl={titleRtl}
            inputRef={(el: HTMLInputElement | null) => {
              inputRef.current = el;
            }}
          />
        </div>

        {/* The status line: the save state lives here rather than among the
          actions, since it reports on the document rather than offering
          anything to do. It collapses when there is nothing to say, so no
          empty strip is drawn. */}
        <div
          className={cn(
            "mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1",
            "text-[13px] leading-[18px] text-muted-foreground empty:hidden"
          )}
        >
          {/* The document's own save state, the one every surface reads; the
            recovery point is a safety net rather than a save, and is described
            in its tooltip. */}
          <SaveStateIndicator
            saveState={documentActions.saveState}
            recovery={{
              enabled: autosaveEnabled,
              storedAt: autosaveLastSavedAt,
              pendingOfferAt: pendingRecoveryAt,
            }}
          />
        </div>
        {/* The spoken half of the same information. Rendered unconditionally,
          because a live region has to be PRESENT BEFORE the text it will
          announce changes: mounting a region and populating it in the same
          commit is not reliably announced. */}
        <DocumentStatusLive
          saveState={documentActions.saveState}
          pendingRecovery={pendingRecoveryAt !== null}
          {...(entryTranslations === undefined
            ? {}
            : {
                translatedCount: counts.translated,
                localeCount: counts.total,
              })}
        />
      </div>

      {/* The language row. Its own row rather than the action cluster: sharing
          one flex row starved the title input to zero width in a localized
          collection, since the cluster is shrink-0 and the strip is the widest
          thing in it. Rendered only when localization applies, so
          non-localized editors keep a single-row header.

          While a past version is on screen, switching language or running a
          language action would act on the live document while the version on
          screen cannot be edited — so both are withheld, and only there. */}
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
          // The restore's confirmation must disclose what happens to unsaved
          // work in the live editor — restoring replaces the live document,
          // and the refresh that follows discards it. The WHOLE unsaved-work
          // state, not just form dirtiness: state a field holds outside the
          // form (the page builder's pending document) is lost the same way.
          liveDirty={hasUnsavedWork}
          // A claim arriving while the confirmation is open: the trigger
          // removes itself, and the open dialog must refuse as well.
          restoreRefused={documentLocked || isSubmitting}
          // The live document's status, which is what a restore changes — the
          // selected version's own status describes the past.
          liveStatus={effectiveStatus}
        />
      ) : null}
    </div>
  );
}
