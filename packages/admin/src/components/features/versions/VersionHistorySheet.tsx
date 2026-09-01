/**
 * A document's version history, as a right-side panel.
 *
 * Preview is a mode inside this panel rather than a second sheet: the editor is
 * looking at one thing — this document's history — and nesting dialogs would
 * trap focus twice for what is conceptually a step, not a new context.
 *
 * Comparing is the exception, and for a reason about geometry rather than about
 * navigation. A comparison is two columns of field values; this panel is 480px
 * wide, which cannot hold two, so hosting it here forced the diff to stack.
 * `VersionCompareDialog` gives it a surface sized for the job, mounted from
 * here on the same terms as the restore and rename dialogs.
 *
 * @module components/features/versions/VersionHistorySheet
 */

import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

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
import { RestoreConfirmDialog } from "./RestoreConfirmDialog";
import { predecessorOf, sameLocaleVersions } from "./version-pairing";
import { VersionCompareDialog } from "./VersionCompareDialog";
import { versionsHref } from "./VersionComparePage";
import { VersionLabelDialog } from "./VersionLabelDialog";
import { VersionLocaleFilter } from "./VersionLocaleFilter";
import { VersionRow } from "./VersionRow";

// How many extra history pages the panel will auto-fetch while searching for a
// previewed version's previous same-locale version before deferring to the
// manual "Load more" control. Bounds the search in a long, retention-disabled,
// multi-locale history where a lone-locale row would otherwise page to the end.
const MAX_AUTO_PREVIOUS_PAGES = 3;

/**
 * The panel's width, and the one place it is stated.
 *
 * Both the element's own width and the space the layout keeps clear for it are
 * taken from here. Two literals would agree on the day they were written and
 * disagree the day one of them is changed, and the failure that follows is
 * silent: the page is indented by one number while the panel occupies another,
 * so a strip of the document is drawn under the panel and its controls stop
 * responding without appearing to have changed.
 */
const PANEL_WIDTH = 480;

/**
 * The narrowest window that can hold the panel BESIDE the document.
 *
 * `PANEL_WIDTH` plus 720, which is what is left for everything else: the
 * navigation rail takes about 256 of it, leaving the document a little over
 * 460 — narrow, and still a document rather than a column of wrapped words.
 * Below this the panel covers the page and is modal instead.
 */
