/**
 * Foreign keys, checks, and the two index shapes the base model cannot carry.
 *
 * These exist because the diff engine can now SEE them. That is the whole
 * precondition: a constraint the diff cannot see is one it can never drop or
 * re-create, so creating it would produce a database that drifts from its own
 * description and reports nothing.
 *
 * Every rule here refuses rather than degrades. A partial index silently
 * created without its predicate covers more rows than intended — and if it is
 * unique, it enforces a constraint nobody asked for, on data that was legal
 * until the deploy.
 *
 * @module domains/schema/extension/constraints
 * @since 1.0.0
 */
import type { SupportedDialect } from "../../../database/schema-registry";
import { NextlyError } from "../../../errors/nextly-error";
import type {
  CheckSpec,
  ForeignKeySpec,
  IndexSpec,
  ReferentialAction,
} from "../pipeline/diff/types";
import { indexNameForColumns } from "../services/index-name";

const ACTIONS: readonly ReferentialAction[] = [
  "cascade",
  "set null",
  "restrict",
  "no action",
  "set default",
];

function invalid(path: string, message: string): never {
  throw NextlyError.validation({
    errors: [{ path, code: "INVALID", message }],
  });
}

/** What an author writes for a foreign key. */
export interface ForeignKeyInput {
  columns: string[];
  references: { table: string; columns: string[] };
  onDelete?: ReferentialAction;
  onUpdate?: ReferentialAction;
  name?: string;
}

/**
 * The name a foreign key takes.
 *
 * Derived from the index namer so it inherits the 63-character bound and the
 * disambiguating hash. Composing `fk_<table>_<cols>` directly looks equivalent
 * and is not: near the limit it exceeds 63, which MySQL refuses outright and
 * PostgreSQL truncates — leaving a constraint under a name that disagrees with
 * the one the desired schema declares.
 */
export function foreignKeyName(
  tableName: string,
  columns: readonly string[]
): string {
  return indexNameForColumns(tableName, columns, false).replace(/^idx_/, "fk_");
}

/** Validate and resolve one foreign key. */
export function resolveForeignKey(
  tableName: string,
  input: ForeignKeyInput,
  knownColumns: ReadonlySet<string>
): ForeignKeySpec {
  const path = `${tableName}.foreignKeys`;
  if (input.columns.length === 0) {
    invalid(path, "A foreign key must name at least one column.");
  }
  if (input.columns.length !== input.references.columns.length) {
    // A mismatched pair produces SQL the server rejects at CREATE, which is a
    // failed deploy rather than a message naming the mistake.
    invalid(
      path,
      `A foreign key must reference as many columns as it declares: ${String(input.columns.length)} local, ${String(input.references.columns.length)} referenced.`
    );
  }
  for (const column of input.columns) {
    if (!knownColumns.has(column)) {
      invalid(
        path,
        `Foreign key names the column "${column}", which the table does not declare.`
      );
    }
  }
  for (const [label, action] of [
    ["onDelete", input.onDelete],
    ["onUpdate", input.onUpdate],
  ] as const) {
    if (action !== undefined && !ACTIONS.includes(action)) {
      invalid(path, `Unknown ${label} action "${action}".`);
    }
  }

  return {
    name: input.name ?? foreignKeyName(tableName, input.columns),
    columns: [...input.columns],
    referencesTable: input.references.table,
    referencesColumns: [...input.references.columns],
    // `no action` rather than `cascade`: a default that deletes rows is not a
    // default, and a cascade nobody asked for removes data on a write nobody
    // connected to it.
    onDelete: input.onDelete ?? "no action",
    onUpdate: input.onUpdate ?? "no action",
  };
}

/** Validate one check constraint. */
export function resolveCheck(
  tableName: string,
  input: { name?: string; sql: string },
  position: number
): CheckSpec {
  const path = `${tableName}.checks[${String(position)}]`;
  if (input.sql.trim() === "") {
    invalid(path, "A check constraint must carry an expression.");
  }
  return {
    name: input.name ?? `ck_${tableName}_${String(position)}`,
    sql: input.sql,
  };
}

/**
 * Refuse an index shape a dialect cannot build.
 *
 * MySQL is the case that matters: it has no partial indexes at all, so an
 * index carrying a predicate must be refused rather than created without one.
 * Created without it, a unique partial index enforces uniqueness over rows
 * that were legal until the deploy — and the failure arrives as a write
 * rejection on data nobody changed.
 */
export function assertIndexShapeSupported(
  index: Pick<IndexSpec, "where" | "expression" | "columns" | "name">,
  dialect: SupportedDialect,
  tableName: string
): void {
  const path = `${tableName}.indexes`;

  if (index.where !== undefined && dialect === "mysql") {
    invalid(
      path,
      `MySQL has no partial indexes, so "${index.name}" cannot be created there. Declare it without a predicate, or index a generated column.`
    );
  }

  if (index.expression !== undefined && index.columns.length > 0) {
    // Both would be ambiguous about what the index actually covers, and the
    // converter reports an expression index with an empty column list — so
    // the two states are indistinguishable downstream.
    invalid(
      path,
      `Index "${index.name}" declares both columns and an expression. Declare one.`
    );
  }

  if (index.expression === undefined && index.columns.length === 0) {
    invalid(path, `Index "${index.name}" covers no columns.`);
  }
}
