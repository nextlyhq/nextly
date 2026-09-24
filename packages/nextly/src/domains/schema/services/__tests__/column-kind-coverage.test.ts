/**
 * Every ColumnKind builds a column on every dialect.
 *
 * The three `build*ColumnFromKind` functions return `unknown` and have no
 * `default` arm, so a kind nobody added a case for does NOT fail to compile —
 * it falls through and returns `undefined`, and the table receives a
 * non-column. That is how it failed when the extension kinds were added: tsc
 * was clean and `bigint` produced `undefined`.
 *
 * This is the control that makes the omission visible. It enumerates the union
 * rather than sampling it, so a kind added tomorrow is covered by the test
 * written today.
 */
import { describe, expect, it } from "vitest";

import type { SupportedDialect } from "../../../../database/schema-registry";
import type { ColumnDescriptor, ColumnKind } from "../field-column-descriptor";
import { renderDialectType } from "../field-column-descriptor";
import { buildUserDrizzleColumn } from "../runtime-schema-generator";

/**
 * Every member of the union, listed.
 *
 * Typed as `ColumnKind[]` so removing a kind from the union makes this a
 * compile error, and `satisfies` so a kind added to the union without being
 * added here is caught by the exhaustiveness check below.
 */
const ALL_KINDS = [
  "text",
  "longText",
  "shortText",
  "varchar",
  "boolean",
  "integer",
  "double",
  "decimal",
  "timestamp",
  "json",
  "fkSingle",
  "skip",
  "bigint",
  "smallint",
  "serial",
  "char",
  "uuid",
  "real",
  "bytes",
  "enum",
] as const satisfies readonly ColumnKind[];

/**
 * The compile-time half: a kind added to the union but not to the list above
 * makes this assignment fail.
 */
type Missing = Exclude<ColumnKind, (typeof ALL_KINDS)[number]>;
const _everyKindIsListed: Missing extends never ? true : false = true;

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

function descriptorFor(kind: ColumnKind): ColumnDescriptor {
  return {
    name: "c",
    dialectType: "text",
    nullable: true,
    kind,
    length: 10,
    precision: 10,
    scale: 2,
  };
}

describe("every ColumnKind", () => {
  it("is listed in this test's own enumeration", () => {
    expect(_everyKindIsListed).toBe(true);
  });

  for (const dialect of DIALECTS) {
    it(`builds a Drizzle column on ${dialect}`, () => {
      for (const kind of ALL_KINDS) {
        const built = buildUserDrizzleColumn(descriptorFor(kind), dialect);
        if (kind === "skip") {
          // The one kind that legitimately produces nothing: the field stores
          // its values in another table.
          expect(built).toBeNull();
          continue;
        }
        // `toBeDefined` rather than a shape assertion: what matters is that
        // the switch has an arm at all. A wrong arm is a different bug, and a
        // visible one.
        expect({
          kind,
          built: built === undefined ? "UNDEFINED" : "ok",
        }).toEqual({ kind, built: "ok" });
      }
    });

    it(`renders a dialect type on ${dialect}`, () => {
      for (const kind of ALL_KINDS) {
        if (kind === "skip") continue;
        const rendered = renderDialectType(kind, dialect, {
          length: 10,
          precision: 10,
          scale: 2,
        });
        expect({ kind, rendered }).toEqual({
          kind,
          rendered: expect.stringMatching(/\S/),
        });
      }
    });
  }
});
