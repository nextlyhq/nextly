"use client";

/**
 * "Show N unchanged fields": the fold every surface that lists a version's
 * changes keeps its unchanged fields behind, so the editor and the comparison
 * page fold alike.
 *
 * @module components/features/versions/UnchangedFieldsToggle
 */

import { ChevronDown, ChevronUp } from "lucide-react";
import type { JSX } from "react";

import { Button } from "@admin/components/ui";

export function UnchangedFieldsToggle({
  count,
  shown,
  onToggle,
}: {
  count: number;
  shown: boolean;
  onToggle: () => void;
}): JSX.Element | null {
  // Nothing to fold, so nothing to offer.
  if (count === 0) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="self-start"
      aria-expanded={shown}
      onClick={onToggle}
    >
      {shown ? (
        <ChevronUp className="h-4 w-4" aria-hidden="true" />
      ) : (
        <ChevronDown className="h-4 w-4" aria-hidden="true" />
      )}
      {shown ? "Hide" : "Show"} {count} unchanged{" "}
      {count === 1 ? "field" : "fields"}
    </Button>
  );
}
