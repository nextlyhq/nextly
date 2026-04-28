// F5 + F6 resolution and classifier event types.
//
// Why this file exists separately from pushschema-pipeline-interfaces.ts:
// keeps the rich type surface (4-kind Resolution union, 3-kind ClassifierEvent
// union, helpers) outside the lean orchestrator-interfaces module so consumers
// can import only what they need without pulling the whole pipeline contract.
//
// formatEventId/parseEventId give events stable, serializable identifiers so
// resolutions can reference an event across HTTP/SSE boundaries without
// relying on object identity.

import type { ClassificationLevel } from "../pushschema-pipeline-interfaces.js";

export type ResolutionKind =
  | "provide_default"
  | "make_optional"
  | "delete_nonconforming"
  | "abort";

export type Resolution =
  | { kind: "provide_default"; eventId: string; value: unknown }
  | { kind: "make_optional"; eventId: string }
  | { kind: "delete_nonconforming"; eventId: string }
  | { kind: "abort"; eventId: string };

export type ClassifierEventKind =
  | "add_not_null_with_nulls"
  | "add_required_field_no_default"
  | "type_change";

interface BaseEvent {
  id: string;
  tableName: string;
  columnName: string;
}

export interface AddNotNullWithNullsEvent extends BaseEvent {
  kind: "add_not_null_with_nulls";
  nullCount: number;
  tableRowCount: number;
  applicableResolutions: ResolutionKind[];
}

export interface AddRequiredFieldNoDefaultEvent extends BaseEvent {
  kind: "add_required_field_no_default";
  tableRowCount: number;
  applicableResolutions: ResolutionKind[];
}

export interface TypeChangeEvent extends BaseEvent {
  kind: "type_change";
  fromType: string;
  toType: string;
  // True when fromType -> toType is provably non-destructive (e.g. varchar(50) -> varchar(255)).
  // PR 3 will filter widening events before they reach the prompt; this field is preserved on
  // emitted events for diagnostic logs and possible future "show widening summary" UX.
  isWidening: boolean;
  perDialectWarning: { pg: string; mysql: string; sqlite: string };
}

export type ClassifierEvent =
  | AddNotNullWithNullsEvent
  | AddRequiredFieldNoDefaultEvent
  | TypeChangeEvent;

export interface ClassificationResult {
  level: ClassificationLevel;
  events: ClassifierEvent[];
}

// Whitelisted set of kinds, used by parseEventId to validate untrusted input
// (e.g. resolutions arriving from the admin UI in PR 6).
const CLASSIFIER_EVENT_KINDS: ReadonlySet<ClassifierEventKind> = new Set([
  "add_not_null_with_nulls",
  "add_required_field_no_default",
  "type_change",
]);

// Stable serializable id for an event. Format: "<kind>:<table>.<column>".
// Schema-qualified table names (e.g. "schema.users") are supported by parsing
// from the right via lastIndexOf — the column part is always a single
// identifier without dots.
export function formatEventId(
  kind: ClassifierEventKind,
  table: string,
  column: string
): string {
  return `${kind}:${table}.${column}`;
}

export function parseEventId(id: string): {
  kind: ClassifierEventKind;
  table: string;
  column: string;
} {
  const colonIndex = id.indexOf(":");
  if (colonIndex < 0) {
    throw new Error(`malformed event id: ${id}`);
  }
  // Split column off the right end so schema-qualified tables like
  // "public.dc_users" parse correctly as { table: "public.dc_users", column: ... }.
  const dotIndex = id.lastIndexOf(".");
  if (dotIndex <= colonIndex) {
    throw new Error(`malformed event id: ${id}`);
  }
  const kindStr = id.slice(0, colonIndex);
  if (!CLASSIFIER_EVENT_KINDS.has(kindStr as ClassifierEventKind)) {
    throw new Error(`malformed event id: unknown kind '${kindStr}'`);
  }
  const kind = kindStr as ClassifierEventKind;
  const table = id.slice(colonIndex + 1, dotIndex);
  const column = id.slice(dotIndex + 1);
  if (table.length === 0 || column.length === 0) {
    throw new Error(`malformed event id: ${id}`);
  }
  return { kind, table, column };
}
