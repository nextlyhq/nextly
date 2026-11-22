/**
 * A title edited in place, in a panel's row: Enter keeps it, Escape leaves
 * it, and leaving the field keeps it. An empty title is no change.
 *
 * @module admin/editor/rename-field
 */
import { Input } from "@nextlyhq/ui";
import * as React from "react";

/** The title, edited where it stands: Enter keeps it, Escape leaves it. */
export function RenameField({
  title,
  onDone,
  label = "Page title",
}: {
  title: string;
  onDone: (title: string | null) => void;
  /** What the field is called, said by a screen reader. */
  label?: string;
}): React.JSX.Element {
  const [value, setValue] = React.useState(title);
  const finish = (keep: boolean) => {
    const next = value.trim();
    onDone(keep && next !== "" ? next : null);
  };
  return (
    <Input
      aria-label={label}
      autoFocus
      value={value}
      onChange={event => setValue(event.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={event => {
        if (event.key === "Enter") finish(true);
        if (event.key === "Escape") finish(false);
      }}
      className="h-7 min-w-0 flex-1 text-sm"
    />
  );
}
