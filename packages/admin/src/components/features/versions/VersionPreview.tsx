/**
 * One stored version rendered read-only.
 *
 * Every field in the current schema is rendered, including ones the snapshot
 * has no value for: an editor comparing versions needs to see that a field was
 * blank then, which omitting it would hide.
 *
 * @module components/features/versions/VersionPreview
 */

import type { FieldConfig } from "nextly/config";

import { FieldValueDisplay } from "@admin/components/features/versions/value-display/FieldValueDisplay";
import { Alert, AlertDescription, Skeleton } from "@admin/components/ui";

export interface VersionPreviewProps {
  versionNo: number;
  fields: FieldConfig[];
  snapshot: unknown;
  isLoading?: boolean;
  error?: Error | null;
}

function PreviewSkeleton() {
  return (
    <div className="p-4 flex flex-col gap-4" aria-busy="true">
      <span className="sr-only" role="status" aria-live="polite">
        Loading version
      </span>
      {[0, 1, 2, 3].map(i => (
        <div key={i} className="flex flex-col gap-1">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-5 w-full" />
        </div>
      ))}
    </div>
  );
}

export function VersionPreview({
  versionNo,
  fields,
  snapshot,
  isLoading = false,
  error = null,
}: VersionPreviewProps) {
  if (isLoading) return <PreviewSkeleton />;

  if (error) {
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertDescription>This version could not be loaded.</AlertDescription>
        </Alert>
      </div>
    );
  }

  const values =
    typeof snapshot === "object" && snapshot !== null
      ? (snapshot as Record<string, unknown>)
      : {};

  return (
    <div className="flex flex-col">
      <div className="px-4 py-2 bg-primary/5 border-b border-border">
        <p className="text-sm text-foreground">
          Viewing version {versionNo}. This is a past state of the document, not
          what is live.
        </p>
      </div>

      <div className="p-4 flex flex-col gap-4">
        {fields.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This document has no fields to show.
          </p>
        ) : (
          fields.map(field =>
            field.name ? (
              <FieldValueDisplay
                key={field.name}
                field={field}
                value={values[field.name]}
              />
            ) : null
          )
        )}
      </div>
    </div>
  );
}
