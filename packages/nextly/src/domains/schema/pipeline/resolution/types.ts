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
  // Widening events are filtered out before reaching the prompt; this field is preserved on
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

// Stable serializable id for an event. Format: "<kind>:<table>.<column>".
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
  const dotIndex = id.indexOf(".", colonIndex + 1);
  if (colonIndex < 0 || dotIndex < 0) {
    throw new Error(`malformed event id: ${id}`);
  }
  const kind = id.slice(0, colonIndex) as ClassifierEventKind;
  const table = id.slice(colonIndex + 1, dotIndex);
  const column = id.slice(dotIndex + 1);
  return { kind, table, column };
}
