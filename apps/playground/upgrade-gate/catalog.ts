/**
 * What a database holds, as the upgrade gate compares it, and the operations
 * that turn one such catalog into another.
 *
 * A catalog is read from the database's own system tables (see `database.ts`),
 * never from Nextly's introspection, so a fault in Nextly's view of a schema
 * cannot hide an operation from the gate. Every element is reduced to one line
 * of text per name, so two catalogs compare as plain maps and an operation reads
 * as what it did: `create index user_roles.user_roles_role_id_idx: (role_id)`.
 */

/** One table: each element by name, as one line that states it whole. */
export interface TableShape {
  /** Column name to its type, nullability and default. */
  columns: Record<string, string>;
  /** Index name to its definition, without the name. */
  indexes: Record<string, string>;
  /** Primary key, foreign key, unique and check constraints, by name. */
  constraints: Record<string, string>;
  /** Trigger name to its definition. */
  triggers: Record<string, string>;
}

/** Every table in the database, by name. */
export type Catalog = Record<string, TableShape>;

export type Dialect = "sqlite" | "postgresql" | "mysql";

export const DIALECTS: readonly Dialect[] = ["sqlite", "postgresql", "mysql"];

/** An empty table shape, for building catalogs. */
export function emptyTable(): TableShape {
  return { columns: {}, indexes: {}, constraints: {}, triggers: {} };
}

/** The kinds of element, with the verbs an operation on each reads with. */
const ELEMENTS = [
  { key: "columns", noun: "column", add: "add", drop: "drop" },
  { key: "indexes", noun: "index", add: "create", drop: "drop" },
  { key: "constraints", noun: "constraint", add: "add", drop: "drop" },
  { key: "triggers", noun: "trigger", add: "create", drop: "drop" },
] as const;

/**
 * The operations that turn `before` into `after`, one line each, sorted.
 *
 * A table that is new is one operation, `create table <name>`: nothing an
 * install held lives in it, so its shape is not an upgrade's concern. A table
 * that is gone is `drop table <name>`. Within a table both hold, each element
 * added, dropped or changed is an operation of its own, so an index rebuilt
 * under the same name with other columns reads as `change index`.
 */
export function operationsBetween(before: Catalog, after: Catalog): string[] {
  const operations = Object.keys(after)
    .filter(table => !(table in before))
    .map(table => `create table ${table}`);
  for (const table of Object.keys(before)) {
    operations.push(
      ...(table in after
        ? tableOperations(table, before[table], after[table])
        : [`drop table ${table}`])
    );
  }
  return operations.sort();
}

/** The operations on one table both catalogs hold, element by element. */
function tableOperations(
  table: string,
  before: TableShape,
  after: TableShape
): string[] {
  const operations: string[] = [];
  for (const { key, noun, add, drop } of ELEMENTS) {
    const was = before[key];
    const now = after[key];
    for (const [name, definition] of Object.entries(now)) {
      if (!(name in was)) {
        operations.push(`${add} ${noun} ${table}.${name}: ${definition}`);
      } else if (was[name] !== definition) {
        operations.push(
          `change ${noun} ${table}.${name}: ${was[name]} -> ${definition}`
        );
      }
    }
    const dropped = Object.keys(was).filter(name => !(name in now));
    operations.push(...dropped.map(name => `${drop} ${noun} ${table}.${name}`));
  }
  return operations;
}

/** One operation an upgrade from the baseline may plan, and why it is safe. */
export interface AllowedOperation {
  /** The operation exactly as `operationsBetween` writes it. */
  operation: string;
  /** The dialects it is planned on; every dialect when left out. */
  dialects?: readonly Dialect[];
  /** Why an existing install may meet it on upgrade. */
  reason: string;
}

/** How the planned operations differ from what the allowlist holds. */
export interface GateVerdict {
  /** Planned, and not in the allowlist. */
  unexpected: string[];
  /** In the allowlist for this dialect, and no longer planned. */
  stale: string[];
}

/** The allowlist's operations for one dialect. */
function allowedOn(
  allowlist: readonly AllowedOperation[],
  dialect: Dialect
): string[] {
  return allowlist
    .filter(entry => entry.dialects?.includes(dialect) ?? true)
    .map(entry => entry.operation);
}

/** Compares the planned operations with the allowlist for one dialect. */
export function judge(
  planned: readonly string[],
  allowlist: readonly AllowedOperation[],
  dialect: Dialect
): GateVerdict {
  const allowed = new Set(allowedOn(allowlist, dialect));
  const plannedSet = new Set(planned);
  return {
    unexpected: planned.filter(operation => !allowed.has(operation)),
    stale: [...allowed].filter(operation => !plannedSet.has(operation)).sort(),
  };
}

/**
 * What the gate says when the plan and the allowlist differ: each operation,
 * and for a new one the entry to add once its reason is known.
 */
export function verdictMessage(
  verdict: GateVerdict,
  dialect: Dialect,
  baseline: string
): string {
  const lines: string[] = [];
  if (verdict.unexpected.length > 0) {
    lines.push(
      `Upgrading an install built by ${baseline} plans ${verdict.unexpected.length} operation(s) on ${dialect} that upgrade-gate/allowlist.ts does not hold:`,
      ...verdict.unexpected.map(operation => `  + ${operation}`),
      "",
      "If the change is intended, add each to the allowlist with the reason an existing install may meet it:",
      ...verdict.unexpected.map(
        operation =>
          `  { operation: ${JSON.stringify(operation)}, dialects: [${JSON.stringify(dialect)}], reason: "..." },`
      ),
      "Otherwise, change the code so an upgrade no longer plans it."
    );
  }
  if (verdict.stale.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(
      `The allowlist holds ${verdict.stale.length} operation(s) the upgrade no longer plans on ${dialect}; remove them (or this dialect from their \`dialects\`):`,
      ...verdict.stale.map(operation => `  - ${operation}`)
    );
  }
  return lines.join("\n");
}
