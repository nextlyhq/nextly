"use client";

/**
 * Blocks Field Summary
 *
 * A read-only account of what a blocks field currently holds: how many blocks
 * the page has and which types it uses.
 *
 * Editing happens in the page builder, not in the entry form, so this control
 * deliberately offers none. It exists so a blocks field on a form reads as a
 * populated part of the entry rather than an empty box or, worse, the unknown
 * field-type error the renderer shows for a type it has no case for.
 *
 * @module components/entries/fields/structured/BlocksSummary
 */

import type { BlockDocument } from "@nextlyhq/blocks-engine";
import { LayoutGrid } from "lucide-react";
import { useMemo } from "react";
import {
  useWatch,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";

import { countByType, documentNodes, totalBlocks } from "./page-summary";

export interface BlocksSummaryProps<
  TFieldValues extends FieldValues = FieldValues,
> {
  /** Field path this control reads from. */
  name: Path<TFieldValues>;
  /** React Hook Form control the entry form owns. */
  control: Control<TFieldValues>;
}

export function BlocksSummary<TFieldValues extends FieldValues = FieldValues>({
  name,
  control,
}: BlocksSummaryProps<TFieldValues>) {
  const value = useWatch({ control, name }) as BlockDocument | null | undefined;

  const counts = useMemo(() => countByType(documentNodes(value)), [value]);

  const total = useMemo(() => totalBlocks(counts), [counts]);

  if (total === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        <LayoutGrid className="size-4 shrink-0" aria-hidden="true" />
        <span>No blocks yet. Build this page in the page builder.</span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4">
      <div className="flex items-center gap-2 text-sm text-foreground">
        <LayoutGrid className="size-4 shrink-0" aria-hidden="true" />
        <span>
          {total} {total === 1 ? "block" : "blocks"}
        </span>
      </div>
      <ul className="mt-3 flex flex-wrap gap-1.5">
        {[...counts.entries()].map(([type, count]) => (
          <li
            key={type}
            className="rounded-sm border border-border bg-background px-2 py-0.5 font-mono text-xs text-muted-foreground"
          >
            {type}
            {count > 1 ? ` ×${count}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
