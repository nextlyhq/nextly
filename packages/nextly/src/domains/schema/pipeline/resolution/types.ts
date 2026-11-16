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

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { KeyedBy } from "../../value-conversion/read-values";
import type {
  ColumnConversion,
  ConversionJudgement,
  RowKey,
} from "../../value-conversion/types";
import type { ClassificationLevel } from "../pushschema-pipeline-interfaces";

export type ResolutionKind =
  | "provide_default"
  | "make_optional"
  | "delete_nonconforming"
  | "confirm_drop"
  | "abort";

export type Resolution =
  | { kind: "provide_default"; eventId: string; value: unknown }
  | { kind: "make_optional"; eventId: string }
  | { kind: "delete_nonconforming"; eventId: string }
  // The user confirmed a destructive_drop event after seeing the column
  // name, type, and row count in the prompt. Pipeline keeps the
  // corresponding drop_column op.
  | { kind: "confirm_drop"; eventId: string }
  | { kind: "abort"; eventId: string };

export type ClassifierEventKind =
  | "add_not_null_with_nulls"
  | "add_required_field_no_default"
  | "type_change"
  // Emitted for every drop_column op the diff produces. Fulfils the
  // F5 destructive-confirm slot the pipeline anticipated (see
  // diff/types.ts:130). Dispatched as a confirm/abort prompt.
  | "destructive_drop";

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
  /** The database being changed: the prompt shows its line of `perDialectWarning`. */
  dialect?: SupportedDialect;
  /**
   * How many rows hold a value, for a pair of types the conversion rule has no conversion for,
   * which is asked about at a terminal as before, with what it would touch.
   */
  rowsHoldingValue?: number;
  /**
   * A conversion the repair command's rule judged lossy (`value-conversion/judge-column`): its
   * reasons with their rows, how its table keys them, and every row a consent would clear.
   */
  lossy?: {
    judgement: ConversionJudgement;
    keyedBy: KeyedBy;
    cleared: RowKey[];
    /** The conversion judged, which the apply judges again before it clears anything. */
    conversion: ColumnConversion;
  };
}

/** A type change the conversion rule judged safe: it goes ahead without a question. */
export interface SafeConversion {
  tableName: string;
  columnName: string;
  fromType: string;
  toType: string;
  /** How many rows the column holds, every one of which keeps its value. */
  rowsChecked: number;
}

// Emitted for every drop_column op the diff produces (one event per
// column). Carries the introspected column type and row count so the
// prompt can show the user the magnitude of the destruction before
// they confirm.
export interface DestructiveDropEvent extends BaseEvent {
  kind: "destructive_drop";
  columnType: string;
  tableRowCount: number;
  applicableResolutions: ResolutionKind[];
}

export type ClassifierEvent =
  | AddNotNullWithNullsEvent
  | AddRequiredFieldNoDefaultEvent
  | TypeChangeEvent
  | DestructiveDropEvent;

export interface ClassificationResult {
  level: ClassificationLevel;
  events: ClassifierEvent[];
  /** The type changes judged safe, which the apply lists as it makes them. */
  safeConversions?: SafeConversion[];
}

// Whitelisted set of kinds, used by parseEventId to validate untrusted input
// (e.g. resolutions arriving from the admin UI in PR 6).
const CLASSIFIER_EVENT_KINDS: ReadonlySet<ClassifierEventKind> = new Set([
  "add_not_null_with_nulls",
  "add_required_field_no_default",
  "type_change",
  "destructive_drop",
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
