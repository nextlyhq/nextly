"use client";

import { Badge } from "@nextlyhq/ui";
import { Plug } from "lucide-react";
import type { JSX } from "react";

import * as Icons from "@admin/components/icons";
import type {
  FieldGroupMigrationStatus,
  MigrationStatus,
  SingleMigrationStatus,
} from "@admin/types/entities";

/**
 * What the lists of collections, Singles and field groups say about each
 * entry's source and its schema. One module for the three lists, so they
 * cannot name the same thing three ways.
 */

/** The sources an entry can come from, as the registries record them. */
export type EntitySource = "code" | "ui" | "built-in";

/** What each recorded source is called on screen. */
const SOURCE_LABELS: Record<EntitySource, string> = {
  code: "Defined in code",
  ui: "Made in the Builder",
  "built-in": "Built in",
};

/** A source's on-screen name, for a filter option as for a cell. */
export function sourceLabel(source: EntitySource): string {
  return SOURCE_LABELS[source];
}

const SOURCE_ICONS: Record<EntitySource, JSX.Element> = {
  code: <Icons.Code className="h-3 w-3 shrink-0" aria-hidden="true" />,
  ui: <Icons.FileText className="h-3 w-3 shrink-0" aria-hidden="true" />,
  "built-in": <Icons.Package className="h-3 w-3 shrink-0" aria-hidden="true" />,
};

/**
 * Where an entry comes from: the plugin that provides it, by name, or how the
 * site defined it. A row whose source is not recorded says so with a dash
 * rather than claiming "Unknown", which reads as a fault.
 */
export function SourceCell({
  source,
  pluginName,
}: {
  source?: string;
  pluginName?: string;
}): JSX.Element {
  const known =
    source !== undefined && Object.hasOwn(SOURCE_LABELS, source)
      ? (source as EntitySource)
      : undefined;
  if (pluginName === undefined && known === undefined) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-muted-foreground">
      {pluginName !== undefined ? (
        <Plug className="h-3 w-3 shrink-0" aria-hidden="true" />
      ) : (
        SOURCE_ICONS[known as EntitySource]
      )}
      {pluginName ?? SOURCE_LABELS[known as EntitySource]}
    </span>
  );
}

/** The header of the column that says whether an entry's schema is applied. */
export const SCHEMA_COLUMN_HEADER = "SCHEMA";

/**
 * Every schema state any of the three lists records: derived from the three
 * entity types, so a state added to any of them has to be labelled below.
 */
export type SchemaState =
  | MigrationStatus
  | SingleMigrationStatus
  | FieldGroupMigrationStatus;

type Attention = "warning" | "destructive";

/**
 * Each state's label, and the attention it draws: none while the schema is
 * applied, a badge only when something is not. An exhaustive record, so a
 * state added to the union does not compile until it says which it is.
 */
const SCHEMA_STATES: Record<
  SchemaState,
  { label: string; attention: Attention | null }
> = {
  synced: { label: "In sync", attention: null },
  applied: { label: "Applied", attention: null },
  pending: { label: "Not applied", attention: "warning" },
  generated: { label: "Ready to apply", attention: "warning" },
  failed: { label: "Apply failed", attention: "destructive" },
  diverged: { label: "Diverged", attention: "destructive" },
};

/**
 * A state's label and attention. The column is a string the registry reads
 * back, so a value no entry covers (a row written by another release) is
 * shown as stored, with attention, rather than as nothing.
 */
export function schemaStateOf(state: string): {
  label: string;
  attention: Attention | null;
} {
  return Object.hasOwn(SCHEMA_STATES, state)
    ? SCHEMA_STATES[state as SchemaState]
    : { label: state, attention: "warning" };
}

/** Whether an entry's schema is applied: plain text when it is, a badge when not. */
export function SchemaStateCell({ state }: { state?: string }): JSX.Element {
  if (!state) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  const { label, attention } = schemaStateOf(state);
  if (attention === null) {
    return (
      <span className="whitespace-nowrap text-sm text-muted-foreground">
        {label}
      </span>
    );
  }
  return (
    <Badge variant={attention} className="whitespace-nowrap">
      {label}
    </Badge>
  );
}
