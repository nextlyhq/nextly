"use client";

/**
 * Previous and next change, shared by every surface that walks a version's
 * changes, so the editor and the comparison page move the same way.
 *
 * @module components/features/versions/ChangeNav
 */

import { ArrowDown, ArrowUp } from "lucide-react";

import { Button } from "@admin/components/ui";
import { cn } from "@admin/lib/utils";

/**
 * Previous and next change, with where the reader is. The editor's bar hides
 * it on a phone, where the same moves sit in the bottom bar under the thumb;
 * the comparison page shows it at every width.
 */
export function ChangeNav({
  changed,
  position,
  onMove,
  className,
}: {
  changed: number;
  position: number;
  onMove: (delta: -1 | 1) => void;
  /** Where it shows: the editor's bar hides it on a phone, for instance. */
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <span className="text-muted-foreground" aria-hidden="true">
        Change {position + 1} of {changed}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="px-2"
        aria-label="Previous change"
        title="Previous change"
        disabled={changed < 2}
        onClick={() => onMove(-1)}
      >
        <ArrowUp className="h-4 w-4" aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="px-2"
        aria-label="Next change"
        title="Next change"
        disabled={changed < 2}
        onClick={() => onMove(1)}
      >
        <ArrowDown className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
