"use client";

/**
 * Previous and next change, shared by every surface that walks a version's
 * changes, so the editor and the comparison page move the same way.
 *
 * @module components/features/versions/ChangeNav
 */

import { ArrowDown, ArrowUp } from "lucide-react";
import type { JSX } from "react";
import { useState } from "react";

import { Button } from "@admin/components/ui";
import { cn } from "@admin/lib/utils";

/**
 * Previous and next change, with where the reader is. The editor's bar hides
 * it on a phone, where the same moves sit in the bottom bar under the thumb;
 * the comparison page shows it at every width.
 */
/**
 * Where a move between changes landed, told to assistive technology: focus moves to the field
 * silently, so this is how a screen reader hears the place. Says nothing until the person moves:
 * on arrival the page already says how many fields changed. Shared by every control that moves
 * between changes, so each says it alike.
 */
export function ChangeMoveStatus({
  moved,
  position,
  changed,
  currentLabel,
}: {
  moved: boolean;
  position: number;
  changed: number;
  currentLabel?: string;
}): JSX.Element {
  return (
    <span role="status" aria-live="polite" className="sr-only">
      {moved
        ? `Change ${position + 1} of ${changed}${currentLabel ? `: ${currentLabel}` : ""}`
        : ""}
    </span>
  );
}

export function ChangeNav({
  changed,
  position,
  onMove,
  currentLabel,
  className,
}: {
  changed: number;
  position: number;
  onMove: (delta: -1 | 1) => void;
  /** The change the position is on, named as its field is ("SEO › Meta title"). */
  currentLabel?: string;
  /** Where it shows: the editor's bar hides it on a phone, for instance. */
  className?: string;
}): JSX.Element {
  // Said only once the person moves: on arrival the page already says how
  // many fields changed, and repeating it would talk over that.
  const [moved, setMoved] = useState(false);
  const move = (delta: -1 | 1): void => {
    setMoved(true);
    onMove(delta);
  };
  const where = `Change ${position + 1} of ${changed}`;
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <span className="text-muted-foreground" aria-hidden="true">
        {where}
      </span>
      <ChangeMoveStatus
        moved={moved}
        position={position}
        changed={changed}
        currentLabel={currentLabel}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="px-2"
        aria-label="Previous change"
        title="Previous change"
        disabled={changed < 2}
        onClick={() => move(-1)}
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
        onClick={() => move(1)}
      >
        <ArrowDown className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
