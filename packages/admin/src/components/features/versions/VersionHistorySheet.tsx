/**
 * A document's version history, as a right-side panel.
 *
 * Preview is a mode inside this panel rather than a second sheet: the editor is
 * looking at one thing — this document's history — and nesting dialogs would
 * trap focus twice for what is conceptually a step, not a new context.
 *
 * @module components/features/versions/VersionHistorySheet
 */

import type { FieldConfig } from "nextly/config";
import { useEffect, useRef, useState } from "react";

import {
  Alert,
  AlertDescription,
  Button,
  Sheet,
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
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import type { VersionScope } from "@admin/services/versionApi";

import { VersionDiffView } from "./diff/VersionDiffView";
import { RestoreConfirmDialog } from "./RestoreConfirmDialog";
import { VersionLabelDialog } from "./VersionLabelDialog";
import { VersionPreview } from "./VersionPreview";
import { VersionRow } from "./VersionRow";

// How many extra history pages the panel will auto-fetch while searching for a
// previewed version's previous same-locale version before deferring to the
// manual "Load more" control. Bounds the search in a long, retention-disabled,
// multi-locale history where a lone-locale row would otherwise page to the end.
const MAX_AUTO_PREVIOUS_PAGES = 3;

export interface VersionHistorySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: VersionScope;
  /** Current schema fields, used to render a snapshot. */
  fields: FieldConfig[];
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
  fields,
  canRestore = false,
  liveStatus = null,
}: VersionHistorySheetProps) {
  const [selected, setSelected] = useState<number | null>(null);
  // The version pair being compared (older -> newer), or null when not
  // comparing. Compare is a third mode of the panel alongside list and preview.
  const [comparing, setComparing] = useState<{
    from: number;
    to: number;
  } | null>(null);
  const [confirmingRestore, setConfirmingRestore] = useState(false);
  // The version being renamed, which is not necessarily the one being previewed
  // — an editor can name a row without opening it.
  const [renaming, setRenaming] = useState<number | null>(null);

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
    }
  }, [open]);

  // Identity of the document this sheet is bound to, as a stable string so a
  // re-created `scope` object with the same target does not read as a change.
  const scopeId =
    scope.kind === "single"
      ? `single:${scope.slug}:${scope.documentId ?? ""}`
      : `collection:${scope.slug}:${scope.entryId ?? ""}`;

  // Reset every mode when the document changes under a still-open sheet: the
  // custom admin router can navigate between entries without unmounting, and a
  // surviving `selected`/`comparing` would request the new document's versions
  // and (via keepPreviousData) briefly show the previous document's diff.
  useEffect(() => {
    setSelected(null);
    setComparing(null);
    setConfirmingRestore(false);
    setRenaming(null);
  }, [scopeId]);

  const list = useVersions({ scope, enabled: open });
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

  // Compare targets for the version being previewed. A comparison must stay
  // within one locale (the server rejects a cross-locale pair), so both the
  // "current" and "previous" targets are drawn only from versions sharing the
  // selected row's locale. "Previous" is the next-older row in that set, not
  // `selected - 1`, since retention can leave gaps in the numbering.
  const selectedLocale =
    selected === null
      ? null
      : (versions.find(v => v.versionNo === selected)?.locale ?? null);
  const sameLocaleVersions =
    selected === null
      ? []
      : versions.filter(
          v => v.versionNo !== null && (v.locale ?? null) === selectedLocale
        );
  const latestVersionNo = sameLocaleVersions[0]?.versionNo ?? null;
  const sameLocaleIndex = sameLocaleVersions.findIndex(
    v => v.versionNo === selected
  );
  const previousVersionNo =
    sameLocaleIndex >= 0
      ? (sameLocaleVersions[sameLocaleIndex + 1]?.versionNo ?? null)
      : null;
  // "Current" is only offered once the list has revalidated: reopening after a
  // save serves the cached head while `staleTime: 0` refetches, and comparing
  // against that stale head would mislabel an outdated version as current. A
  // failed revalidation clears `isRefetching` but leaves the head stale, so
  // `isRefetchError` keeps the action disabled until a fetch succeeds.
  const canCompareCurrent =
    selected !== null &&
    latestVersionNo !== null &&
    selected !== latestVersionNo &&
    !isRefetching &&
    !isRefetchError;
  const canComparePrevious = selected !== null && previousVersionNo !== null;

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
    // Wait out a head revalidation before paging: `fetchNextPage` defaults to
    // `cancelRefetch: true`, so firing it mid-revalidation would silently cancel
    // the refetch and leave a stale head that "Compare with current" would then
    // trust.
    if (isRefetching) return;
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[480px] sm:max-w-[480px] p-0 flex flex-col"
      >
        <SheetHeader className="p-4 border-b border-border">
          <SheetTitle>
            {comparing !== null
              ? `Compare ${comparing.from} → ${comparing.to}`
              : selected === null
                ? "Version history"
                : `Version ${selected}`}
          </SheetTitle>
          <SheetDescription className="sr-only">
            Past versions of this document, newest first.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {comparing !== null ? (
            // Keyed by the pair so a different comparison always mounts fresh,
            // and `keepPreviousData` can never carry one pair's fields into
            // another while the new diff loads.
            <VersionDiffView
              key={`${comparing.from}-${comparing.to}`}
              scope={scope}
              from={comparing.from}
              to={comparing.to}
            />
          ) : selected !== null ? (
            <VersionPreview
              versionNo={selected}
              fields={fields}
              snapshot={detail.data?.snapshot}
              isLoading={detail.isLoading}
              error={detail.error}
              onRetry={() => void detail.refetch()}
              locale={detail.data?.locale ?? null}
            />
          ) : list.isLoading ? (
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
              <p className="text-sm text-muted-foreground">
                No versions recorded for this document yet.
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
                    // Disabled during a head revalidation too: `fetchNextPage`
                    // would otherwise cancel it and leave a stale head.
                    disabled={isFetchingNextPage || isRefetching}
                    onClick={() => void fetchNextPage()}
                  >
                    {isFetchingNextPage ? "Loading…" : "Load more"}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="p-4 border-t border-border flex flex-wrap items-center gap-2">
          {comparing !== null ? (
            // Compare returns to the version that was on screen, not the list.
            <Button
              variant="outline"
              size="sm"
              onClick={() => setComparing(null)}
            >
              Back
            </Button>
          ) : selected !== null ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelected(null)}
              >
                Back to history
              </Button>
              {/* Compare is offered from the preview, where a version is already
                  chosen: against the one before it, and against the current. */}
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
              {/* Available only once the snapshot is on screen: restoring is
                  offered from the preview so the choice is made having seen
                  what the version holds, which a skeleton or an error is not. */}
              {canRestore ? (
                <Button
                  size="sm"
                  onClick={() => setConfirmingRestore(true)}
                  disabled={
                    restore.isPending ||
                    detail.isLoading ||
                    Boolean(detail.error) ||
                    detail.data === undefined
                  }
                >
                  Restore this version
                </Button>
              ) : null}
            </>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </div>
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
