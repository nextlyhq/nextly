"use client";

/**
 * The entities not saved yet that a save creates before its own, as the
 * save's review lists them: one line each, "Create the field group Hero" or
 * "Create the collection Authors", in the order they are created. Drawn first
 * by every review a save can open, so a field group made from the field
 * picker, or a collection made with a template, is never created unseen.
 */
import { type JSX, useId } from "react";

import { BUILDER_KIND_NOUN, type BuilderKind } from "./builder-config";

/** One entity the save creates first: its kind, name and address. */
export interface FieldGroupCreate {
  kind: BuilderKind;
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
        Created first
      </p>
      {/* Bounded, so a long list never pushes the review's buttons off a short screen. */}
      <ul
        aria-labelledby={headingId}
        className="max-h-40 space-y-1 overflow-y-auto text-sm"
      >
        {groups.map(group => (
          <li
            key={`${group.kind}:${group.address}`}
            className="text-muted-foreground"
          >
            {`Create the ${BUILDER_KIND_NOUN[group.kind]} ${group.label}`}
          </li>
        ))}
      </ul>
    </div>
  );
}
