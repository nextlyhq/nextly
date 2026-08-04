/**
 * Compares two versions inside the history panel.
 *
 * Fetches the server-computed diff for a version pair and renders it node by
 * node. A "changed only" toggle drops unchanged fields; the whole thing is a
 * mode of the history sheet rather than a separate dialog, matching preview.
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
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
        <p className="text-sm text-muted-foreground">
          Comparing version{" "}
          <span className="font-medium text-foreground">{from}</span> &rarr;{" "}
          <span className="font-medium text-foreground">{to}</span>
        </p>
        <Button
          variant={modifiedOnly ? "default" : "outline"}
          size="sm"
          aria-pressed={modifiedOnly}
          onClick={() => setModifiedOnly(v => !v)}
        >
          Changed only
        </Button>
      </div>

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
  );
}
