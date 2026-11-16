"use client";

/**
 * The field groups not saved yet that a save creates before its entity, as the
 * save's review lists them: one line each, "Create the field group Hero", in
 * the order they are created. Drawn first by every review a save can open, so
 * a field group made from the field picker is never created unseen.
 */
import { type JSX, useId } from "react";

/** One field group the save creates first: its name and address. */
export interface FieldGroupCreate {
  address: string;
  label: string;
}

export function FieldGroupCreatesList({
  groups,
}: {
  groups: readonly FieldGroupCreate[];
}): JSX.Element | null {
  const headingId = useId();
  if (groups.length === 0) return null;
  return (
    <div className="space-y-1 py-2">
      <p id={headingId} className="text-sm font-medium text-foreground">
        Field groups created first
      </p>
      <ul aria-labelledby={headingId} className="space-y-1 text-sm">
        {groups.map(group => (
          <li key={group.address} className="text-muted-foreground">
            {`Create the field group ${group.label}`}
          </li>
        ))}
      </ul>
    </div>
  );
}
