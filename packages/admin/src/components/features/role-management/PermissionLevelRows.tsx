import { Input } from "@nextlyhq/ui";
import { useState, type JSX } from "react";

import type { LevelRow } from "@admin/lib/permissions/level-rows";

import { PermissionLevelRow } from "./PermissionLevelRow";

export interface PermissionLevelRowsProps {
  rows: readonly LevelRow[];
  /** The role's own permissions; see {@link PermissionLevelRow}. */
  value: readonly string[];
  onChange: (next: string[]) => void;
  lockedIds?: readonly string[];
  /** The base roles and the permissions each gives; see {@link PermissionLevelRow}. */
  bases?: readonly { name: string; ids: readonly string[] }[];
  disabled?: boolean;
}

/** The sections the rows are shown in, by the kind of entity each holds. */
const SECTIONS = [
  { kind: "collection", title: "Collections" },
  { kind: "single", title: "Singles" },
] as const;

/**
 * Every collection and Single as one row, under "Collections" and "Singles",
 * with a Find box that narrows them by name or slug.
 *
 * Each row writes the role's whole permission list, so the rows share the one
 * `value` and pass each change straight up: a row never holds a copy.
 */
export function PermissionLevelRows({
  rows,
  value,
  onChange,
  lockedIds,
  bases,
  disabled = false,
}: PermissionLevelRowsProps): JSX.Element {
  const [find, setFind] = useState("");
  const wanted = find.trim().toLowerCase();
  const shown = wanted
    ? rows.filter(
        row =>
          row.label.toLowerCase().includes(wanted) ||
          row.slug.toLowerCase().includes(wanted)
      )
    : rows;

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-3 border-b border-border px-6 pb-4 md:flex-row md:items-center md:justify-between">
        <h3 className="text-base font-semibold text-foreground">
          What this role can do
        </h3>
        <Input
          type="search"
          placeholder="Collection or Single"
          aria-label="Find a collection or Single"
          className="w-full md:w-64"
          value={find}
          onChange={event => setFind(event.target.value)}
          disabled={disabled}
        />
      </div>

      {SECTIONS.map(({ kind, title }) => {
        const inSection = shown.filter(row => row.kind === kind);
        if (inSection.length === 0) return null;
        return (
          <section key={kind} aria-label={title}>
            <h4 className="border-b border-border bg-muted/40 px-6 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {title}
            </h4>
            {inSection.map(row => (
              <PermissionLevelRow
                key={row.slug}
                row={row}
                value={value}
                onChange={onChange}
                lockedIds={lockedIds}
                bases={bases}
                disabled={disabled}
              />
            ))}
          </section>
        );
      })}

      {shown.length === 0 && (
        <p className="px-6 py-8 text-center text-sm text-muted-foreground">
          {wanted
            ? `No collection or Single matches "${find.trim()}".`
            : "There are no collections or Singles yet."}
        </p>
      )}
    </div>
  );
}
