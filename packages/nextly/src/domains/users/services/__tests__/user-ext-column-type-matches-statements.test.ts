/**
 * `columnTypeFor` names exactly the type the user-extension builder's CREATE TABLE and ADD COLUMN
 * statements give each user field, on every dialect.
 *
 * `nextly repair-columns` reads the type `user_ext` should hold from `columnTypeFor` rather than
 * from the statements that created the table, so the two must be one answer. Each field shape is
 * rendered by both statements and its column found there by the builder's own column name; the
 * type each spells is compared with `columnTypeFor`'s, character for character apart from case.
 */
import { describe, expect, it } from "vitest";

import type { UserFieldConfig } from "../../../../users/config/types";
import { userFieldColumnName } from "../../../../users/config/validate-user-config";
import {
  UserExtSchemaService,
  type SupportedDialect,
} from "../user-ext-schema-service";

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

/** One user field shape the builder gives a column, as stored in the definitions. */
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
];

const asConfig = (field: Record<string, unknown>) =>
  ({ label: String(field.name), ...field }) as unknown as UserFieldConfig;

/** The clauses a statement appends after a column's type. */
const AFTER_TYPE = /\s+(?:NOT NULL|DEFAULT|UNIQUE|PRIMARY KEY)\b|;$/i;

/** The type a rendered column definition spells, from the text after the column's name. */
function typeAfter(text: string): string {
  return text.replace(/,$/, "").split(AFTER_TYPE)[0].trim();
}

/** The type the CREATE TABLE gives `column`, or null where it has no such column. */
function createTableType(
  builder: UserExtSchemaService,
  dialect: SupportedDialect,
  field: Record<string, unknown>,
  column: string
): string | null {
  const quoted = dialect === "mysql" ? `\`${column}\`` : `"${column}"`;
  const line = builder
    .generateMigrationSQL([asConfig(field)])
    .split("\n")
    .map(text => text.trim())
    .find(text => text.startsWith(`${quoted} `));
  return line === undefined ? null : typeAfter(line.slice(quoted.length));
}

/** The type the ADD COLUMN for a newly added field gives `column`, or null where there is none. */
function addColumnType(
  builder: UserExtSchemaService,
  dialect: SupportedDialect,
  field: Record<string, unknown>,
  column: string
): string | null {
  const quoted = dialect === "mysql" ? `\`${column}\`` : `"${column}"`;
  const marker = `ADD COLUMN ${quoted} `;
  const statement = builder
    .generateAlterTableMigration([], [asConfig(field)])
    .split("--> statement-breakpoint")
    .map(text => text.trim())
    .find(text => text.includes(marker));
  return statement === undefined
    ? null
    : typeAfter(statement.slice(statement.indexOf(marker) + marker.length));
}

const spelled = (type: string | null) => type?.trim().toLowerCase() ?? null;

describe("UserExtSchemaService.columnTypeFor", () => {
  for (const dialect of DIALECTS) {
    describe(dialect, () => {
      const builder = new UserExtSchemaService(dialect);

      it.each(FIELDS)(
        "names the type both statements give the $type field $name",
        field => {
          const column = userFieldColumnName(String(field.name));
          const type = builder.columnTypeFor(asConfig(field));
          const created = createTableType(builder, dialect, field, column);
          const added = addColumnType(builder, dialect, field, column);
          // Found under the builder's column name in both, so absence cannot pass.
          expect(type).not.toBeNull();
          expect(created, "CREATE TABLE column").not.toBeNull();
          expect(added, "ADD COLUMN column").not.toBeNull();
          expect(spelled(created)).toBe(spelled(type));
          expect(spelled(added)).toBe(spelled(type));
        }
      );

      it("names no type for a field type neither statement gives a column", () => {
        const field = { name: "manager", type: "relationship" };
        expect(builder.columnTypeFor(asConfig(field))).toBeNull();
        expect(createTableType(builder, dialect, field, "manager")).toBeNull();
        expect(addColumnType(builder, dialect, field, "manager")).toBeNull();
      });
    });
  }
});
