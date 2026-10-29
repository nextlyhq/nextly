import {
  Badge,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@nextlyhq/ui";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { useMemo, useState, type JSX } from "react";

import {
  actionLabel,
  customSummary,
  inActionOrder,
  LEVEL_LABELS,
  listed,
  narrowedInCode,
} from "@admin/lib/permissions/level-labels";
import {
  offeredLevels,
  ownWithLevel,
  rowLevel,
  type LevelRow,
} from "@admin/lib/permissions/level-rows";
import { levelsFor, type AccessLevel } from "@admin/lib/permissions/levels";
import { cn } from "@admin/lib/utils";

export interface PermissionLevelRowProps {
  row: LevelRow;
  /**
   * The role's own permissions, every row's and not only this one's. A base
   * role's are given apart, as `lockedIds`, and never saved into it.
   */
  value: readonly string[];
  onChange: (next: string[]) => void;
  /** Ids a base role gives, which this role cannot take away. */
  lockedIds?: readonly string[];
  /**
   * The base roles the role is built on, each with the permissions it gives:
   * a row names the ones that give it something.
   */
  bases?: readonly { name: string; ids: readonly string[] }[];
  disabled?: boolean;
}

/**
 * One collection or Single on the roles screen: its level, and behind the
 * "Each action" switch, a switch for each of its permissions.
 *
 * The row reads its level over the role's own permissions and its base
 * role's together. Setting a level changes only the row's standard actions
 * among the role's own (`ownWithLevel`), so an action under the switch,
 * another row's grant and a base role's grant all stay as they are. A row
 * whose actions match no level reads Custom, with no level selected, and
 * keeps them exactly until a level or a switch is changed. A row whose code
 * declares an access rule is marked, since the level is then only the most a
 * role can be given.
 *
 * Desktop shows every level of the row's kind side by side, with those a base
 * role puts out of reach disabled; a phone shows a select of the levels on
 * offer. Both are the same control, so either one sets the row.
 */
export function PermissionLevelRow({
  row,
  value,
  onChange,
  lockedIds = [],
  bases = [],
  disabled = false,
}: PermissionLevelRowProps): JSX.Element {
  const [eachAction, setEachAction] = useState(false);
  const locked = useMemo(() => new Set(lockedIds), [lockedIds]);
  const owned = useMemo(() => new Set(value), [value]);
  // What the row shows held: the role's own and its base role's.
  const held = useMemo(
    () => new Set([...value, ...lockedIds]),
    [value, lockedIds]
  );

  const level = rowLevel(row, held);
  const levels = levelsFor(row.kind);
  const offered = offeredLevels(row, lockedIds);
  // The bases that give this row something, each named for its own grants.
  const rowIds = new Set(row.permissions.map(permission => permission.id));
  const givers = bases
    .filter(base => base.ids.some(id => rowIds.has(id)))
    .map(base => base.name);
  const fromBase = givers.length > 0;
  // Every control is named by the label and the slug: two collections may
  // share a label, and only the slug tells a screen reader which is which.
  const name = `${row.label} (${row.slug})`;
  const summary =
    level === "custom"
      ? customSummary(row.permissions.filter(p => held.has(p.id)))
      : "";

  const setLevel = (chosen: string) => {
    const next = levels.find(candidate => candidate === chosen);
    if (next !== undefined) onChange(ownWithLevel(value, row, next, lockedIds));
  };
  const setAction = (id: string, on: boolean) => {
    onChange(on ? [...value, id] : value.filter(kept => kept !== id));
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-b border-border px-6 py-4 last:border-b-0",
        eachAction && "bg-muted/40"
      )}
      data-slot="permission-level-row"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-6">
        {/* The name takes what the controls leave, and a long slug breaks
            across lines rather than squeezing the levels or hiding part of
            itself. */}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">{row.label}</span>
            {level === "custom" && <Badge variant="warning">Custom</Badge>}
            {fromBase && <Badge variant="outline">from {listed(givers)}</Badge>}
            {row.declaredRules.length > 0 && (
              <Badge variant="outline">Narrowed in code</Badge>
            )}
          </div>
          <span className="font-mono text-xs break-all text-muted-foreground">
            {row.slug}
            {summary && (
              <>
                {" · "}
                <span>{summary}</span>
              </>
            )}
          </span>
          {row.declaredRules.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {narrowedInCode(row.kind, row.declaredRules)}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-3 md:shrink-0 md:flex-row md:items-center md:gap-6">
          <RadioGroupPrimitive.Root
            aria-label={`${name} level`}
            orientation="horizontal"
            // Custom selects none: no level is what the row holds.
            value={level === "custom" ? "" : level}
            onValueChange={setLevel}
            disabled={disabled}
            className="hidden rounded-md bg-muted p-1 md:inline-flex"
          >
            {levels.map(candidate => (
              <RadioGroupPrimitive.Item
                key={candidate}
                value={candidate}
                disabled={!offered.includes(candidate)}
                className={cn(
                  "rounded-sm px-3 py-1.5 text-sm whitespace-nowrap text-muted-foreground transition-colors",
                  "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  "data-[state=checked]:bg-background data-[state=checked]:font-medium data-[state=checked]:text-foreground data-[state=checked]:shadow-sm",
                  "disabled:cursor-not-allowed disabled:opacity-50"
                )}
              >
                {LEVEL_LABELS[candidate]}
              </RadioGroupPrimitive.Item>
            ))}
          </RadioGroupPrimitive.Root>

          <LevelSelect
            label={name}
            level={level}
            summary={summary}
            offered={offered}
            atLeast={fromBase ? offered[0] : undefined}
            disabled={disabled}
            onChange={setLevel}
          />

          <label className="flex items-center justify-between gap-3 text-sm whitespace-nowrap text-foreground md:justify-start">
            <span aria-hidden="true">Each action</span>
            <Switch
              aria-label={`${name}: each action`}
              checked={eachAction}
              onCheckedChange={setEachAction}
            />
          </label>
        </div>
      </div>

      {eachAction && (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          {inActionOrder(row.permissions).map(permission => {
            const action = actionLabel(permission);
            // Given by the base alone: the role has no copy of its own to
            // take away, so the way to drop it is to change the base.
            const baseOnly =
              locked.has(permission.id) && !owned.has(permission.id);
            return (
              <label
                key={permission.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-4 py-3 text-sm text-foreground"
              >
                <span aria-hidden="true">{action}</span>
                <Switch
                  aria-label={`${name}: ${action}`}
                  // A base role's grant shows held. Where the role also holds
                  // it, turning it off takes away the role's own copy.
                  checked={held.has(permission.id)}
                  disabled={disabled || baseOnly}
                  onCheckedChange={on => setAction(permission.id, on)}
                />
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * The level as a select, for a phone's width: the levels on offer, and the
 * row's Custom actions as the current value where it reads Custom.
 */
function LevelSelect({
  label,
  level,
  summary,
  offered,
  atLeast,
  disabled,
  onChange,
}: {
  label: string;
  level: AccessLevel | "custom";
  summary: string;
  offered: readonly AccessLevel[];
  /** The lowest level a base role leaves, named above the select. */
  atLeast?: AccessLevel;
  disabled: boolean;
  onChange: (level: string) => void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1 md:hidden">
      <span className="text-xs text-muted-foreground">
        Level{atLeast !== undefined && ` · at least ${LEVEL_LABELS[atLeast]}`}
      </span>
      <Select value={level} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger aria-label={`${label} level`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {level === "custom" && (
            <SelectItem value="custom" disabled>
              {summary ? `Custom: ${summary.toLowerCase()}` : "Custom"}
            </SelectItem>
          )}
          {offered.map(candidate => (
            <SelectItem key={candidate} value={candidate}>
              {LEVEL_LABELS[candidate]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
