/**
 * The pieces every diff renderer draws with.
 *
 * Extracted so the per-kind renderers can reach them without importing
 * `FieldDiffNode`, which imports the registry those renderers register into —
 * a cycle. Nothing here knows about any particular node kind.
 *
 * @module components/features/versions/diff/diff-primitives
 */

import { Badge } from "@admin/components/ui";
import type {
  ComparableStatus,
  FieldDiff,
  TextSegment,
} from "@admin/services/versionApi";

export type DiffStatus = FieldDiff["status"];

/**
 * Re-exported rather than redeclared. The engine owns what statuses exist, and
 * a second union here would let a server-side change leave these badges and the
 * renderer props silently out of step with what actually arrives.
 */
export type { ComparableStatus };

const STATUS_BADGE: Record<
  ComparableStatus,
  {
    variant: "success" | "destructive" | "warning" | "outline";
    label: string;
  }
> = {
  added: { variant: "success", label: "Added" },
  removed: { variant: "destructive", label: "Removed" },
  changed: { variant: "warning", label: "Changed" },
  unchanged: { variant: "outline", label: "Unchanged" },
  // Outline rather than a semantic colour: a refusal is not a severity, and
  // painting it like a change would assert something about content nobody read.
  unsupported: { variant: "outline", label: "Not comparable" },
};

export function StatusBadge({ status }: { status: ComparableStatus }) {
  const badge = STATUS_BADGE[status];
  return <Badge variant={badge.variant}>{badge.label}</Badge>;
}

/** A labelled block wrapping one field's diff. */
export function FieldRow({
  label,
  status,
  children,
}: {
  label: string;
  status: ComparableStatus;
  children: React.ReactNode;
}) {
  return (
    <div className="py-2.5 border-b border-border last:border-b-0">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          {label}
        </span>
        <StatusBadge status={status} />
      </div>
      <div className="text-sm text-foreground">{children}</div>
    </div>
  );
}

export function TextSegmentSpan({ segment }: { segment: TextSegment }) {
  if (segment.op === 0) return <span>{segment.text}</span>;
  if (segment.op === 1) {
    return (
      <ins className="rounded-sm px-0.5 no-underline bg-success-100 text-success-700 dark:bg-success-900 dark:text-success-100">
        {segment.text}
      </ins>
    );
  }
  return (
    <del className="rounded-sm px-0.5 bg-destructive-100 text-destructive-700 dark:bg-destructive-900 dark:text-destructive-100">
      {segment.text}
    </del>
  );
}

/** One sequence of text-diff runs as a paragraph of marked spans. */
export function TextRuns({ segments }: { segments: readonly TextSegment[] }) {
  return (
    <p className="whitespace-pre-wrap break-words leading-relaxed">
      {segments.map((segment, index) => (
        <TextSegmentSpan key={index} segment={segment} />
      ))}
    </p>
  );
}

/**
 * What a reader is told when the comparison could not be made.
 *
 * Stated in the reader's own terms and pointing somewhere useful, because the
 * alternative — silence — is indistinguishable from "nothing changed", which is
 * the conclusion this whole state exists to prevent.
 */
export function NotComparable({ what }: { what: string }) {
  return (
    <p className="text-xs italic text-muted-foreground">
      This {what} uses a format the comparison does not understand. Open the
      version to read it.
    </p>
  );
}
