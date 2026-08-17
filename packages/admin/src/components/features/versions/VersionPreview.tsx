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

import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Skeleton,
} from "@admin/components/ui";

import { VersionSnapshotForm } from "./VersionSnapshotForm";

export interface VersionPreviewProps {
  versionNo: number;
  fields: FieldConfig[];
  snapshot: unknown;
  isLoading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  /** The locale this version was captured in, when the document is localized. */
  locale?: string | null;
  /** The version this one was restored from, when it is a restore; else null. */
  sourceVersionNo?: number | null;
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
  onRetry,
  locale = null,
  sourceVersionNo = null,
}: VersionPreviewProps) {
  if (isLoading) return <PreviewSkeleton />;

  if (error) {
    return (
      <div className="p-4 flex flex-col gap-3">
        <Alert variant="destructive">
          <AlertDescription>This version could not be loaded.</AlertDescription>
        </Alert>
        {/* Retried in place: the alternative is going back and reopening the
            same version, which is the same request with extra steps. */}
        {onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="px-4 py-2 bg-primary/5 border-b border-border flex flex-wrap items-center gap-2">
        <p className="text-sm text-foreground">
          Viewing version {versionNo}
          {/* A localized document captures a version per locale, so the banner
              names which translation this one holds. */}
          {locale ? ` (${locale})` : ""}. This is a past state of the document,
          not what is live.
        </p>
        {/* Lineage, mirroring the row chip: a restored version names the one it
            was made from. */}
        {sourceVersionNo !== null && (
          <Badge variant="default">Restored from v{sourceVersionNo}</Badge>
        )}
      </div>

      <div className="p-4">
        {fields.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This document has no fields to show.
          </p>
        ) : (
          // Drawn by the editor's own components rather than a viewer of its
          // own. Layout fields, nameless groups and every type's presentation
          // then come from one place, so a version reads the way the document
          // reads — and a new field type is supported here the day it renders
          // in the editor, with nothing to keep in step.
          <VersionSnapshotForm fields={fields} snapshot={snapshot} />
        )}
      </div>
    </div>
  );
}
