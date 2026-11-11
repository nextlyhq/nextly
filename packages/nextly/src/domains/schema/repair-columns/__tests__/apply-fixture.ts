/**
 * What the `repair-columns --apply` integration tests share: a collection table made by the
 * production generator, retyped column by column to the legacy type an older version left, and
 * reads of its columns and values as the database reports them.
 *
 * Not a test file itself, so the integration runner never collects it.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import { DynamicCollectionSchemaService } from "../../../dynamic-collections/services/dynamic-collection-schema-service";
import { introspectLiveColumns } from "../../pipeline/diff/introspect-live";
import type { SupportedDialect } from "../../services/field-column-descriptor";
import type { RepairRecord } from "../report";
import type { RepairEntity } from "../types";

export const f = (field: Record<string, unknown>) =>
  field as unknown as FieldDefinition;

/** The generator's SQL as statements a driver runs one at a time. */
function statements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .flatMap(chunk =>
      chunk
        .split("\n")
        .filter(line => !line.trim().startsWith("--"))
        .join("\n")
        .split(/;\s*(?:\n|$)/)
    )
    .map(statement => statement.trim())
    .filter(statement => statement.length > 0);
}

/** A collection whose applied and configured definitions are `applied` and `configured`. */
export function collection(
  table: string,
  applied: FieldDefinition[],
  options: { configured?: FieldDefinition[]; plugin?: string } = {}
): RepairEntity {
  const definition = (fields: FieldDefinition[]) => ({
    fields,
    localized: false,
    origin: "collection" as const,
  });
  return {
    kind: "collection",
    slug: table.replace(/^dc_/, "").replace(/_/g, "-"),
    table,
    applied: { ...definition(applied), source: "snapshot" },
    configured: definition(options.configured ?? applied),
    ...(options.plugin !== undefined ? { plugin: options.plugin } : {}),
  };
}

/** A dialect's quoting, statements and reads over one adapter. */
export function tableTools(
  adapter: () => DrizzleAdapter,
  dialect: SupportedDialect
) {
  const q = (name: string) =>
    dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
  const run = (statement: string) => adapter().executeQuery(statement);

  /** The table as the current generator makes it from `fields`. */
  async function createTable(table: string, fields: FieldDefinition[]) {
    const sql = new DynamicCollectionSchemaService(
      undefined,
      dialect
    ).generateMigrationSQL(table, fields, {});
    for (const statement of statements(sql)) await run(statement);
  }

  /**
   * Retype one column to the type an older version left, keeping its nullability unless
   * `nullable` is given. SQLite cannot retype a column in place, and its legacy shapes are made
   * by the test that needs them.
   */
  async function retype(
    table: string,
    column: string,
    type: string,
    nullable = true
  ) {
    if (dialect === "postgresql") {
      await run(
        `ALTER TABLE ${q(table)} ALTER COLUMN ${q(column)} TYPE ${type} USING ${q(column)}::${type}`
      );
      await run(
        `ALTER TABLE ${q(table)} ALTER COLUMN ${q(column)} ${nullable ? "DROP" : "SET"} NOT NULL`
      );
      return;
    }
    await run(
      `ALTER TABLE ${q(table)} MODIFY ${q(column)} ${type} ${nullable ? "NULL" : "NOT NULL"}`
    );
  }

  /** Insert rows of `values` by column, each row keyed by its `id`, with a unique slug. */
  async function insert(table: string, rows: Record<string, unknown>[]) {
    for (const row of rows) {
      const withSlug = { slug: `s-${String(row.id)}`, ...row };
      const columns = Object.keys(withSlug);
      const literal = (value: unknown) =>
        value === null
          ? "NULL"
          : typeof value === "number" || typeof value === "bigint"
            ? String(value)
            : `'${String(value).replace(/'/g, "''")}'`;
      await run(
        `INSERT INTO ${q(table)} (${columns.map(q).join(", ")}) VALUES (${columns
          .map(c => literal(withSlug[c as keyof typeof withSlug]))
          .join(", ")})`
      );
    }
  }

  /** Each row's value of `column`, by id, as the driver hands it back. */
  async function values(
    table: string,
    column: string
  ): Promise<Record<string, unknown>> {
    const rows = (await run(
      `SELECT ${q("id")} AS id, ${q(column)} AS v FROM ${q(table)}`
    )) as Array<{ id: unknown; v: unknown }>;
    return Object.fromEntries(rows.map(row => [String(row.id), row.v]));
  }

  /** The column's type and nullability as the database reports them. */
  async function columnState(table: string, column: string) {
    const snapshot = await introspectLiveColumns(
      adapter().getDrizzle(),
      dialect,
      [table]
    );
    const found = snapshot.tables[0]?.columns.find(c => c.name === column);
    return found === undefined
      ? null
      : { type: found.type, nullable: found.nullable };
  }

  /** The table's whole definition as the database reports it. */
  async function definition(table: string) {
    return introspectLiveColumns(adapter().getDrizzle(), dialect, [table]);
  }

  return {
    q,
    run,
    createTable,
    retype,
    insert,
    values,
    columnState,
    definition,
  };
}

/** The one record of `column` in `records`. */
export function recordOf(
  records: readonly RepairRecord[] | undefined,
  column: string
): RepairRecord {
  const found = (records ?? []).filter(r => r.column === column);
  if (found.length !== 1) {
    throw new Error(
      `expected one record of ${column}, found ${String(found.length)}`
    );
  }
  return found[0];
}

/** A JSON value as stored, read back as a value: drivers hand JSON back parsed or as text. */
export function asJson(value: unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) : value;
}
