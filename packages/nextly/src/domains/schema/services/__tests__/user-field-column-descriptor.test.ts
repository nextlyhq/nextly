/**
 * `getUserFieldColumnDescriptor` describes the column the user-extension generator creates for a
 * user field. That generator never read the descriptor, so its rules are its own; this pins the
 * descriptor to them by asking the generator itself, on every dialect, rather than restating a
 * table of expected types that could agree with the descriptor and drift from the generator.
 */
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import type { UserFieldConfig } from "../../../../users/config/types";
import { UserExtSchemaService } from "../../../users/services/user-ext-schema-service";
import { compareColumn } from "../../repair-columns/column-comparison";
import {
  getColumnDescriptor,
  getComponentRowColumnDescriptor,
  getUserFieldColumnDescriptor,
  type SupportedDialect,
} from "../field-column-descriptor";

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

/** One user field shape the generator gives a column, as stored in the definitions. */
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

/** The column the generator's CREATE TABLE gives one field: its declared type and nullability. */
function generatedColumn(
  dialect: SupportedDialect,
  field: Record<string, unknown>,
  column: string
): { type: string; nullable: boolean } | null {
  const sql = new UserExtSchemaService(dialect).generateMigrationSQL([
    { label: String(field.name), ...field } as unknown as UserFieldConfig,
  ]);
  const quote = dialect === "mysql" ? "`" : '"';
  const line = sql
    .split("\n")
    .map(text => text.trim())
    .find(text => text.startsWith(`${quote}${column}${quote} `));
  if (line === undefined) return null;
  const declaration = line
    .slice(column.length + 3)
    .replace(/,$/, "")
    .trim();
  // The type runs up to the first clause the generator appends after it.
  const type = declaration
    .split(/\s+(?:NOT NULL|DEFAULT|UNIQUE|PRIMARY KEY)\b/i)[0]
    .trim();
  return { type, nullable: !/\bNOT NULL\b/i.test(declaration) };
}

describe("getUserFieldColumnDescriptor", () => {
  for (const dialect of DIALECTS) {
    describe(dialect, () => {
      it.each(FIELDS)(
        "$type field $name is the column the user-extension generator creates",
        field => {
          const descriptor = getUserFieldColumnDescriptor(
            field as unknown as FieldDefinition,
            dialect
          );
          expect(descriptor).not.toBeNull();
          const generated = generatedColumn(
            dialect,
            field,
            descriptor?.name ?? ""
          );
          // Found at the descriptor's name: a generator column under another name, or none, fails.
          expect(generated).not.toBeNull();
          expect(
            compareColumn(
              { type: generated?.type ?? "", nullable: !!generated?.nullable },
              {
                type: descriptor?.dialectType ?? "",
                nullable: !!descriptor?.nullable,
              }
            )
          ).toBeNull();
        }
      );

      it("names no column for a field type the generator gives none", () => {
        const field = { name: "manager", type: "relationship" };
        expect(generatedColumn(dialect, field, "manager")).toBeNull();
        expect(
          getUserFieldColumnDescriptor(
            field as unknown as FieldDefinition,
            dialect
          )
        ).toBeNull();
      });
    });
  }

  it("leaves every other origin's answer for a number field unchanged", () => {
    // The user-extension generator stores a number as a float; a collection's number is an integer
    // unless it says otherwise. The user fields' answer is its own, and every builder the shared
    // descriptor serves still gets the integer.
    const field = {
      name: "score",
      type: "number",
    } as unknown as FieldDefinition;
    expect(getUserFieldColumnDescriptor(field, "postgresql")?.kind).toBe(
      "real"
    );
    expect(getColumnDescriptor(field, "postgresql", "collection")?.kind).toBe(
      "integer"
    );
    expect(getColumnDescriptor(field, "postgresql", "codeFirst")?.kind).toBe(
      "integer"
    );
    expect(
      getComponentRowColumnDescriptor(field, "postgresql", "fieldGroup")?.kind
    ).toBe("integer");
  });
});
