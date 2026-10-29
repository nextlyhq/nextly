import {
  Badge,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@nextlyhq/ui";
import { useState, type JSX } from "react";

import { ChevronRight } from "@admin/components/icons";
import { LEVEL_LABELS } from "@admin/lib/permissions/level-labels";
import {
  groupLevel,
  type PluginGroup,
} from "@admin/lib/permissions/level-rows";
import { offeredSwitches } from "@admin/lib/roles/role-screen-mode";
import { cn } from "@admin/lib/utils";
import type { Permission } from "@admin/types/ui/form";

import { PermissionLevelRow, PermissionSwitches } from "./PermissionLevelRow";
import { useHeldPermissions } from "./useHeldPermissions";

export interface PluginLevelGroupProps {
  group: PluginGroup;
  /** What the plugin is called in the admin (`pluginDisplayName`). */
  displayName: string;
  /** The role's own permissions; see {@link PermissionLevelRow}. */
  value: readonly string[];
  onChange: (next: string[]) => void;
  lockedIds?: readonly string[];
  bases?: readonly { name: string; ids: readonly string[] }[];
  disabled?: boolean;
  /** The Public role's rows: see {@link PermissionLevelRow}'s `visitors`. */
  visitors?: boolean;
}

/**
 * A plugin on the roles screen: folded under its name, with its collections
 * listed and one word for what the role holds across them; open, a row for
 * each collection and a switch for each permission the plugin declares of
 * its own. Folded at first, so a screen of plugins reads as a list of names.
 */
export function PluginLevelGroup({
  group,
  displayName,
  value,
  onChange,
  lockedIds = [],
  bases,
  disabled = false,
  visitors = false,
}: PluginLevelGroupProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const { owned, locked, held } = useHeldPermissions(value, lockedIds);
  const level = groupLevel(group, held);
  const levelWord = level === "custom" ? "Custom" : LEVEL_LABELS[level];
  const ownCount = group.permissions.length;
  const summary =
    group.rows.length > 0
      ? group.rows.map(row => row.plural).join(", ")
      : `${ownCount} ${ownCount === 1 ? "permission" : "permissions"}`;

  // A plugin's own permission is named by its declared name; where two share
  // one, each is told apart by the resource it acts on, and where they also
  // share that, by the action too. A permission is its resource and action,
  // so the three together never repeat.
  const counts = new Map<string, number>();
  const count = (key: string) => counts.get(key) ?? 0;
  const byResource = (permission: Permission) =>
    `${permission.name}\u0000${permission.resource}`;
  for (const permission of group.permissions) {
    counts.set(permission.name, count(permission.name) + 1);
    counts.set(byResource(permission), count(byResource(permission)) + 1);
  }
  const ownLabel = (permission: Permission) => {
    if (count(byResource(permission)) > 1) {
      return `${permission.name} (${permission.resource}, ${permission.action})`;
    }
    return count(permission.name) > 1
      ? `${permission.name} (${permission.resource})`
      : permission.name;
  };

  const setOwn = (id: string, on: boolean) => {
    onChange(on ? [...value, id] : value.filter(kept => kept !== id));
  };

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="border-b border-border last:border-b-0"
      data-slot="plugin-level-group"
    >
      <CollapsibleTrigger
        // Named in words, as the parts read: the name, the summary and the
        // badge are side-by-side text a screen reader would otherwise run
        // together.
        aria-label={`${displayName}, ${summary}, ${levelWord}`}
        className="flex w-full items-center gap-3 px-6 py-4 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90"
          )}
        />
        <span className="font-medium text-foreground">{displayName}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
          {summary}
        </span>
        {/* Kept whole beside a long name: the pill has a fixed height, so
            its words wrapping would clip them. */}
        <Badge
          variant={level === "custom" ? "warning" : "outline"}
          className="shrink-0 whitespace-nowrap"
        >
          {levelWord}
        </Badge>
      </CollapsibleTrigger>
      <CollapsibleContent>
        {group.rows.map(row => (
          <PermissionLevelRow
            key={row.slug}
            row={row}
            value={value}
            onChange={onChange}
            lockedIds={lockedIds}
            bases={bases}
            disabled={disabled}
            visitors={visitors}
          />
        ))}
        {ownCount > 0 && (
          <div className="flex flex-col gap-3 px-6 py-4">
            <span className="text-sm font-medium text-foreground">
              {`${displayName}'s own permissions`}
            </span>
            <PermissionSwitches
              permissions={offeredSwitches(group.permissions, visitors)}
              name={displayName}
              // A plugin's own action has no level to be named after: its
              // permission's own name says what it does.
              labelOf={ownLabel}
              held={held}
              locked={locked}
              owned={owned}
              disabled={disabled}
              onChange={setOwn}
            />
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
