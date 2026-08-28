// A monospaced text input for an entity's slug, which the parent renders
// read-only once the entity exists.
//
// The slug auto-derives from the singular name — kebab for singles, snake for
// collections and components — and that branching lives in BasicsTab, because
// the case rule is the only genuinely kind-specific part of this field.
//
// `readOnly` rather than `disabled` is the one decision here worth stating, and
// the reason is on the prop itself: a disabled input is skipped by keyboard
// navigation and read as unavailable, while this value still has to be
// selectable, copyable and reachable by a screen reader. It is not unavailable;
// it is settled.
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