const PANEL_MIN_WINDOW = PANEL_WIDTH + 720;

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
}: VersionHistorySheetProps) {
  const [selected, setSelected] = useState<number | null>(null);
  // The version pair being compared (older -> newer), or null when not
  // comparing. Comparing opens a dialog over this panel rather than replacing
  // its body, so the panel stays in whichever of its two states it was in and
  // is there again on dismiss.
  const [comparing, setComparing] = useState<{
    from: number;
    to: number;
  } | null>(null);
  const [confirmingRestore, setConfirmingRestore] = useState(false);
  // The version being renamed, which is not necessarily the one being previewed
  // — an editor can name a row without opening it.
  const [renaming, setRenaming] = useState<number | null>(null);
  // Active locale filter for the listing, or undefined for every locale. Only
  // meaningful for a localized document; the filter control hides otherwise.
  const [localeFilter, setLocaleFilter] = useState<string | undefined>(
    undefined
  );

  // Reopening the panel should start at the list. Without this the previously
  // previewed version would still be showing, which reads as a stale panel.
  useEffect(() => {
    if (!open) {
      setSelected(null);
      setComparing(null);
      setConfirmingRestore(false);
      // The rename dialog is mounted outside the panel, so closing the panel
      // does not close it. Left set, it would stay on screen over a dismissed
      // panel, or reappear the moment the panel was reopened.
      setRenaming(null);
      // Start every open showing all locales rather than a filter left from a
      // previous document.
      setLocaleFilter(undefined);
    }
  }, [open]);

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
    setSelected(null);
    setComparing(null);
    setConfirmingRestore(false);
    setRenaming(null);
    // A different document may not have the previously filtered locale at all,
    // so the filter resets with the rest of the panel's per-document state.
    setLocaleFilter(undefined);
  }

  const list = useVersions({ scope, enabled: open, locale: localeFilter });
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

  // Hand the chosen version to the document area, and take it back whenever
  // nothing is chosen — including when the panel closes, so dismissing it never
  // strands the editor on a version it can no longer see the list for.
  const { setViewing, setRestore } = useDocumentHistory();
  const viewedSnapshot = detail.data?.snapshot;
  const viewedLocale = detail.data?.locale ?? null;
  const viewedLoading = detail.isLoading;
  const viewedError = detail.error ?? null;
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
      isLoading: viewedLoading,
      error: viewedError,
    });
  }, [
    open,
    selected,
    viewedSnapshot,
    viewedLocale,
    viewedLoading,
    viewedError,
    setViewing,
  ]);

  // Returning to the live document from the banner clears the selection here
  // too, so the list stops showing a row as active for a version that is no
  // longer on screen.
  useEffect(() => {
    if (!open) return;
    return () => setViewing(null);
  }, [open, setViewing]);

  // Restoring is offered from the banner in the document, which is where the
  // reader is looking — but it stays THIS component's mutation, guarded by
  // this component's confirmation. Only the trigger travels.
  const requestRestore = useCallback(() => setConfirmingRestore(true), []);
  // Clears this panel's own selection as well as the shared one, so the list
  // stops marking a row active for a version that is no longer on screen.
  const returnToCurrent = useCallback(() => setSelected(null), []);
  useEffect(() => {
    if (!open || selected === null) {
      setRestore(null);
      return;
    }
    setRestore({ canRestore, request: requestRestore, returnToCurrent });
    // Withdrawn on unmount as well as on close: a banner left holding a
    // trigger into an unmounted panel would open a dialog nothing renders.
    return () => setRestore(null);
  }, [open, selected, canRestore, requestRestore, returnToCurrent, setRestore]);

  const restore = useRestoreVersion({
    scope,
    onSuccess: result => {
      setConfirmingRestore(false);
      onOpenChange(false);
      // A restore can succeed while leaving parts behind, when the schema no
      // longer has a field the version held. Saying so beats a clean success
      // message that overstates what came back.
      if (result.droppedFields.length > 0) {
        toast.success(
          `Restored version ${result.restoredFrom}. ` +
            `${result.droppedFields.length} field(s) no longer in this schema were skipped: ` +
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
  // either way. When the flag is not supplied, fall back to inferring it — any
  // locale present in the history, or an active filter (which could not have
  // been set on a non-localized document).
  const isLocalizedDocument =
    entityLocalized ??
    (localeFilter !== undefined || versions.some(v => v.locale !== null));

  // Compare targets for the version being previewed. A comparison must stay
  // within one locale (the server rejects a cross-locale pair), so both the
  // "current" and "previous" targets are drawn only from versions sharing the
  // selected row's locale. "Previous" is the next-older row in that set, not
  // `selected - 1`, since retention can leave gaps in the numbering.
  const localeVersions =
    selected === null ? [] : sameLocaleVersions(versions, selected);
  const latestVersionNo = localeVersions[0]?.versionNo ?? null;
  // The comparison page's rail asks this same question, so it is answered in
  // one place. Passing `false` for "more pages exist" is deliberate here: this
  // panel pages forward on its own below until the previous target resolves or
  // the history runs out, so by the time this is read an absent predecessor
  // means there is none rather than that none has loaded.
  const previousTarget =
    selected === null ? null : predecessorOf(versions, selected, false);
  const previousVersionNo =
    previousTarget?.kind === "version" ? previousTarget.versionNo : null;
  // The previewed version must still be in the refreshed list. Retention can
  // prune it out from under the preview (a save in another tab, then a focus
  // refetch), and comparing a version that no longer exists would request a diff
  // whose `from` 404s.
  const selectedPresent =
    selected !== null && versions.some(v => v.versionNo === selected);
  // "Current" is only offered once the list has revalidated: reopening after a
  // save serves the cached head while `staleTime: 0` refetches, and comparing
  // against that stale head would mislabel an outdated version as current. A
  // failed revalidation clears `isRefetching` but leaves the head stale, so
  // `isRefetchError` keeps the action disabled until a fetch succeeds.
  const canCompareCurrent =
    selectedPresent &&
    latestVersionNo !== null &&
    selected !== latestVersionNo &&
    !isRefetching &&
    !isRefetchError;
  // Same freshness gate as "current": a stale or failed revalidation could point
  // "previous" at a version retention has already pruned, 404-ing the diff.
  const canComparePrevious =
    selectedPresent &&
    previousVersionNo !== null &&
    !isRefetching &&
    !isRefetchError;

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
    // refreshing the stale head, both re-enabling "Compare with current" against
    // a stale head. Paging resumes once a revalidation succeeds.
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

  /*
   * The claim, and the ONE fact both behaviours below are derived from. A panel
   * that is reserved is beside the document, so the document stays live and
   * only the explicit controls close it; a panel that is not is over the
   * document, so it is modal and says so. Deciding those separately is how a
   * panel ends up non-modal with nothing having made room for it, which leaves
   * every control underneath it visible, enabled and inert.
   */
  useReserveSidePanel(open && roomBeside ? PANEL_WIDTH : null);

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
    <Sheet open={open} onOpenChange={onOpenChange} modal={!roomBeside}>
      <SheetContent
        side="right"
        className="p-0 flex flex-col"
        // Width from the same constant the reservation is made with, so the
        // space kept clear cannot drift from the space taken. Capped at the
        // window because the panel is wider than a phone.
        style={{ width: `min(${PANEL_WIDTH}px, 100vw)`, maxWidth: "100vw" }}
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
            <SheetTitle>
              {selected === null ? "Version history" : `Version ${selected}`}
            </SheetTitle>
            {/* Locale filter, only while browsing the list (a chosen version is
                already locale-fixed) and only for a document whose own history
                carries locales — so it never appears on a non-localized
                document in an otherwise localized app. */}
            <div className="flex items-center gap-1">
              {selected === null && isLocalizedDocument && (
                <VersionLocaleFilter
                  value={localeFilter}
                  onChange={locale => {
                    // Changing the visible locale set can drop the previewed or
                    // compared version out of view, so clear both modes.
                    setLocaleFilter(locale);
                    setSelected(null);
                    setComparing(null);
                  }}
                />
              )}
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
                  aria-label="Close"
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
        {isRefetchError && versions.length > 0 ? (
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
                  disabled={isRefetching}
                  onClick={() => void list.refetch()}
                >
                  {isRefetching ? "Retrying…" : "Try again"}
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
          {list.isLoading ? (
            <ListSkeleton />
          ) : list.isError && versions.length === 0 ? (
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => void list.refetch()}
              >
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
              {versions.map(version => (
                <VersionRow
                  key={version.id}
                  version={version}
                  active={selected === version.versionNo}
                  onSelect={setSelected}
                  // Renaming writes to the document's history, which needs the
                  // same permission restoring does. Offering it to a read-only
                  // caller would open a dialog whose save the route rejects.
                  onRename={canRestore ? setRenaming : undefined}
                />
              ))}

              {hasNextPage ? (
                <div className="p-4">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    // Disabled while the head is revalidating or its revalidation
                    // failed: `fetchNextPage` would otherwise cancel the refetch
                    // or clear the error, leaving a stale head trusted as current.
                    disabled={
                      isFetchingNextPage || isRefetching || isRefetchError
                    }
                    onClick={() => void fetchNextPage()}
                  >
                    {isFetchingNextPage ? "Loading…" : "Load more"}
                  </Button>
                </div>
              ) : null}
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
        {selected !== null ? (
          <div className="p-4 border-t border-border flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelected(null)}
            >
              Back to history
            </Button>
            {/* Compare is offered from the preview, where a version is already
                  chosen: against the one before it, and against the current. */}
            {/* The full comparison, on a page of its own. The dialog below
                stays for a quick look without leaving the document; this is
                for reading a change properly, and its address names the pair
                so it can be shared. */}
            {/* Only offered once the pair it would open is known. Omitting the
                pair does not open "this version with nothing"; the destination
                reads an absent pair as the two NEWEST versions, so the control
                would silently show a comparison the reader did not ask for. */}
            {canComparePrevious && previousVersionNo !== null ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  navigateTo(
                    versionsHref(
                      scope,
                      { from: previousVersionNo, to: selected },
                      // The SELECTED version's language, not the sheet's
                      // filter: the filter says which rows are listed, while
                      // this says which text the pair being opened actually
                      // holds — and that is what the destination must name the
                      // document in.
                      versions.find(v => v.versionNo === selected)?.locale
                    )
                  )
                }
              >
                Open full comparison
              </Button>
            ) : null}
            {canComparePrevious && previousVersionNo !== null ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setComparing({ from: previousVersionNo, to: selected })
                }
              >
                Compare with previous
              </Button>
            ) : null}
            {canCompareCurrent && latestVersionNo !== null ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setComparing({ from: selected, to: latestVersionNo })
                }
              >
                Compare with current
              </Button>
            ) : null}
            {/* Restoring is offered in the BANNER over the version being
                  read, not here. The panel only ever offered it while a
                  version was selected, which is exactly when the banner is on
                  screen — so a button here would be a second control with the
                  same label, and the further one from what it acts on. This
                  component still owns the mutation and its confirmation; the
                  banner holds the trigger. */}
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
          isRestoring={restore.isPending}
          onConfirm={() => restore.mutate(selected)}
        />
      ) : null}

      {/* Mounted on the same terms as the restore dialog. Its own body is far
          wider than this panel, which is the whole reason a comparison is not a
          mode of the panel. */}
      {comparing !== null ? (
        <VersionCompareDialog
          open
          onOpenChange={open => {
            // Dismissing returns to the version that was on screen, not the
            // list: the panel behind was never navigated away from.
            if (!open) setComparing(null);
          }}
          scope={scope}
          from={comparing.from}
          to={comparing.to}
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
  );
}
