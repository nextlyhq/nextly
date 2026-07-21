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
import { useEffect, useState } from "react";

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

import { RestoreConfirmDialog } from "./RestoreConfirmDialog";
import { VersionLabelDialog } from "./VersionLabelDialog";
import { VersionPreview } from "./VersionPreview";
import { VersionRow } from "./VersionRow";

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
    }
  }, [open]);

  const list = useVersions({ scope, enabled: open });
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
            {selected === null ? "Version history" : `Version ${selected}`}
          </SheetTitle>
          <SheetDescription className="sr-only">
            Past versions of this document, newest first.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {selected !== null ? (
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
          ) : list.isError ? (
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
                  onRename={setRenaming}
                />
              ))}

              {list.hasNextPage ? (
                <div className="p-4">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    disabled={list.isFetchingNextPage}
                    onClick={() => void list.fetchNextPage()}
                  >
                    {list.isFetchingNextPage ? "Loading…" : "Load more"}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="p-4 border-t border-border flex items-center gap-2">
          {selected !== null ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelected(null)}
              >
                Back to history
              </Button>
              {/* Offered only from the preview: restoring is easier to get
                  right having seen what the version actually holds. */}
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
