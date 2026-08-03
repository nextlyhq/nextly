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
import { validateCollectionConfig } from "../../../collections/config/validate-config";
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

  it("lets an author's own capitalised title or slug replace the injected one", () => {
    // Converting the name is only half the job: the injected `title` steps aside for an author's
    // own field, and that decision has to be made on the COLUMN too. Comparing declared names
    // would inject `title` beside a field named `Title` — two columns of one name, which no
    // dialect creates.
    for (const dialect of DIALECTS) {
      const service = new DynamicCollectionSchemaService(undefined, dialect);
      const generate = service as unknown as {
        generateMigrationSQL: (
          name: string,
          fields: unknown[],
          options?: unknown
        ) => string;
      };

      for (const name of ["Title", "Slug"]) {
        for (const table of ["dc_agree", "single_agree"]) {
          const columns = declaredColumns(
            generate.generateMigrationSQL(table, [{ name, type: "text" }], {
              hasStatus: false,
            })
          );
          const duplicated = columns.filter(
            (column, index) => columns.indexOf(column) !== index
          );

          expect({ [`${dialect}.${table}.${name}`]: duplicated }).toEqual({
            [`${dialect}.${table}.${name}`]: [],
          });
        }
      }
    }
  });
});

describe("two field names that reach one column", () => {
  it("are refused as duplicates before any DDL is generated", () => {
    // `foo_bar` and `FooBar` are different names that become the same column, so a table carrying
    // both cannot be created. Caught where the names are chosen rather than by the database.
    // `foo_bar`/`fooBar` was already broken this way and went unreported.
    for (const pair of [
      ["foo_bar", "FooBar"],
      ["foo_bar", "fooBar"],
      ["fooBar", "foobar"],
    ]) {
      const result = validateCollectionConfig({
        slug: "probe",
        fields: pair.map(name => ({ name, type: "text" })),
      } as never);
      const duplicates = (result.errors ?? []).filter(
        e => e.code === "FIELD_NAME_DUPLICATE"
      );

      expect({ [pair.join("+")]: duplicates.length }).toEqual({
        [pair.join("+")]: 1,
      });
    }
  });

  it("leaves nested fields alone, because they share one JSON column", () => {
    // A repeater or group keeps its children inside a single column, so two child names that
    // convert alike are two keys in one JSON value — nothing collides. Applying a column rule at
    // a level that has no columns would refuse a configuration that works.
    for (const type of ["group", "repeater"]) {
      const result = validateCollectionConfig({
        slug: "probe",
        fields: [
          {
            name: "wrapper",
            type,
            fields: [
              { name: "foo_bar", type: "text" },
              { name: "FooBar", type: "text" },
            ],
          },
        ],
      } as never);

      expect({
        [type]: (result.errors ?? []).filter(
          e => e.code === "FIELD_NAME_DUPLICATE"
        ),
      }).toEqual({ [type]: [] });
    }
  });

  it("still accepts two names that reach different columns", () => {
    // The mirror, so the case above cannot be satisfied by refusing every pair.
    const result = validateCollectionConfig({
      slug: "probe",
      fields: [
        { name: "alpha", type: "text" },
        { name: "beta", type: "text" },
      ],
    } as never);

    expect(
      (result.errors ?? []).filter(e => e.code === "FIELD_NAME_DUPLICATE")
    ).toEqual([]);
  });
});
