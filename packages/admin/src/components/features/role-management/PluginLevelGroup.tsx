import {
  Badge,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@nextlyhq/ui";
import { useMemo, useState, type JSX } from "react";

import { ChevronRight } from "@admin/components/icons";
import { LEVEL_LABELS } from "@admin/lib/permissions/level-labels";
import {
  groupLevel,
  type PluginGroup,
} from "@admin/lib/permissions/level-rows";
import { cn } from "@admin/lib/utils";

import { PermissionLevelRow, PermissionSwitches } from "./PermissionLevelRow";

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
}: PluginLevelGroupProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const locked = useMemo(() => new Set(lockedIds), [lockedIds]);
  const owned = useMemo(() => new Set(value), [value]);
  // What the group shows held: the role's own and its base roles'.
  const held = useMemo(
    () => new Set([...value, ...lockedIds]),
    [value, lockedIds]
  );
  const level = groupLevel(group, held);
  const ownCount = group.permissions.length;
  const summary =
    group.rows.length > 0
      ? group.rows.map(row => row.plural).join(", ")
      : `${ownCount} ${ownCount === 1 ? "permission" : "permissions"}`;

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
      <CollapsibleTrigger className="flex w-full items-center gap-3 px-6 py-4 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
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
        <Badge variant={level === "custom" ? "warning" : "outline"}>
          {level === "custom" ? "Custom" : LEVEL_LABELS[level]}
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
          />
        ))}
        {ownCount > 0 && (
          <div className="flex flex-col gap-3 px-6 py-4">
            <span className="text-sm font-medium text-foreground">
              {`${displayName}'s own permissions`}
            </span>
            <PermissionSwitches
              permissions={group.permissions}
              name={displayName}
              // A plugin's own action has no level to be named after: its
              // permission's own name says what it does.
              labelOf={permission => permission.name}
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
