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
} from "@admin/components/ui";
import { useVersion, useVersions } from "@admin/hooks/queries/useVersions";
import type { VersionScope } from "@admin/services/versionApi";

import { VersionPreview } from "./VersionPreview";
import { VersionRow } from "./VersionRow";

export interface VersionHistorySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: VersionScope;
  /** Current schema fields, used to render a snapshot. */
  fields: FieldConfig[];
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
}: VersionHistorySheetProps) {
  const [selected, setSelected] = useState<number | null>(null);

  // Reopening the panel should start at the list. Without this the previously
  // previewed version would still be showing, which reads as a stale panel.
  useEffect(() => {
    if (!open) setSelected(null);
  }, [open]);

  const list = useVersions({ scope, enabled: open });
  const detail = useVersion({ scope, versionNo: selected, enabled: open });

  const versions = list.data?.pages.flatMap(page => page.items) ?? [];
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
                  onSelect={setSelected}
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelected(null)}
            >
              Back to history
            </Button>
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
    </Sheet>
  );
}
