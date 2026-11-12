/**
 * The runtime table every user-field read and write goes through declares, on every dialect, the
 * column the user-extension builder's CREATE TABLE gives each user field: the same type and the
 * same NOT NULL, and no column the statement does not make.
 *
 * The builder's statements are what `user_ext` is; the runtime table is what Drizzle reads and
 * writes it as, and Drizzle decodes a value by the type it is told. A column declared as a plain
 * timestamp over a `TIMESTAMP WITH TIME ZONE` decodes every value it reads wrongly, so the two
 * are compared here character for character, apart from case, for every field shape the builder
 * gives a column, for the table's own columns, and for a field it gives none.
 */
import { getColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { UserFieldConfig } from "../../../../users/config/types";
import { userFieldColumnName } from "../../../../users/config/validate-user-config";
import {
  UserExtSchemaService,
  type SupportedDialect,
} from "../user-ext-schema-service";

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

/** One user field shape, as stored in the definitions. */
const FIELDS: Array<Record<string, unknown>> = [
  { name: "website", type: "url" },
  { name: "mobile", type: "phone", maxLength: 40 },
  { name: "nickname", type: "text" },
  { name: "shortBio", type: "text", maxLength: 80 },
  { name: "handle", type: "text", unique: true },
  { name: "about", type: "textarea" },
  { name: "workEmail", type: "email" },
  { name: "score", type: "number" },
  { name: "isActive", type: "checkbox" },
  { name: "birthday", type: "date" },
  { name: "department", type: "select", options: [{ label: "A", value: "a" }] },
  {
    name: "teams",
    type: "select",
    hasMany: true,
    options: [{ label: "A", value: "a" }],
  },
  { name: "tier", type: "radio", options: [{ label: "A", value: "a" }] },
  { name: "companyName", type: "text", required: true },
  { name: "rank", type: "number", required: true },
  { name: "joinedOn", type: "date", required: true },
];

/** The table's own columns, which every user_ext has. */
const OWN_COLUMNS = ["id", "user_id", "created_at", "updated_at"];

const asConfig = (field: Record<string, unknown>) =>
  ({ label: String(field.name), ...field }) as unknown as UserFieldConfig;

/** The clauses a statement appends after a column's type. */
const AFTER_TYPE = /\s+(?:NOT NULL|DEFAULT|UNIQUE|PRIMARY KEY)\b|;$/i;

/** What the CREATE TABLE says of `column`: its type and whether it is NOT NULL, or null where it makes no such column. */
function statementColumn(
  builder: UserExtSchemaService,
  dialect: SupportedDialect,
  fields: Array<Record<string, unknown>>,
  column: string
): { type: string; notNull: boolean } | null {
  const quoted = dialect === "mysql" ? `\`${column}\`` : `"${column}"`;
  const line = builder
    .generateMigrationSQL(fields.map(asConfig))
    .split("\n")
    .map(text => text.trim())
    .find(text => text.startsWith(`${quoted} `));
  if (line === undefined) return null;
  const definition = line.slice(quoted.length).replace(/,$/, "");
  return {
    type: definition.split(AFTER_TYPE)[0].trim().toLowerCase(),
    notNull: /\bNOT NULL\b/i.test(definition),
  };
}

/** What the runtime table declares for `column`: its type and NOT NULL, or null where it declares none. */
function runtimeColumn(
  builder: UserExtSchemaService,
  fields: Array<Record<string, unknown>>,
  column: string
): { type: string; notNull: boolean } | null {
  const table = builder.generateRuntimeSchema(fields.map(asConfig));
  const declared = Object.values(
    getColumns(table as Parameters<typeof getColumns>[0])
  ).find(each => each.name === column);
  if (declared === undefined) return null;
  return {
    type: declared.getSQLType().trim().toLowerCase(),
    notNull: declared.notNull,
  };
}

describe("UserExtSchemaService.generateRuntimeSchema", () => {
  for (const dialect of DIALECTS) {
    describe(dialect, () => {
      const builder = new UserExtSchemaService(dialect);

      it.each(FIELDS)(
        "declares the column the CREATE TABLE gives the $type field $name",
        field => {
          const column = userFieldColumnName(String(field.name));
          const made = statementColumn(builder, dialect, [field], column);
          // Positive control: the builder gives this shape a column.
          expect(made).not.toBeNull();
          expect(runtimeColumn(builder, [field], column)).toEqual(made);
        }
      );

      it.each(OWN_COLUMNS)(
        "declares the table's own column %s as the CREATE TABLE makes it",
        column => {
          const fields = [FIELDS[0]!];
          const made = statementColumn(builder, dialect, fields, column);
          expect(made).not.toBeNull();
          expect(runtimeColumn(builder, fields, column)).toEqual(made);
        }
      );

      // On SQLite the statement spells a JSON column TEXT, as it does a text
      // one, so the spelling alone cannot tell them apart: what the runtime
      // column sends the driver must be the list's JSON, not the list itself,
      // which no TEXT column binds. PostgreSQL and MySQL spell JSON columns as
      // such, which the type comparison above already holds them to.
      it.runIf(dialect === "sqlite")(
        "encodes a multi-select's list as the JSON its column holds",
        () => {
          const field = FIELDS.find(each => each.name === "teams")!;
          const table = builder.generateRuntimeSchema([asConfig(field)]);
          const column = Object.values(
            getColumns(table as Parameters<typeof getColumns>[0])
          ).find(each => each.name === "teams");
          expect(column?.mapToDriverValue(["alpha", "beta"])).toBe(
            JSON.stringify(["alpha", "beta"])
          );
        }
      );

      it("declares no column for a field the CREATE TABLE gives none", () => {
        // A relationship is not a user field type the builder stores; a
        // definition that names one reaches neither statement nor table.
        const field = { name: "manager", type: "relationship" };
        const column = userFieldColumnName("manager");
        expect(statementColumn(builder, dialect, [field], column)).toBeNull();
        expect(runtimeColumn(builder, [field], column)).toBeNull();
      });
    });
  }
});
