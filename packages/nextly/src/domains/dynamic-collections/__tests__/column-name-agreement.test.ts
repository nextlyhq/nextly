// A collection's table is created by one generator and addressed by two others: the runtime Drizzle
// schema every query is built from, and the diff engine's description of the desired table. All
// three derive the column name from the field name, and they did it with separate copies of the
// same conversion — one of which had lost the step that drops the underscore the substitution
// introduces before a leading capital. A field named `PublishedAt` was therefore created as
// `_published_at` and addressed as `published_at`: the table and every read of it disagreed, and
// the diff reported a column missing on every apply.
//
// The Schema Builder's own name pattern refuses a leading capital, which is why this never
// surfaced. That makes it a latent divergence rather than a live bug, and exactly the kind that
// stops being latent the moment another caller reaches the same generator.

import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import {
  getColumnDescriptor,
  type SupportedDialect,
} from "../../schema/services/field-column-descriptor";
import { DynamicCollectionSchemaService } from "../services/dynamic-collection-schema-service";

/** Names that reach a column, including the shapes the Builder refuses but code paths allow. */
const FIELD_NAMES = [
  "headline",
  "publishedAt",
  "bodyText",
  "PublishedAt",
  "BodyText",
  "a1",
  "x_y",
];

const DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

/** The identifiers declared in the CREATE TABLE body, before any index statement. */
function declaredColumns(sql: string): string[] {
  const body = sql.split("--> statement-breakpoint")[0];
  return [...body.matchAll(/^\s*[`"]([A-Za-z_][A-Za-z0-9_]*)[`"]/gm)].map(
    match => match[1]
  );
}

describe("collection column names agree across the generators", () => {
  it("creates every field under the name the runtime schema and diff address", () => {
    for (const dialect of DIALECTS) {
      const service = new DynamicCollectionSchemaService(undefined, dialect);
      const generate = service as unknown as {
        generateMigrationSQL: (
          name: string,
          fields: unknown[],
          options?: unknown
        ) => string;
      };

      for (const name of FIELD_NAMES) {
        const field = { name, type: "text" } as FieldDefinition;
        const expected = getColumnDescriptor(field, dialect)?.name;
        const columns = declaredColumns(
          generate.generateMigrationSQL("dc_agree", [field], {
            hasStatus: false,
          })
        );

        // The descriptor is what the runtime schema and the diff both build from, so the created
        // table has to contain exactly that name.
        expect({
          [`${dialect}.${name}`]: columns.includes(expected ?? ""),
        }).toEqual({ [`${dialect}.${name}`]: true });
      }
    }
  });

  it("declares no column twice", () => {
    // The other half: agreeing on a name is worthless if it agrees by colliding with a system
    // column. A duplicate makes the statement invalid, so the table is never created at all.
    for (const dialect of DIALECTS) {
      const service = new DynamicCollectionSchemaService(undefined, dialect);
      const generate = service as unknown as {
        generateMigrationSQL: (
          name: string,
          fields: unknown[],
          options?: unknown
        ) => string;
      };

      for (const name of FIELD_NAMES) {
        const columns = declaredColumns(
          generate.generateMigrationSQL("dc_agree", [{ name, type: "text" }], {
            hasStatus: true,
          })
        );
        const duplicated = columns.filter(
          (column, index) => columns.indexOf(column) !== index
        );

        expect({ [`${dialect}.${name}`]: duplicated }).toEqual({
          [`${dialect}.${name}`]: [],
        });
      }
    }
  });
});
