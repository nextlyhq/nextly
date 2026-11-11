"use client";

import {
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@nextlyhq/ui";
import type { ElementType, JSX, ReactNode } from "react";

import * as Icons from "@admin/components/icons";
import { Lock } from "@admin/components/icons";
import type { NextlyColumn } from "@admin/components/ui/table/data-table";
import { formatDateTime } from "@admin/lib/dates/format";

import {
  SCHEMA_COLUMN_HEADER,
  SchemaStateCell,
  SourceCell,
  schemaStateOf,
  sourceLabel,
  type EntitySource,
} from "./entity-list-labels";

/**
 * The parts the lists of collections, Singles and field groups draw alike:
 * the name cell, the source, schema, field-count and created columns, and the
 * filter menu. One implementation, so the three lists cannot drift apart.
 */

/** The icon a row names, by its icon name, or the list's own default. */
export function entityIcon(
  name: string | undefined,
  fallback: ElementType
): ElementType {
  return (name && (Icons as Record<string, ElementType>)[name]) || fallback;
}

/**
 * An entry's name cell: its icon, label (with a lock when it is defined in
 * code, and any marks the list adds) and slug beneath.
 */
export function EntityNameCell({
  icon: Icon,
  label,
  slug,
  locked,
  children,
}: {
  icon: ElementType;
  label: string;
  slug: string;
  locked?: boolean;
  /** Marks shown after the label, such as a removed-from-code notice. */
  children?: ReactNode;
}): JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <div className="table-row-icon-cover">
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {label}
          </span>
          {locked && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                <p>Locked: Cannot be edited or deleted from UI</p>
              </TooltipContent>
            </Tooltip>
          )}
          {children}
        </div>
        <span className="truncate text-xs text-muted-foreground">{slug}</span>
      </div>
    </div>
  );
}

/** Where each entry comes from; on a plugin's rows, the plugin by name. */
export function sourceColumn<Row extends { source?: string }>(
  pluginName?: string
): NextlyColumn<Row> {
  return {
    name: "source",
    header: "SOURCE",
    cell: ({ row }) => (
      <SourceCell source={row.source} pluginName={pluginName} />
    ),
  };
}

/** Whether each entry's schema is applied. */
export function schemaColumn<
  Row extends { migrationStatus?: string },
>(): NextlyColumn<Row> {
  return {
    // The stored column choice is keyed by this name, so it stays.
    name: "migrationStatus",
    header: SCHEMA_COLUMN_HEADER,
    cell: ({ row }) => <SchemaStateCell state={row.migrationStatus} />,
  };
}

/** How many fields each entry has, under the name the list stores it by. */
export function fieldCountColumn<Row extends object>(
  name: string,
  count: (row: Row) => number
): NextlyColumn<Row> {
  return {
    name,
    header: "FIELDS",
    cell: ({ row }) => (
      <span className="text-sm tabular-nums">{count(row)}</span>
    ),
  };
}

/** When each entry was created. */
export function createdColumn<Row extends object>(): NextlyColumn<Row> {
  return {
    name: "createdAt",
    header: "CREATED",
    hideOnMobile: true,
    cell: ({ value }) => (
      <span className="text-sm text-muted-foreground">
        {formatDateTime(value as string | undefined)}
      </span>
    ),
  };
}

/** Whether an entry's label or slug holds the search text. */
export function matchesSearch(
  entry: { label?: string; slug: string },
  search: string
): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return (
    (entry.label ?? "").toLowerCase().includes(needle) ||
    entry.slug.toLowerCase().includes(needle)
  );
}

/**
 * The filter menu's items: any source or one, any schema state or one. Each
 * option is named as the list's cells name it.
 */
export function EntityListFilterItems<
  Source extends EntitySource,
  State extends string,
>({
  sources,
  source,
  onSource,
  states,
  state,
  onState,
}: {
  sources: readonly Source[];
  source: Source | "all";
  onSource: (value: Source | "all") => void;
  states: readonly State[];
  state: State | "all";
  onState: (value: State | "all") => void;
}): JSX.Element {
  return (
    <>
      <DropdownMenuLabel>Filter by</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuCheckboxItem
        checked={source === "all"}
        onCheckedChange={() => onSource("all")}
      >
        Any source
      </DropdownMenuCheckboxItem>
      {sources.map(option => (
        <DropdownMenuCheckboxItem
          key={option}
          checked={source === option}
          onCheckedChange={() => onSource(option)}
        >
          {sourceLabel(option)}
        </DropdownMenuCheckboxItem>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuCheckboxItem
        checked={state === "all"}
        onCheckedChange={() => onState("all")}
      >
        Any schema state
      </DropdownMenuCheckboxItem>
      {states.map(option => (
        <DropdownMenuCheckboxItem
          key={option}
          checked={state === option}
          onCheckedChange={() => onState(option)}
        >
          {schemaStateOf(option).label}
        </DropdownMenuCheckboxItem>
      ))}
    </>
  );
}
