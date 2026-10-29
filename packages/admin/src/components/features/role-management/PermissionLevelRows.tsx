import { Input } from "@nextlyhq/ui";
import { useState, type JSX } from "react";

import type { LevelRow, PluginGroup } from "@admin/lib/permissions/level-rows";

import { PermissionLevelRow } from "./PermissionLevelRow";
import { PluginLevelGroup } from "./PluginLevelGroup";

export interface PermissionLevelRowsProps {
  /** The app's own collections and Singles. */
  rows: readonly LevelRow[];
  /** Each plugin's collections and own permissions, folded under its name. */
  groups?: readonly PluginGroup[];
  /** What each plugin is called, by its package name. */
  pluginNames?: ReadonlyMap<string, string>;
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
  groups = [],
  pluginNames,
  value,
  onChange,
  lockedIds,
  bases,
  disabled = false,
}: PermissionLevelRowsProps): JSX.Element {
  const [find, setFind] = useState("");
  const wanted = find.trim().toLowerCase();
  const matches = (row: LevelRow) =>
    row.label.toLowerCase().includes(wanted) ||
    row.slug.toLowerCase().includes(wanted);
  const labelOf = (group: PluginGroup) =>
    pluginNames?.get(group.plugin) ?? group.plugin;
  // Two plugins may share a label; each is then named by its package too, so
  // an administrator can tell which one they are granting.
  const labelCounts = new Map<string, number>();
  for (const group of groups) {
    labelCounts.set(labelOf(group), (labelCounts.get(labelOf(group)) ?? 0) + 1);
  }
  const nameOf = (group: PluginGroup) =>
    (labelCounts.get(labelOf(group)) ?? 0) > 1
      ? `${labelOf(group)} (${group.plugin})`
      : labelOf(group);
  const shown = wanted ? rows.filter(matches) : rows;
  // A plugin is found by its name or by any of its collections.
  const shownGroups = wanted
    ? groups.filter(
        group =>
          nameOf(group).toLowerCase().includes(wanted) ||
          group.rows.some(matches)
      )
    : groups;

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

      {shownGroups.length > 0 && (
        <section aria-label="Plugins">
          <h4 className="border-b border-border bg-muted/40 px-6 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Plugins
          </h4>
          {shownGroups.map(group => (
            <PluginLevelGroup
              key={group.plugin}
              group={group}
              displayName={nameOf(group)}
              value={value}
              onChange={onChange}
              lockedIds={lockedIds}
              bases={bases}
              disabled={disabled}
            />
          ))}
        </section>
      )}

      {shown.length === 0 && shownGroups.length === 0 && (
        <p className="px-6 py-8 text-center text-sm text-muted-foreground">
          {wanted
            ? `No collection or Single matches "${find.trim()}".`
            : "There are no collections or Singles yet."}
        </p>
      )}
    </div>
  );
}
