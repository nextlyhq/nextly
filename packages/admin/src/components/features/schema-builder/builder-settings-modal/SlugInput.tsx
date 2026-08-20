// Why: slug auto-derives from the singular name (kebab for singles,
// snake for collections/components — branching lives in BasicsTab). PR B
// dropped the loud "AUTO" badge + "Edit" text button in favor of a
// quieter, more dev-focused presentation: bold value + Lucide Pencil
// icon button. PR G (feedback 2) removed the dim "Slug:" prefix --
// the parent Label already says "Slug" so the prefix was redundant.
// Once the user clicks the pencil, the value becomes an inline
// editable input with a "Done" button.
import { Input } from "@nextlyhq/ui";

import { cn } from "@admin/lib/utils";

type Props = {
  /** The singular name the slug was derived from (kept for future "Reset to auto" affordance). */
  singular: string;
  value: string;
  onChange: (next: string) => void;
  /**
   * Shown, but not editable.
   *
   * An existing entity's slug addresses its route, its table and its stored
   * records, so no save moves it. An input that accepts a value nothing
   * persists is worse than one that refuses it: the edit reads as accepted
   * and is gone by the next load.
   */
  readOnly?: boolean;
};

export function SlugInput({ value, onChange, readOnly = false }: Props) {
  return (
    <Input
      aria-label="Slug"
      value={value}
      onChange={e => onChange(e.target.value)}
      readOnly={readOnly}
      // `readOnly` rather than `disabled`: the value still has to be
      // selectable, copyable and reachable by a screen reader, and `disabled`
      // drops it out of the tab order entirely.
      className={cn("font-mono", readOnly && "cursor-default opacity-70")}
    />
  );
}
