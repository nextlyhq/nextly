/**
 * A document's version history, as a right-side panel.
 *
 * Preview is a mode inside this panel rather than a second sheet: the editor is
 * looking at one thing — this document's history — and nesting dialogs would
 * trap focus twice for what is conceptually a step, not a new context.
 *
 * A comparison is not shown here: it is read on its own page, whose address
 * names the pair, opened from the version being previewed.
 *
 * @module components/features/versions/VersionHistorySheet
 */

import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useSuppressAdminChrome } from "@admin/components/layout/ChromeSuppression";
import { useReserveSidePanel } from "@admin/components/layout/SidePanelReservation";
import {
  Alert,
  AlertDescription,
  Button,
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  toast,
} from "@admin/components/ui";
import {
  useDocumentEvents,
  useRestoreVersion,
  useSetVersionLabel,
  useVersion,
  useVersions,
} from "@admin/hooks/queries/useVersions";
import { useMediaQuery } from "@admin/hooks/useMediaQuery";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import { navigateTo } from "@admin/lib/navigation";
import type { VersionScope } from "@admin/services/versionApi";

import { useDocumentHistory } from "./document-history-context";
import { useHistoryAddress } from "./history-address";
import { loadedWindow } from "./history-story";
import { HistoryStoryList } from "./HistoryStoryList";
import { RestoreConfirmDialog } from "./RestoreConfirmDialog";
import { useMarkVersionSeen } from "./useMarkVersionSeen";
import { newestInLocale, predecessorOf } from "./version-pairing";
import { versionsHref } from "./VersionComparePage";
import { VersionLabelDialog } from "./VersionLabelDialog";

// How many extra history pages the panel will auto-fetch while searching for a
// previewed version's previous same-locale version before deferring to the
// manual "Load more" control. Bounds the search in a long, retention-disabled,
// multi-locale history where a lone-locale row would otherwise page to the end.
const MAX_AUTO_PREVIOUS_PAGES = 3;

/**
 * The panel's widths, and the one place they are stated.
 *
 * Both the element's own width and the space the layout keeps clear for it are
 * taken from here. Two literals would agree on the day they were written and
 * disagree the day one of them is changed, and the failure that follows is
 * silent: the page is indented by one number while the panel occupies another,
 * so a strip of the document is drawn under the panel and its controls stop
 * responding without appearing to have changed.
 *
 * History takes the document panel's place beside the editor: 400 wide on a
 * wide window, and 360 below `PANEL_WIDE_WINDOW`, where the content sidebar
 * also folds while history is open so the document keeps its room.
 */
const PANEL_WIDTH = 400;
const PANEL_NARROW_WIDTH = 360;

/** From this window width the panel is at its full width. */
const PANEL_WIDE_WINDOW = 1200;

/**
 * The narrowest window that holds the panel BESIDE the document. Below it the
 * panel is a page of its own, over the document and modal.
 */
const PANEL_MIN_WINDOW = 1024;

/** One array for "nothing was held back", so its identity never changes. */
const NOTHING_WITHHELD: readonly string[] = [];

/**
 * Folds the content sidebar for as long as it is mounted, which is while
 * history is open beside the document on a window too narrow to hold both
 * with it. The panel's close control is the way back, so it can exit.
 */
function FoldContentSidebar(): null {
  useSuppressAdminChrome({ layers: ["subSidebar"], canExit: true });
  return null;
}

