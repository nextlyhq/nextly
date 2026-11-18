"use client";

/**
 * Under a set's Header (or Footer) picker, when the component it names is
 * also used by other sets: "Also used by <set>", with "Make a separate copy",
 * which copies the component (its published definition, recording where the
 * copy came from) and puts the copy in this set's area only. The other sets
 * keep the original; this set's form holds the copy until its own Save and
 * Publish store it.
 *
 * @module admin/editor/set-separate-copy
 */
import type { RegionArea } from "@nextlyhq/blocks-engine";
import { Button, toast } from "@nextlyhq/ui";
import { useState, type JSX } from "react";

import type { LayoutChoice } from "../../layout-choices-contract";
import { useDuplicate } from "../component-actions-client";

/**
 * The other sets whose published header or footer is `componentId`, by
 * title, as the choices read lists them: every set but `setId`.
 */
export function otherSetsUsing(
  sets: readonly LayoutChoice[],
  setId: string,
  componentId: string | undefined
): string[] {
  if (componentId === undefined) return [];
  return sets
    .filter(
      set =>
        set.id !== setId &&
        set.regions.some(region => region.componentId === componentId)
    )
    .map(set => set.title);
}

/** "Also used by Landing", "Also used by Landing and Promo", and so on. */
export function alsoUsedByWords(titles: readonly string[]): string {
  const [first, ...rest] = titles;
  if (rest.length === 0) return `Also used by ${first ?? ""}`;
  if (rest.length === 1) return `Also used by ${first} and ${rest[0]}`;
  return `Also used by ${first} and ${String(rest.length)} other sets`;
}

export function SeparateCopy({
  area,
  componentId,
  usedBy,
  disabled,
  onCopied,
}: {
  area: RegionArea;
  /** The component the area names now. */
  componentId: string;
  /** The other sets using it, by title; none draws nothing. */
  usedBy: readonly string[];
  disabled: boolean;
  /** Puts the copy in this set's area. */
  onCopied: (copy: { readonly id: string; readonly title: string }) => void;
}): JSX.Element | null {
  const duplicate = useDuplicate(componentId);
  const [busy, setBusy] = useState(false);
  if (usedBy.length === 0) return null;
  const copy = async () => {
    setBusy(true);
    try {
      const made = await duplicate.send({});
      if (made === undefined) {
        toast.error(
          duplicate.error ?? "The component could not be copied. Try again."
        );
        return;
      }
      onCopied(made.component);
      toast.success(
        `${made.component.title} is this set's own ${area} now. Save or publish the set to keep it.`
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-[color:var(--nx-builder-text-muted)] m-0 min-w-0 text-xs">
        {alsoUsedByWords(usedBy)}
      </p>
      {disabled ? null : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void copy()}
        >
          Make a separate copy
        </Button>
      )}
    </div>
  );
}
