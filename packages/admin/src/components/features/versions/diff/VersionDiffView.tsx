/**
 * Compares two versions of a document.
 *
 * Fetches the server-computed diff for a version pair and renders it node by
 * node, with a "changed only" toggle that drops unchanged fields. Owns its own
 * scrolling body and fills the height its host gives it, so a host supplies a
 * box and this decides how the comparison sits in it.
 *
 * The columns each field row draws are a function of THIS element's width — it
 * declares the container the rows query — so the same view reads as a true
 * side-by-side wherever there is room for one and folds into a stack where
 * there is not.
 *
 * @module components/features/versions/diff/VersionDiffView
 */

import { useState } from "react";

import {
  Alert,
  AlertDescription,
  Button,
  Skeleton,
} from "@admin/components/ui";
import { useVersionDiff } from "@admin/hooks/queries/useVersions";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import type { VersionScope } from "@admin/services/versionApi";

import { childKey, FieldDiffNode } from "./FieldDiffNode";

export interface VersionDiffViewProps {
  scope: VersionScope;
  /** Older version being compared. */
  from: number;
  /** Newer version being compared. */
  to: number;
}

function DiffSkeleton() {
  return (
    <div className="p-4 flex flex-col gap-4" aria-busy="true">
      <span className="sr-only" role="status" aria-live="polite">
        Loading comparison
      </span>
      {[0, 1, 2].map(i => (
        <div key={i} className="flex flex-col gap-1.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-4 w-full" />
        </div>
      ))}
    </div>
  );
}

export function VersionDiffView({ scope, from, to }: VersionDiffViewProps) {
  const [modifiedOnly, setModifiedOnly] = useState(true);
  const diff = useVersionDiff({ scope, from, to, modifiedOnly });

  return (
    // The container the field rows query. Their columns are a function of the
    // width available HERE, not of the viewport: the same view sits in surfaces
    // of different widths, and only its own box knows whether two columns fit.
    <div className="@container/diff flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
        {/* Which pair is on screen. Hidden once the column headings below are
            showing, since those name the same two versions over the values they
            belong to, which says it better. */}
        <p className="text-sm text-muted-foreground @2xl/diff:hidden">
          Comparing version{" "}
          <span className="font-medium text-foreground">{from}</span> &rarr;{" "}
          <span className="font-medium text-foreground">{to}</span>
        </p>
        <Button
          className="ml-auto"
          variant={modifiedOnly ? "default" : "outline"}
          size="sm"
          aria-pressed={modifiedOnly}
          onClick={() => setModifiedOnly(v => !v)}
        >
          Changed only
        </Button>
      </div>

      {/* Column headings for the two sides, on the same grid and padding as
          each row's value pair so they sit over the columns they name. Outside
          the scrolling body rather than sticky within it, so a field far down a
          long document is still readable as belonging to one version or the
          other without a stacking context to get right. */}
      <div className="hidden grid-cols-2 gap-4 border-b border-border px-4 py-2 @2xl/diff:grid">
        <p className="pr-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Version {from}
        </p>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Version {to}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {diff.isLoading ? (
          <DiffSkeleton />
        ) : diff.isError ? (
          <div className="p-4 flex flex-col gap-3">
            <Alert variant="destructive">
              <AlertDescription>
                {apiErrorMessage(diff.error) ||
                  "This comparison could not be loaded."}
              </AlertDescription>
            </Alert>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void diff.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : diff.data && diff.data.fields.length === 0 ? (
          // Nothing to show: "Changed only" is on and no field changed. With the
          // filter off the response carries the unchanged fields, so the branch
          // below renders them instead of this message.
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              These two versions are identical.
            </p>
          </div>
        ) : diff.data ? (
          <div className="px-4">
            {!diff.data.hasChanges ? (
              <p className="py-3 text-sm text-muted-foreground">
                No changes between these versions.
              </p>
            ) : null}
            {diff.data.fields.map(node => (
              <FieldDiffNode key={childKey(node)} node={node} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