export interface VersionHistorySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: VersionScope;
  /**
   * Whether this caller may write the document. Restore uses the ordinary edit
   * permission, so someone who can only read history is offered no way to
   * trigger a write that would fail.
   */
  canRestore?: boolean;
  /**
   * Status of the LIVE document, which is what a restore is about to change.
   * The selected version's own status describes the past and says nothing
   * about whether this change is publicly visible.
   */
  liveStatus?: string | null;
  /**
   * Whether the document's entity is localized. This is the authoritative
   * signal for the locale filter: a localized document can record shared-field
   * writes with a null locale, so the loaded rows alone cannot prove one way or
   * the other. Absent, the panel falls back to inferring it from the rows.
   */
  entityLocalized?: boolean;
  /**
   * Whether the live editor holds unsaved changes. Restoring replaces the
   * live document, and the refresh that follows discards that work — the
   * confirmation has to say so before the author commits to it.
   */
  liveDirty?: boolean;
  /**
   * A transient reason the confirm action must refuse: the document
   * becoming read-only while the confirmation is open. The Restore… trigger
   * removes itself on the same signal, but an already-open dialog outlives
   * it, so the refusal has to be carried into the confirmation as well.
   */
  restoreRefused?: boolean;
  /**
   * Whether the document has the Draft/Published lifecycle. Its pinned
   * "Current draft" and "Currently published" exist only with one, and only
   * its publishes ship saves.
   */
  lifecycle?: boolean;
  /** The language being edited, which the list opens on with shared fields. */
  editingLocale?: string | null;
  /** The retention limit, which the list states in one line. */
  retention?: number | false;
}

function ListSkeleton() {
  return (
    <div className="p-4 flex flex-col gap-4" aria-busy="true">
      <span className="sr-only" role="status" aria-live="polite">
        Loading history
      </span>
      {[0, 1, 2].map(i => (
        <div key={i} className="flex flex-col gap-1">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
      ))}
    </div>
  );
}

