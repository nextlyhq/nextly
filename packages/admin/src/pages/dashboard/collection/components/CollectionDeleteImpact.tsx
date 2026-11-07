/**
 * What deleting collections takes with it besides their own entries, listed
 * in the delete dialog before the confirm, under the name of each plugin that
 * holds something for them (`ctx.hooks.onCollectionDelete`).
 *
 * Asked each time the dialog opens, for exactly the collections it is about
 * to delete, and the confirm held until the answer arrives. Nothing to list
 * shows nothing. A failure to ask is said, not hidden, and does not stop the
 * delete: the server runs the plugins' removal with the delete whether or
 * not the list was seen.
 */
import { Alert, AlertDescription, Spinner } from "@nextlyhq/ui";
import { useQuery } from "@tanstack/react-query";
import type { JSX } from "react";

import { AlertTriangle } from "@admin/components/icons";
import {
  fetchCollectionDeleteImpact,
  type CollectionDeleteImpactGroup,
} from "@admin/services/collectionApi";

/** How many items of one plugin are listed before "...and N more". */
const MAX_VISIBLE_IMPACT = 10;

/** The impact groups as the dialog lists them. */
export function CollectionDeleteImpactList({
  groups,
}: {
  groups: readonly CollectionDeleteImpactGroup[];
}): JSX.Element | null {
  if (groups.length === 0) return null;
  return (
    <Alert variant="destructive" aria-label="Also deleted with it">
      <AlertTriangle className="h-4 w-4" />
      <AlertDescription>
        <p className="text-sm font-medium">Also deleted with it:</p>
        {groups.map(group => {
          const visible = group.items.slice(0, MAX_VISIBLE_IMPACT);
          const remaining = group.items.length - visible.length;
          return (
            <div
              key={group.plugin}
              role="list"
              aria-label={`Deleted by ${group.plugin}`}
              className="mt-2 space-y-1"
            >
              <p className="text-sm font-medium">{group.plugin}</p>
              {visible.map((item, index) => (
                <div
                  key={`${item.kind}:${item.label}:${index}`}
                  role="listitem"
                  className="text-sm"
                >
                  • <span className="font-medium">{item.label}</span> (
                  {item.kind})
                </div>
              ))}
              {remaining > 0 && (
                <p className="text-sm">...and {remaining} more</p>
              )}
            </div>
          );
        })}
      </AlertDescription>
    </Alert>
  );
}

/** What the delete dialog knows of the impact, as {@link useCollectionDeleteImpact} answers it. */
export interface CollectionDeleteImpactState {
  /**
   * Whether the answer for this opening is still on its way: the first ask,
   * or a fresh ask on reopening while an earlier answer is cached. The
   * dialog shows no list and holds its confirm until it settles, so what it
   * lists is never what an earlier opening was told.
   */
  resolving: boolean;
  /** Whether asking failed. */
  failed: boolean;
  /** The groups to list; none while resolving or after a failure. */
  groups: readonly CollectionDeleteImpactGroup[];
}

/** Ask what deleting `slugs` takes with it, while `enabled`. */
export function useCollectionDeleteImpact(
  slugs: readonly string[],
  enabled: boolean
): CollectionDeleteImpactState {
  const asking = enabled && slugs.length > 0;
  const impact = useQuery({
    queryKey: ["collections", "delete-impact", [...slugs]],
    queryFn: () => fetchCollectionDeleteImpact(slugs),
    enabled: asking,
    // Asked afresh each time the dialog opens: what a plugin holds changes.
    staleTime: 0,
    retry: false,
  });
  // A refetch with an earlier answer cached is not settled: TanStack Query
  // serves the cached answer meanwhile, which may describe another moment.
  const resolving = asking && (impact.isPending || impact.isFetching);
  return {
    resolving,
    failed: asking && !resolving && impact.isError,
    groups: asking && !resolving && impact.isSuccess ? impact.data : [],
  };
}

/** The impact as the dialog shows it: asking, failed, or the list. */
export function CollectionDeleteImpact({
  impact,
}: {
  impact: CollectionDeleteImpactState;
}): JSX.Element | null {
  if (impact.resolving) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner size="sm" />
        Checking what else this deletes…
      </p>
    );
  }
  if (impact.failed) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Could not check what else this deletes. Plugins still remove what they
          hold for it with the delete.
        </AlertDescription>
      </Alert>
    );
  }
  return <CollectionDeleteImpactList groups={impact.groups} />;
}