export function VersionHistorySheet({
  open,
  onOpenChange,
  scope,
  canRestore = false,
  liveStatus = null,
  entityLocalized,
  liveDirty = false,
  restoreRefused = false,
  lifecycle = false,
  editingLocale = null,
  retention,
}: VersionHistorySheetProps) {
  // The version chosen lives in the address beside the panel's own key, so a
  // link names it; the list shows while none is chosen.
  const { version: selected, setVersion: setSelected } = useHistoryAddress();
  const [confirmingRestore, setConfirmingRestore] = useState(false);
  // The version being renamed, which is not necessarily the one being previewed
  // — an editor can name a row without opening it.
  const [renaming, setRenaming] = useState<number | null>(null);

  // Reopening the panel should start at the list. Without this the previously
  // previewed version would still be showing, which reads as a stale panel.
  useEffect(() => {
    if (!open) {
      setSelected(null);
      setConfirmingRestore(false);
      // The rename dialog is mounted outside the panel, so closing the panel
      // does not close it. Left set, it would stay on screen over a dismissed
      // panel, or reappear the moment the panel was reopened.
      setRenaming(null);
    }
  }, [open, setSelected]);

  // Identity of the document this sheet is bound to, as a stable string so a
  // re-created `scope` object with the same target does not read as a change.
  const scopeId =
    scope.kind === "single"
      ? `single:${scope.slug}:${scope.documentId ?? ""}`
      : `collection:${scope.slug}:${scope.entryId ?? ""}`;

  // Reset every mode when the document changes under a still-open sheet: the
  // custom admin router can navigate between entries without unmounting. This
  // resets DURING render, not in an effect, so the very first render under the
  // new scope already has the modes cleared. An effect would run one render too
  // late, letting that interim render mount the diff view with the previous
  // document's version pair, fetch it against the new document, and briefly
  // paint the old diff via keepPreviousData.
  const [renderedScopeId, setRenderedScopeId] = useState(scopeId);
  if (renderedScopeId !== scopeId) {
    setRenderedScopeId(scopeId);
    // The chosen version is not reset here: it lives in the address, which a
    // render must not write, and another document's address carries none.
    setConfirmingRestore(false);
    setRenaming(null);
  }

  const list = useVersions({ scope, enabled: open });
  // The document's events, which the story shows beside its versions.
  const eventList = useDocumentEvents({ scope, enabled: open });
  // Destructured so the boundary-fetch effect can depend on the paging members
  // by identity rather than on the whole query object, which changes each render.
  // `isRefetching` is a whole-list revalidation (not a page fetch), during which
  // the cached head may be one save behind the server.
  const {
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    isRefetching,
    isRefetchError,
    fetchNextPage,
  } = list;
  const detail = useVersion({ scope, versionNo: selected, enabled: open });

  const { setViewing, setRestore } = useDocumentHistory();
  const viewedSnapshot = detail.data?.snapshot;
  const viewedLocale = detail.data?.locale ?? null;
  const viewedLoading = detail.isLoading;
  const viewedError = detail.error ?? null;
  // What the read held back. A shared constant while nothing has arrived, so a
  // render that has no version yet does not republish the selection.
  const viewedWithheld = detail.data?.withheld ?? NOTHING_WITHHELD;

  // Shown once it has arrived and is on screen: chosen and still loading, or
  // failed, is not a version the person has seen.
  useMarkVersionSeen(
    scope,
    scopeId,
    open &&
      selected !== null &&
      viewedSnapshot !== undefined &&
      !viewedLoading &&
      viewedError === null
      ? selected
      : null
  );

  // Returning to the live document from Back to current clears the selection here
  // too, so the list stops showing a row as active for a version that is no
  // longer on screen.
  useEffect(() => {
    if (!open) return;
    return () => setViewing(null);
  }, [open, setViewing]);

  /*
   * Whether the window can hold this panel BESIDE the document rather than over
   * it. Asked of the window, because the panel is `position: fixed` and so is
   * measured against the window rather than against whatever contains it.
   *
   * Read on every render of the header, not on open: `useMediaQuery` answers
   * `false` until its effect runs, and deciding at the moment of opening would
   * mount the panel modal and switch it a frame later — engaging a focus trap
   * and then releasing it.
   */
  const roomBeside = useMediaQuery(`(min-width: ${PANEL_MIN_WINDOW}px)`);
  const wide = useMediaQuery(`(min-width: ${PANEL_WIDE_WINDOW}px)`);
  const panelWidth = wide ? PANEL_WIDTH : PANEL_NARROW_WIDTH;
  // Without room beside the document the panel is a page over it, so a chosen
  // version is read with that page stepped aside, and the comparison bar
  // leads back.
  const steppedAside = open && !roomBeside && selected !== null;

  const restore = useRestoreVersion({
    scope,
    onSuccess: result => {
      setConfirmingRestore(false);
      onOpenChange(false);
      // A restore can succeed while leaving parts behind: a field the schema no
      // longer has, one the restorer may not read, or one they may not write.
      // Saying so beats a clean success message that overstates what came
      // back. The message names no cause and no outcome, since the list mixes
      // them: a field the schema dropped has no current value to keep.
      if (result.droppedFields.length > 0) {
        toast.success(
          `Restored version ${result.restoredFrom}. ` +
            `${result.droppedFields.length} field(s) were not restored: ` +
            result.droppedFields.join(", ")
        );
        return;
      }
      toast.success(`Restored version ${result.restoredFrom}.`);
    },
    onError: error => {
      // A refused restore must say so. The dialog stays open on failure so the
      // action is still there to retry, and silence would read as the click
      // simply not having registered.
      setConfirmingRestore(false);
      toast.error(apiErrorMessage(error) || "Could not restore this version.");
    },
  });

  const versions = list.data?.pages.flatMap(page => page.items) ?? [];

  // Whether THIS document is localized, not just whether the app is. The
  // authoritative signal is the entity's own localization flag: a localized
  // document can record shared-field writes with a null locale, so a loaded page
  // that happens to hold only such rows (or only one locale) cannot prove it
  // either way. When the flag is not supplied, fall back to inferring it from
  // any locale present in the history.
  const isLocalizedDocument =
    entityLocalized ?? versions.some(v => v.locale !== null);

  // The story reads both lists, each a page at a time, so it shows only the
  // window both have loaded; "Load more" extends whichever has more.
  const events = eventList.data?.pages.flatMap(page => page.items) ?? [];
  const story = loadedWindow({
    versions,
    versionsComplete: !hasNextPage,
    events,
    eventsComplete: !eventList.hasNextPage,
  });
  const hasMore = hasNextPage || eventList.hasNextPage;
  const loadMore = () => {
    if (hasNextPage) void fetchNextPage();
    if (eventList.hasNextPage) void eventList.fetchNextPage();
  };

  // The comparison target for the version being previewed: the next-older
  // version in the same language (the server rejects a cross-locale pair), not
  // `selected - 1`, since retention can leave gaps in the numbering.
  // The comparison page's rail asks this same question, so it is answered in
  // one place. Passing `false` for "more pages exist" is deliberate here: this
  // panel pages forward on its own below until the previous target resolves or
  // the history runs out, so by the time this is read an absent predecessor
  // means there is none rather than that none has loaded.
  const previousTarget =
    selected === null ? null : predecessorOf(versions, selected, false);
  const previousVersionNo =
    previousTarget?.kind === "version" ? previousTarget.versionNo : null;

  // Hand the chosen version to the document area, and take it back whenever
  // nothing is chosen — including when the panel closes, so dismissing it never
  // strands the editor on a version it can no longer see the list for. It
  // carries what the version is compared with, so the document marks changes
  // against the same version the panel pairs it with.
  //
  // Its name, time and author from the list's own row, which carries the
  // author by name; the version read alone carries only an id. The read is
  // the fallback for a version a link names beyond the rows loaded.
  const viewedAbout =
    versions.find(v => v.versionNo === selected) ?? detail.data ?? null;
  // The scope is read through a ref, keyed by `scopeId`: the object is rebuilt
  // on every render, and publishing it as a dependency would republish the
  // version, re-rendering the editor, every time.
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  // A "first" is believed only once the list has really ended: while older
  // pages remain (the search paused, or a page failed) the predecessor is
  // unknown, and the document must not present the version as the first.
  const comparedWithKind =
    previousTarget?.kind === "first" && hasNextPage
      ? "unknown"
      : (previousTarget?.kind ?? "unknown");
  useEffect(() => {
    if (!open || selected === null) {
      setViewing(null);
      return;
    }
    // Published on SELECTION rather than on arrival: the document has to show
    // that it is fetching, or a click that leaves the live document on screen
    // reads as a control that did nothing.
    setViewing({
      versionNo: selected,
      snapshot: viewedSnapshot,
      locale: viewedLocale,
      withheld: viewedWithheld,
      isLoading: viewedLoading,
      error: viewedError,
      scope: scopeRef.current,
      comparedWith:
        comparedWithKind === "version" && previousVersionNo !== null
          ? { kind: "version", versionNo: previousVersionNo }
          : { kind: comparedWithKind === "first" ? "first" : "unknown" },
      about: viewedAbout,
    });
  }, [
    open,
    selected,
    viewedSnapshot,
    viewedLocale,
    viewedWithheld,
    viewedLoading,
    viewedError,
    viewedAbout,
    comparedWithKind,
    previousVersionNo,
    scopeId,
    setViewing,
  ]);
  // The previewed version must still be in the refreshed list. Retention can
  // prune it out from under the preview (a save in another tab, then a focus
  // refetch), and comparing a version that no longer exists would request a diff
  // whose `from` 404s.
  const selectedPresent =
    selected !== null && versions.some(v => v.versionNo === selected);
  // Only offered once the list has revalidated: a stale or failed revalidation
  // could point "previous" at a version retention has already pruned, 404-ing
  // the comparison. A failed revalidation clears `isRefetching` but leaves the
  // list stale, so `isRefetchError` keeps it withheld until a fetch succeeds.
  const listFresh = !isRefetching && !isRefetchError;
  const canComparePrevious =
    selectedPresent && previousVersionNo !== null && listFresh;
  // The newest version in the chosen one's language, to compare against for
  // everything since it; withheld on the same freshness grounds, since a stale
  // list can name a newest that has since been pruned.
  const newestVersionNo =
    selected === null ? null : newestInLocale(versions, selected);
  const canCompareCurrent =
    selectedPresent && newestVersionNo !== null && listFresh;

  // Restoring is offered beside the version in the document, where the
  // reader is looking — but it stays THIS component's mutation, guarded by
  // this component's confirmation. Only the trigger travels.
  const requestRestore = useCallback(() => setConfirmingRestore(true), []);
  // Clears this panel's own selection as well as the shared one, so the list
  // stops marking a row active for a version that is no longer on screen.
  // Where the panel is a page, the live document is reached by leaving history
  // altogether: clearing the version alone would bring the page back over it.
  const returnToCurrent = useCallback(
    () => (roomBeside ? setSelected(null) : onOpenChange(false)),
    [roomBeside, setSelected, onOpenChange]
  );
  const backToHistory = useCallback(() => setSelected(null), [setSelected]);
  // The full comparison, on a page of its own, from the version chosen
  // against the one before it in the same language: its address names the
  // pair so it can be shared. The SELECTED version's language, not the
  // sheet's filter: the filter says which rows are listed, while this says
  // which text the pair actually holds, and the destination must name the
  // document in that.
  // Built as the address itself, a plain string: the scope object and the
  // list are rebuilt each render, and an action built from them would
  // republish the banner's actions, re-rendering the editor, every time.
  const selectedLocale = versions.find(v => v.versionNo === selected)?.locale;
  const comparisonHref =
    selected === null || previousVersionNo === null
      ? null
      : versionsHref(
          scope,
          { from: previousVersionNo, to: selected },
          selectedLocale
        );
  const openComparison = useCallback(() => {
    if (comparisonHref !== null) navigateTo(comparisonHref);
  }, [comparisonHref]);
  // The same page, from the version chosen to the newest in its language:
  // everything that has changed since it.
  const currentComparisonHref =
    selected === null || newestVersionNo === null
      ? null
      : versionsHref(
          scope,
          { from: selected, to: newestVersionNo },
          selectedLocale
        );
  const openCurrentComparison = useCallback(() => {
    if (currentComparisonHref !== null) navigateTo(currentComparisonHref);
  }, [currentComparisonHref]);
  useEffect(() => {
    if (!open || selected === null) {
      setRestore(null);
      return;
    }
    setRestore({
      canRestore,
      request: requestRestore,
      returnToCurrent,
      // Where the page steps aside, the version is all that is on screen, so
      // its comparison bar carries the way back to the list and the
      // comparisons too.
      ...(roomBeside
        ? {}
        : {
            backToHistory,
            ...(canComparePrevious ? { compare: openComparison } : {}),
            ...(canCompareCurrent
              ? { compareCurrent: openCurrentComparison }
              : {}),
          }),
    });
    // Withdrawn on unmount as well as on close: a Restore… left holding a
    // trigger into an unmounted panel would open a dialog nothing renders.
    return () => setRestore(null);
  }, [
    open,
    selected,
    canRestore,
    requestRestore,
    returnToCurrent,
    backToHistory,
    canComparePrevious,
    openComparison,
    canCompareCurrent,
    openCurrentComparison,
    roomBeside,
    setRestore,
  ]);

  // When previewing a version whose previous same-locale version has not loaded
  // yet, page forward until it resolves or history runs out. Interleaved locales
  // can place that previous version beyond the current page even when the
  // selected row is not the last one loaded overall, so this keys off "no
  // previous target found" rather than the loaded bottom. It stops after a
  // failed fetch (React Query leaves `hasNextPage` true while `isFetchingNextPage`
  // clears, which would otherwise spin the pager) and after a bounded number of
  // pages, so a lone-locale version in a long history does not walk the whole
  // list to prove no target exists. The manual "Load more" control stays
  // available to search deeper.
  const previousSearchRef = useRef<{
    scopeId: string | null;
    selected: number | null;
    pages: number;
  }>({
    scopeId: null,
    selected: null,
    pages: 0,
  });
  useEffect(() => {
    if (selected === null || canComparePrevious) return;
    // Do not page while a head revalidation is running OR has failed. Firing
    // `fetchNextPage` mid-revalidation would cancel it (default `cancelRefetch`),
    // and firing it after a failed one would clear `isRefetchError` without
    // refreshing the stale head, both re-enabling the comparison against a
    // stale head. Paging resumes once a revalidation succeeds.
    if (isRefetching || isRefetchError) return;
    const search = previousSearchRef.current;
    // Keyed by document too: version numbers repeat across documents, so a spent
    // budget for version N in one document must not suppress paging for version N
    // in another.
    if (search.scopeId !== scopeId || search.selected !== selected) {
      search.scopeId = scopeId;
      search.selected = selected;
      search.pages = 0;
    }
    if (
      hasNextPage &&
      !isFetchingNextPage &&
      !isFetchNextPageError &&
      search.pages < MAX_AUTO_PREVIOUS_PAGES
    ) {
      search.pages += 1;
      void fetchNextPage();
    }
  }, [
    scopeId,
    selected,
    canComparePrevious,
    isRefetching,
    isRefetchError,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  ]);

  // The row being renamed, so the dialog opens seeded with its current name
  // rather than blank.
  const renamingVersion =
    renaming === null
      ? null
      : (versions.find(v => v.versionNo === renaming) ?? null);

  const setLabel = useSetVersionLabel({
    scope,
    onSuccess: result => {
      setRenaming(null);
      toast.success(
        result.item.label === null
          ? "Name removed."
          : `Version named "${result.item.label}".`
      );
    },
    onError: error => {
      // The dialog stays open so the typed name is not lost to a failed save.
      toast.error(apiErrorMessage(error) || "Could not rename this version.");
    },
  });
  const isEmpty = !list.isLoading && !list.isError && versions.length === 0;
  // The versions and the events tell one story, so the panel loads, fails and
  // goes stale with either. Events read as an empty list while their request
  // is loading or has failed would drop unpublishes and discards from the
  // story and pin a withdrawn version as currently published.
  const storyLoading = list.isLoading || eventList.isLoading;
  const storyLoadFailed =
    (list.isError && versions.length === 0) ||
    // Events that loaded can rightly be none, so it is the absence of any
    // page, not of any event, that makes their failure a load failure.
    (eventList.isError && eventList.data === undefined);
  const storyStale =
    (isRefetchError && versions.length > 0) || eventList.isRefetchError;
  const storyRetrying = isRefetching || eventList.isRefetching;
  const retryStory = () => {
    void list.refetch();
    void eventList.refetch();
  };

  /*
   * The claim, and the ONE fact both behaviours below are derived from. A panel
   * that is reserved is beside the document, so the document stays live and
   * only the explicit controls close it; a panel that is not is over the
   * document, so it is modal and says so. Deciding those separately is how a
   * panel ends up non-modal with nothing having made room for it, which leaves
   * every control underneath it visible, enabled and inert.
   */
  useReserveSidePanel(open && roomBeside ? panelWidth : null);

  return (
    // Non-modal WHERE THE LAYOUT MADE ROOM, and that is the point rather than a
    // detail. A modal panel scrims the page, traps focus and withdraws
    // everything behind it from the accessibility tree — so reading a
    // document's history made the document itself unreachable and
    // unscrollable, which is the one thing an editor needs beside it.
    //
    // Where the window is too narrow to hold both, modal is the honest state:
    // the panel covers the document either way, and a modal one refuses the
    // clicks it is swallowing instead of accepting them into nothing.
    <>
      {open && roomBeside && !wide ? <FoldContentSidebar /> : null}
      <Sheet
        open={open && !steppedAside}
        onOpenChange={onOpenChange}
        modal={!roomBeside}
      >
        <SheetContent
          side="right"
          className="p-0 flex flex-col"
          // Width from the same constant the reservation is made with, so the
          // space kept clear cannot drift from the space taken. Capped at the
          // window because the panel is wider than a phone.
          // Beside the document, the width reserved for it; below that, a page
          // of its own across the window.
          style={{
            width: roomBeside ? `${panelWidth}px` : "100vw",
            maxWidth: "100vw",
          }}
          // A non-modal surface closes on outside interaction by default, which
          // would make the document unusable while history is open: the first
          // click into the page it now leaves interactive would dismiss the
          // panel. Closing stays with the explicit controls and Escape. A modal
          // panel keeps the default, which is what a drawer over a page should
          // do.
          {...(roomBeside
            ? { onInteractOutside: (event: Event) => event.preventDefault() }
            : {})}
        >
          <SheetHeader className="p-4 border-b border-border">
            <div className="flex items-center justify-between gap-2">
              {/* The list stays whole with the chosen row marked, so the panel
                is History whichever version is on screen. */}
              <SheetTitle>History</SheetTitle>
              <div className="flex items-center gap-1">
                {/* The sheet primitive renders no close icon of its own, so the
                  panel supplies one. It sits beside the title rather than in
                  the footer because the footer's action row gains the compare
                  controls once a version is selected and wraps at this width,
                  which carried the only exit off-screen. */}
                <SheetClose asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 shrink-0 p-0"
                    aria-label="Close history"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </SheetClose>
              </div>
            </div>
            <SheetDescription className="sr-only">
              Past versions of this document, newest first.
            </SheetDescription>
          </SheetHeader>

          {/* A head revalidation (on open or window focus) can fail after history
            has already loaded. The rows stay on screen but may be stale, so the
            freshness gate hides "Compare with current" and disables "Load more"
            until a refetch succeeds — which, without this, only a reopen or
            another window focus could trigger. This keeps the gate but gives the
            recovery a visible control. Suppressed when there are no rows, since
            the full-panel load error covers that. */}
          {storyStale ? (
            <div className="px-4 pt-4">
              <Alert variant="warning" role="status">
                <div className="flex flex-1 flex-wrap items-center justify-between gap-3">
                  <AlertDescription>
                    Couldn&apos;t refresh this history. It may be out of date.
                  </AlertDescription>
                  <Button
                    variant="outline"
                    size="sm"
                    // Disabled while a retry is in flight; the same refetch also
                    // fires from window focus, so this reflects either trigger.
                    disabled={storyRetrying}
                    onClick={retryStory}
                  >
                    {storyRetrying ? "Retrying…" : "Try again"}
                  </Button>
                </div>
              </Alert>
            </div>
          ) : null}

          {/* The panel is a timeline: the list stays on screen and the chosen
            version is rendered in the DOCUMENT rather than in here. Previewing
            inside a 480px panel was always the compromise — the question an
            editor is asking is how the page read then, and only the page can
            answer it. */}
          <div className="flex-1 overflow-y-auto">
            {storyLoading ? (
              <ListSkeleton />
            ) : storyLoadFailed ? (
              // Only a genuine load failure (no pages) replaces the panel. A failed
              // speculative next-page (from the automatic previous-version search)
              // also flips the query to error, but the loaded history stays on
              // screen; its "Load more" control offers the retry.
              <div className="p-4 flex flex-col gap-3">
                <Alert variant="destructive">
                  <AlertDescription>
                    This document&apos;s history could not be loaded.
                  </AlertDescription>
                </Alert>
                <Button variant="outline" size="sm" onClick={retryStory}>
                  Try again
                </Button>
              </div>
            ) : isEmpty ? (
              <div className="px-4 py-8 text-center">
                {/* A heading rather than a paragraph: when the panel is empty
                  this is the only content in it, and a paragraph gives
                  assistive technology nothing to land on. `h3` because the
                  panel's own title is the heading above it. */}
                <h3 className="text-base font-semibold text-foreground">
                  No versions yet
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Saving this document will record its first version.
                </p>
              </div>
            ) : (
              <>
                <HistoryStoryList
                  scope={scope}
                  versions={story.versions}
                  events={story.events}
                  lifecycle={lifecycle}
                  localized={isLocalizedDocument}
                  editingLocale={editingLocale}
                  {...(retention !== undefined ? { retention } : {})}
                  hasMore={hasMore}
                  selected={selected}
                  onSelect={setSelected}
                  onClearSelection={() => setSelected(null)}
                  // Renaming writes to the document's history, which needs the
                  // same permission restoring does. Offering it to a read-only
                  // caller would open a dialog whose save the route rejects.
                  {...(canRestore ? { onRename: setRenaming } : {})}
                  footer={
                    hasMore ? (
                      <div className="p-4">
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          // Disabled while the head is revalidating or its revalidation
                          // failed: `fetchNextPage` would otherwise cancel the refetch
                          // or clear the error, leaving a stale head trusted as current.
                          disabled={
                            isFetchingNextPage ||
                            eventList.isFetchingNextPage ||
                            isRefetching ||
                            isRefetchError
                          }
                          onClick={loadMore}
                        >
                          {isFetchingNextPage || eventList.isFetchingNextPage
                            ? "Loading…"
                            : "Load more"}
                        </Button>
                      </div>
                    ) : null
                  }
                />
              </>
            )}
          </div>

          {/* The action row exists only while a version is selected. Rendering it
            unconditionally left an empty bordered strip below the list once the
            close control moved to the header, since these actions are the only
            other thing it ever held.

            It wraps, which is safe now and was not before. These three controls
            exceed 480px, so they either wrap or scroll; wrapping puts the
            overflow on a second visible line, while a horizontal scroll leaves
            the last control half-drawn at the panel's edge and reachable only
            by a gesture nothing advertises. What made wrapping unusable before
            was the close control sitting here with `ml-auto`: it landed alone
            on the wrapped line, against the panel edge, where the viewport
            clipped it. With the exit in the header, a second line costs
            nothing. */}
          {/* No way back to the list here: the list never left the panel, and
            the title bar over the version offers Back to current. */}
          {selected !== null && (canComparePrevious || canCompareCurrent) ? (
            <div className="p-4 border-t border-border flex flex-wrap items-center gap-2">
              {/* The full comparison, on a page of its own, from the version
                already chosen against the one before it: its address names
                the pair so it can be shared. */}
              {/* Only offered once the pair it would open is known. Omitting the
                pair does not open "this version with nothing"; the destination
                reads an absent pair as the two NEWEST versions, so the control
                would silently show a comparison the reader did not ask for. */}
              {canComparePrevious ? (
                <Button variant="outline" size="sm" onClick={openComparison}>
                  Open full comparison
                </Button>
              ) : null}
              {canCompareCurrent ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={openCurrentComparison}
                >
                  Compare with current
                </Button>
              ) : null}
              {/* Restoring is offered in the title bar over the version being
                  read, not here. The panel only ever offered it while a
                  version was selected, which is exactly when the version is on
                  screen — so a button here would be a second control with the
                  same label, and the further one from what it acts on. This
                  component still owns the mutation and its confirmation; the
                  title bar holds the trigger. */}
            </div>
          ) : null}
        </SheetContent>

        {/* Rendered inside the sheet but outside its content, so its own portal
          is independent of the panel's. */}
        {selected !== null ? (
          <RestoreConfirmDialog
            open={confirmingRestore}
            onOpenChange={setConfirmingRestore}
            versionNo={selected}
            isPublished={liveStatus === "published"}
            unsavedChanges={liveDirty}
            hasWithheldFields={viewedWithheld.length > 0}
            confirmDisabled={restoreRefused}
            isRestoring={restore.isPending}
            // Re-checked at confirm time: the Restore… trigger can vanish while
            // the dialog is open (a claim arriving mid-dialog), and an open
            // dialog must not restore past a refusal that arrived after it.
            onConfirm={() => {
              if (canRestore && !restoreRefused) restore.mutate(selected);
            }}
          />
        ) : null}

        {/* Mounted on the same terms as the restore dialog: outside the panel
          body so its lifecycle is independent of the panel's. */}
        {renaming !== null ? (
          <VersionLabelDialog
            // A fresh dialog per version: the input seeds from its initial props
            // and never resyncs, so a new version needs a new instance rather
            // than an effect that would also clobber an in-progress edit.
            key={renaming}
            open
            onOpenChange={open => {
              if (!open) setRenaming(null);
            }}
            versionNo={renaming}
            currentLabel={renamingVersion?.label ?? null}
            saving={setLabel.isPending}
            onSubmit={label => setLabel.mutate({ versionNo: renaming, label })}
          />
        ) : null}
      </Sheet>
    </>
  );
}
