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
import { buildDesiredTableFromFields } from "../../schema/pipeline/diff/build-from-fields";
import { generateRuntimeSchema } from "../../schema/services/runtime-schema-generator";
import {
  columnsDeclaredBy,
  fieldProducesColumn,
  getColumnDescriptor,
  toSnakeCase,
  type SupportedDialect,
} from "../../schema/services/field-column-descriptor";
import { defineCollection } from "../../../collections/config/define-collection";
import { validateSingleConfig } from "../../../singles/config/validate-single";
import { validateCollectionConfig } from "../../../collections/config/validate-config";
import { defineSingle } from "../../../singles/config/define-single";
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

/**
 * The column names a generated Drizzle table carries.
 *
 * Read off `Symbol("drizzle:Columns")` rather than through drizzle-orm's column-listing helper,
 * which is deprecated on v1 yet still compiles — `scripts/check-drizzle-v1-legacy.cjs` refuses it
 * for exactly that reason. `filter-unsafe-statements.ts` reads `Symbol("drizzle:Name")` the same
 * way. An empty result is asserted against at each call site: a "no duplicates" check passes
 * trivially on an empty list, so emptiness has to be refused explicitly rather than assumed to
 * surface.
 */
function runtimeColumnNames(table: unknown): string[] {
  const symbol = Object.getOwnPropertySymbols(table as object).find(
    candidate => String(candidate) === "Symbol(drizzle:Columns)"
  );
  if (!symbol) return [];
  const columns = (table as Record<symbol, unknown>)[symbol];
  return Object.values(columns as Record<string, { name: string }>).map(
    column => column.name
  );
}

/**
 * The identifiers declared in the CREATE TABLE body, before any index statement.
 *
 * Returns an empty list if the statement does not match — which every "declares no column twice"
 * assertion would then satisfy without comparing anything, so callers assert it is non-empty.
 */
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
        const expected = getColumnDescriptor(field, dialect, "codeFirst")?.name;
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

        expect({
          [`${dialect}.${name}.duplicated`]: duplicated,
          [`${dialect}.${name}.extracted`]: columns.length > 0,
        }).toEqual({
          [`${dialect}.${name}.duplicated`]: [],
          [`${dialect}.${name}.extracted`]: true,
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

          expect({
            [`${dialect}.${table}.${name}.duplicated`]: duplicated,
            [`${dialect}.${table}.${name}.extracted`]: columns.length > 0,
          }).toEqual({
            [`${dialect}.${table}.${name}.duplicated`]: [],
            [`${dialect}.${table}.${name}.extracted`]: true,
          });
        }
      }
    }
  });
});

describe("all three descriptions of the main table agree", () => {
  // The created table, the runtime schema every query is built from, and the diff's desired state
  // are produced by three modules from one field list. Comparing each against the descriptor, as
  // the tests above do, cannot catch them disagreeing with EACH OTHER — which is what a name
  // matched before localization is resolved does.
  function columnSets(
    fields: unknown[],
    dialect: SupportedDialect,
    options: { hasStatus?: boolean; localized?: boolean }
  ) {
    const service = new DynamicCollectionSchemaService(undefined, dialect);
    const generate = service as unknown as {
      generateMigrationSQL: (
        name: string,
        fields: unknown[],
        options?: unknown
      ) => string;
    };

    const created = declaredColumns(
      generate.generateMigrationSQL("dc_agree", fields, options)
    );
    const desired = buildDesiredTableFromFields(
      "dc_agree",
      fields as Parameters<typeof buildDesiredTableFromFields>[1],
      dialect,
      // This compares the collection creator's column names against the descriptor's, so the
      // descriptor is asked as that same creator.
      { ...options, builtBy: "collection" as const }
    ).columns.map(column => column.name);
    // The runtime generator spells the publish-lifecycle toggle `status` where the other two
    // spell it `hasStatus`; passing the wrong one silently omits the system column instead of
    // failing, so it is translated here rather than assumed.
    const runtime = runtimeColumnNames(
      generateRuntimeSchema("dc_agree", fields as FieldDefinition[], dialect, {
        status: options.hasStatus,
        localized: options.localized,
      }).table
    );

    // Every comparison below asserts three lists are equal. An empty extraction cannot satisfy
    // that on its own — the three come from independent generators, so one going empty makes the
    // lists differ — but asserting it here names the cause instead of leaving an opaque diff.
    expect({
      created: created.length > 0,
      desired: desired.length > 0,
      runtime: runtime.length > 0,
    }).toEqual({ created: true, desired: true, runtime: true });

    return {
      created: [...created].sort(),
      desired: [...desired].sort(),
      runtime: [...runtime].sort(),
    };
  }

  it("agrees when a localized field is named Title or Slug", () => {
    // A localized field lives in the companion table, so the main table has neither the user's
    // column nor the injected system one. Deciding that on the declared name made the created
    // table drop it while the other two injected it, and the diff then reconciled a column the
    // table does not have.
    for (const dialect of DIALECTS) {
      for (const name of ["Title", "Slug", "title", "slug"]) {
        const sets = columnSets(
          [
            { name, type: "text", localized: true },
            { name: "body", type: "text" },
          ],
          dialect,
          { hasStatus: false, localized: true }
        );

        expect({
          [`${dialect}.${name}.desired`]: sets.desired,
          [`${dialect}.${name}.runtime`]: sets.runtime,
        }).toEqual({
          [`${dialect}.${name}.desired`]: sets.created,
          [`${dialect}.${name}.runtime`]: sets.created,
        });
      }
    }
  });

  it("agrees when a column-less field is named after a system column", () => {
    // The gap the name-only cases above leave: a field can carry a system column's name AND
    // produce no column. A many-to-many relationship or a component named `Title` must not
    // suppress the injected `title` anywhere, because it puts nothing in its place — and each
    // generator has to reach that conclusion the same way, through the canonical predicate rather
    // than a hand-rolled list of the types it happens to remember.
    const columnLess = [
      {
        label: "manyToMany",
        make: (name: string) => ({
          name,
          type: "relationship",
          relationTo: "tags",
          options: { relationTo: "tags", relationType: "manyToMany" },
        }),
      },
      {
        label: "component",
        make: (name: string) => ({
          name,
          type: "component",
          component: "hero",
        }),
      },
    ];

    for (const dialect of DIALECTS) {
      for (const { label, make } of columnLess) {
        for (const name of ["Title", "title", "Slug", "slug"]) {
          const sets = columnSets(
            [make(name), { name: "body", type: "text" }],
            dialect,
            { hasStatus: false, localized: false }
          );
          const at = `${dialect}.${label}.${name}`;

          expect({
            [`${at}.desired`]: sets.desired,
            [`${at}.runtime`]: sets.runtime,
          }).toEqual({
            [`${at}.desired`]: sets.created,
            [`${at}.runtime`]: sets.created,
          });
        }
      }
    }
  });

  it("agrees for every name shape, localized or not", () => {
    for (const dialect of DIALECTS) {
      for (const name of FIELD_NAMES) {
        for (const localized of [false, true]) {
          for (const hasStatus of [false, true]) {
            const sets = columnSets([{ name, type: "text" }], dialect, {
              hasStatus,
              localized,
            });
            const label = `${dialect}.${name}.loc=${localized}.status=${hasStatus}`;

            expect({
              [`${label}.desired`]: sets.desired,
              [`${label}.runtime`]: sets.runtime,
            }).toEqual({
              [`${label}.desired`]: sets.created,
              [`${label}.runtime`]: sets.created,
            });
          }
        }
      }
    }
  });
});

describe("columnsDeclaredBy", () => {
  it("answers on the column, and tolerates entries that are not fields", () => {
    // The shared definition behind four "has the author already declared this?" decisions.
    // Anything without a string name is skipped rather than coerced, because two of those callers
    // run before the config has been parsed.
    expect([
      ...columnsDeclaredBy([
        { name: "Title", type: "text" },
        { name: "publishedAt", type: "text" },
        { name: "x_y", type: "text" },
        { type: "text" },
        { name: 42, type: "text" },
        null,
        undefined,
      ]),
    ]).toEqual(["title", "published_at", "x_y"]);
  });

  it("claims no column for a field that occupies none", () => {
    // A component or many-to-many named `Title` keeps its values in its own table, so it does not
    // own the `title` column and the system field still has to be injected beside it. Counting it
    // dropped `title` from the config while the generators went on emitting the column.
    const declared: Array<Record<string, unknown>> = [
      { name: "Title", type: "component", component: "hero" },
      {
        name: "Slug",
        type: "relationship",
        relationTo: "tags",
        options: { relationTo: "tags", relationType: "manyToMany" },
      },
      { name: "body", type: "text" },
    ];

    expect([...columnsDeclaredBy(declared)]).toEqual(["body"]);
  });
});

describe("a system column may be taken over only under its own name", () => {
  function codes(result: { errors?: Array<{ code: string }> }, code: string) {
    return (result.errors ?? []).filter(e => e.code === code).length;
  }

  const collection = (fields: unknown[], extra: object = {}) =>
    validateCollectionConfig({
      slug: "posts",
      labels: { singular: "Post", plural: "Posts" },
      fields,
      ...extra,
    } as never);
  const single = (fields: unknown[], extra: object = {}) =>
    validateSingleConfig({
      slug: "home",
      label: "Home",
      fields,
      ...extra,
    } as never);

  it("accepts the exact name, so the documented takeover still works", () => {
    // `title`/`slug` stepping aside for an author's own field is a feature, not an accident, and
    // the blog template relies on it. Only the ALIAS is refused.
    for (const name of ["title", "slug"]) {
      expect({
        [`collection.${name}`]: codes(
          collection([{ type: "text", name }]),
          "FIELD_NAME_SYSTEM_ALIAS"
        ),
        [`single.${name}`]: codes(
          single([{ type: "text", name }]),
          "FIELD_NAME_SYSTEM_ALIAS"
        ),
      }).toEqual({ [`collection.${name}`]: 0, [`single.${name}`]: 0 });
    }
  });

  it("refuses a spelling that only reaches the column after conversion", () => {
    // `Title` is the same column but a different identity in every payload — the runtime table's
    // property key, the keys a mutation generates, the response, the generated types. Two names
    // for one column means the generated value overwrites the author's, silently.
    for (const name of ["Title", "Slug"]) {
      expect({
        [`collection.${name}`]: codes(
          collection([{ type: "text", name }]),
          "FIELD_NAME_SYSTEM_ALIAS"
        ),
        [`single.${name}`]: codes(
          single([{ type: "text", name }]),
          "FIELD_NAME_SYSTEM_ALIAS"
        ),
      }).toEqual({ [`collection.${name}`]: 1, [`single.${name}`]: 1 });
    }
  });

  it("names the spelling that would work", () => {
    // The error has to be actionable: an author who wrote `Title` needs to be told `title`.
    const message = (collection([{ type: "text", name: "Title" }]).errors ?? [])
      .filter(e => e.code === "FIELD_NAME_SYSTEM_ALIAS")
      .map(e => e.message)
      .join("");

    expect(message).toContain("'Title'");
    expect(message).toContain("'title'");
  });

  it("leaves an ordinary name alone", () => {
    // The mirror, so the rule cannot be satisfied by refusing everything capitalised.
    expect(
      codes(
        collection([{ type: "text", name: "Headline" }]),
        "FIELD_NAME_SYSTEM_ALIAS"
      )
    ).toBe(0);
  });
});

describe("the publish lifecycle owns its columns while it is on", () => {
  function lifecycleErrors(fields: unknown[], status: boolean) {
    return (
      validateCollectionConfig({
        slug: "posts",
        labels: { singular: "Post", plural: "Posts" },
        status,
        fields,
      } as never).errors ?? []
    ).filter(e => e.code === "FIELD_NAME_LIFECYCLE_RESERVED").length;
  }

  it("refuses a column-less status field on a SINGLE as well", () => {
    // The Single validator carries the same column-less exemption and emits the
    // same lifecycle member, so the collision is identical there. One rule,
    // asked by both, rather than the check living only where it was first
    // noticed.
    const singleErrors = (fields: unknown[], status: boolean) =>
      (
        validateSingleConfig({
          slug: "settings",
          label: "Settings",
          status,
          fields,
        } as never).errors ?? []
      ).filter(e => e.code === "FIELD_NAME_LIFECYCLE_RESERVED").length;

    const manyToMany = [
      {
        type: "relationship",
        name: "status",
        relationTo: "tags",
        options: { relationType: "manyToMany" },
      },
    ];

    expect({
      on: singleErrors(manyToMany, true),
      off: singleErrors(manyToMany, false),
    }).toEqual({ on: 1, off: 0 });
  });

  it("refuses a COLUMN-LESS status field too, because the artifacts declare one", () => {
    // A many-to-many keeps its values in its own table, so the column-collision
    // rule exempts it and returns before the column-based lifecycle check. The
    // generated interface and the generated schema each still declare a
    // `status` member under that name, so the field and the lifecycle are
    // emitted twice and the generated file does not compile.
    // `options.relationType` is what `usesJunctionTable` reads; a top-level
    // `hasMany` still produces a column and would be caught by the ordinary
    // column rule instead, leaving this case unexercised.
    const manyToMany = [
      {
        type: "relationship",
        name: "status",
        relationTo: "tags",
        options: { relationType: "manyToMany" },
      },
    ];

    expect({
      on: lifecycleErrors(manyToMany, true),
      // The control: with the lifecycle off nothing emits a status member, so
      // the name is ordinary and must stay accepted.
      off: lifecycleErrors(manyToMany, false),
    }).toEqual({ on: 1, off: 0 });
  });

  it("refuses a status field only when the lifecycle is enabled", () => {
    // Measured across all three generators: with the lifecycle ON a `status` field duplicates the
    // column in the created table AND the diff's desired state, so the table cannot be created.
    // With it OFF every generator is clean and `status` is an ordinary, common field name.
    expect({
      "status.on": lifecycleErrors([{ type: "text", name: "status" }], true),
      "status.off": lifecycleErrors([{ type: "text", name: "status" }], false),
      "Status.on": lifecycleErrors([{ type: "text", name: "Status" }], true),
      "Status.off": lifecycleErrors([{ type: "text", name: "Status" }], false),
    }).toEqual({
      "status.on": 1,
      "status.off": 0,
      "Status.on": 1,
      "Status.off": 0,
    });
  });

  it("leaves other fields alone with the lifecycle on", () => {
    // The mirror: enabling the lifecycle must not refuse an ordinary schema.
    expect(
      lifecycleErrors(
        [
          { type: "text", name: "headline" },
          { type: "text", name: "body" },
        ],
        true
      )
    ).toBe(0);
  });
});

describe("the config factories inject on the column too", () => {
  it("refuses the capitalised alias before the injection can duplicate it", () => {
    // The factories prepend `title`/`slug` when the author has not declared them. An author
    // writing `Title` owns the same column, so the injected field arrived beside it and the table
    // declared `title` twice. That is now refused at validation, which runs first, so the
    // duplicate can no longer be constructed at all.
    for (const declared of ["Title", "Slug"]) {
      expect(() =>
        defineCollection({
          slug: "posts",
          labels: { singular: "Post", plural: "Posts" },
          fields: [{ type: "text", name: declared }],
        } as never)
      ).toThrow();
      expect(() =>
        defineSingle({
          slug: "home",
          label: "Home",
          fields: [{ type: "text", name: declared }],
        } as never)
      ).toThrow();
    }
  });

  it("keys the injection on the column for names it does accept", () => {
    // The factories still have to ask on the column rather than the spelling, because a
    // column-less field named `Title` is legal and must NOT suppress the system one: its values
    // live in its own table, so the table still needs `title`.
    const collection = defineCollection({
      slug: "posts",
      labels: { singular: "Post", plural: "Posts" },
      fields: [
        { type: "component", name: "Title", component: "hero" },
        { type: "text", name: "body" },
      ],
    } as never) as { fields: Array<{ name?: string }> };
    const names = collection.fields.map(f => f.name);
    const columns = names
      .filter((n): n is string => typeof n === "string")
      .map(toSnakeCase);

    expect({
      injectedTitle: names.includes("title"),
      duplicates: columns.filter((c, i) => columns.indexOf(c) !== i),
    }).toEqual({ injectedTitle: true, duplicates: ["title"] });
  });

  it("still injects the system field when the author declares neither", () => {
    // The mirror: the case above must not be satisfied by never injecting anything.
    const collection = defineCollection({
      slug: "posts",
      labels: { singular: "Post", plural: "Posts" },
      fields: [{ type: "text", name: "headline" }],
    } as never) as { fields: Array<{ name?: string }> };

    expect(collection.fields.map(field => field.name)).toEqual([
      "title",
      "slug",
      "headline",
    ]);
  });
});

describe("a rename between two spellings of one column", () => {
  it("emits no statement, because the database has nothing to do", () => {
    // `foo_bar` to `FooBar` is a rename in the config and a no-op in the table. Emitted anyway it
    // asks the dialect to rename a column to its own name, which PostgreSQL rejects because the
    // target already exists — failing an update that had nothing to change.
    for (const dialect of DIALECTS) {
      const service = new DynamicCollectionSchemaService(undefined, dialect);
      const alter = service as unknown as {
        generateAlterTableMigration: (
          table: string,
          oldFields: unknown[],
          newFields: unknown[]
        ) => string;
      };

      const sameColumn = alter.generateAlterTableMigration(
        "dc_p",
        [{ name: "foo_bar", type: "text" }],
        [{ name: "FooBar", type: "text" }]
      );
      const realRename = alter.generateAlterTableMigration(
        "dc_p",
        [{ name: "foo_bar", type: "text" }],
        [{ name: "baz_qux", type: "text" }]
      );

      expect({
        [`${dialect}.sameColumn`]: sameColumn.includes("RENAME COLUMN"),
        [`${dialect}.realRename`]: realRename.includes("RENAME COLUMN"),
        [`${dialect}.sameColumn.dropped`]: sameColumn.includes("DROP COLUMN"),
        [`${dialect}.sameColumn.added`]: sameColumn.includes("ADD COLUMN"),
      }).toEqual({
        [`${dialect}.sameColumn`]: false,
        [`${dialect}.realRename`]: true,
        [`${dialect}.sameColumn.dropped`]: false,
        [`${dialect}.sameColumn.added`]: false,
      });
    }
  });
});

describe("duplicate columns are judged globally, not per table", () => {
  const pair = [
    { type: "text", name: "foo_bar", localized: false },
    { type: "text", name: "FooBar", localized: true },
  ];

  function duplicates(result: { errors?: Array<{ code: string }> }) {
    return (result.errors ?? []).filter(e => e.code === "FIELD_NAME_DUPLICATE");
  }

  it("collapses two converging keys before anything splits them by table", () => {
    // The reason the rule cannot be relaxed for localized entities. The write path normalizes
    // payload keys through the same conversion BEFORE extracting localized fields, so the two
    // authored values land on one key and the second overwrites the first. Whatever table the
    // survivor is then routed to, one of the author's values is already gone.
    const authored = { foo_bar: "shared value", FooBar: "localized value" };
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(authored)) {
      normalized[toSnakeCase(key)] = value;
    }

    expect(Object.keys(normalized)).toEqual(["foo_bar"]);
    expect(Object.keys(authored)).toHaveLength(2);
  });

  it("refuses one shared and one localized field reaching the same column name", () => {
    // They are emitted into different tables, so physically nothing is declared twice — but the
    // payload has already merged them by then, so accepting the pair would silently drop a value.
    expect({
      collection: duplicates(
        validateCollectionConfig({
          slug: "posts",
          labels: { singular: "Post", plural: "Posts" },
          localized: true,
          fields: pair,
        } as never)
      ).length,
      single: duplicates(
        validateSingleConfig({
          slug: "home",
          label: "Home",
          localized: true,
          fields: pair,
        } as never)
      ).length,
    }).toEqual({ collection: 1, single: 1 });
  });

  it("still accepts two names that reach different columns when localized", () => {
    // The mirror, so the rule above cannot be satisfied by refusing every localized pair.
    expect(
      duplicates(
        validateCollectionConfig({
          slug: "posts",
          labels: { singular: "Post", plural: "Posts" },
          localized: true,
          fields: [
            { type: "text", name: "alpha", localized: false },
            { type: "text", name: "beta", localized: true },
          ],
        } as never)
      )
    ).toEqual([]);
  });
});

describe("junction storage is a relationship feature only", () => {
  // `relationship` and `upload` can both carry `relationType: "manyToMany"`, and the descriptor
  // once said neither had a column while the generator emitted one for the upload. The two are
  // reconciled toward the ROW, not the junction, because only a relationship is junction-backed in
  // the persistence layer: `collection-mutation-service` filters junction writes by
  // `f.type === "relationship"`, and the read path builds its relation set from
  // `isRelationshipField`, which is `field.type === "relationship"`. Giving an upload a junction
  // table would give it storage nothing writes to and nothing reads from.
  const m2m = (type: string) => ({
    name: "gallery",
    type,
    options: { relationType: "manyToMany", target: "media" },
  });

  it("routes a relationship to a junction and an upload to its own column", () => {
    const expected: Record<string, unknown> = {
      relationship: { parentColumn: false, descriptorColumn: false, tables: 2 },
      upload: { parentColumn: true, descriptorColumn: true, tables: 1 },
    };
    for (const dialect of DIALECTS) {
      for (const type of ["relationship", "upload"]) {
        const service = new DynamicCollectionSchemaService(undefined, dialect);
        const generate = service as unknown as {
          generateMigrationSQL: (
            name: string,
            fields: unknown[],
            options?: unknown
          ) => string;
        };
        const sql = generate.generateMigrationSQL("dc_p", [m2m(type)], {
          hasStatus: false,
        });
        const at = `${dialect}.${type}`;

        const want = expected[type] as {
          parentColumn: boolean;
          descriptorColumn: boolean;
          tables: number;
        };

        expect({
          [`${at}.parentColumn`]: declaredColumns(sql).includes("gallery"),
          [`${at}.descriptorColumn`]:
            getColumnDescriptor(m2m(type) as never, dialect, "collection") !==
            null,
          [`${at}.createTables`]: (sql.match(/CREATE TABLE/g) ?? []).length,
        }).toEqual({
          [`${at}.parentColumn`]: want.parentColumn,
          [`${at}.descriptorColumn`]: want.descriptorColumn,
          [`${at}.createTables`]: want.tables,
        });
      }
    }
  });

  it("still gives a single-target upload its own column", () => {
    // The mirror: only the many-to-many option moves storage off the row. An ordinary upload is
    // still a foreign key on the parent, and must not be swept up by the type check.
    const single = { name: "cover", type: "upload", relationTo: "media" };

    expect({
      descriptor: getColumnDescriptor(
        single as never,
        "postgresql",
        "collection"
      )?.name,
      producesColumn: fieldProducesColumn(single),
    }).toEqual({ descriptor: "cover", producesColumn: true });
  });
});

describe("a field that moves between storage classes", () => {
  // A junction-backed field has no column on its row and a row-backed one has no junction table.
  // Changing a field between those two while keeping its name is therefore not a modification of
  // anything — read as one, it emitted ALTER COLUMN against a name the table never had, which
  // fails the whole save. It has to leave one storage and arrive in the other.
  const named = (type: string) => ({
    name: "gallery",
    type,
    relationTo: "media",
    options: { relationType: "manyToMany", target: "media" },
  });

  function alterSql(oldFields: unknown[], newFields: unknown[]): string {
    const service = new DynamicCollectionSchemaService(undefined, "postgresql");
    const alter = service as unknown as {
      generateAlterTableMigration: (
        table: string,
        oldFields: unknown[],
        newFields: unknown[]
      ) => string;
    };
    return alter.generateAlterTableMigration("dc_p", oldFields, newFields);
  }

  it("adds the column when a junction-backed field becomes row-backed", () => {
    const sql = alterSql([named("relationship")], [named("upload")]);

    expect({
      addsColumn: sql.includes("ADD COLUMN"),
      altersColumn: sql.includes("ALTER COLUMN"),
    }).toEqual({ addsColumn: true, altersColumn: false });
  });

  it("drops the column and builds the junction when it goes the other way", () => {
    const sql = alterSql([named("upload")], [named("relationship")]);

    expect({
      dropsColumn: sql.includes("DROP COLUMN"),
      createsJunction: sql.includes("CREATE TABLE"),
      altersColumn: sql.includes("ALTER COLUMN"),
    }).toEqual({
      dropsColumn: true,
      createsJunction: true,
      altersColumn: false,
    });
  });

  it("still alters a field that stays in the same storage class", () => {
    // The mirror: an ordinary change to a row-backed field must still reach the modify path.
    const sql = alterSql(
      [{ name: "headline", type: "text" }],
      [{ name: "headline", type: "text", required: true }]
    );

    expect(sql).toContain("ALTER COLUMN");
  });
});

describe("altering a field that has no column", () => {
  // The CREATE path knows a many-to-many stores its links in a junction table. The ALTER paths
  // asked the same question by naming the component type alone, so a many-to-many reached them as
  // though it owned a column: toggling its index emitted CREATE INDEX and ALTER COLUMN against a
  // name the table does not have, which fails the whole save rather than that one field.
  function alterSql(
    dialect: SupportedDialect,
    oldFields: unknown[],
    newFields: unknown[]
  ): string {
    const service = new DynamicCollectionSchemaService(undefined, dialect);
    const alter = service as unknown as {
      generateAlterTableMigration: (
        table: string,
        oldFields: unknown[],
        newFields: unknown[]
      ) => string;
    };
    return alter.generateAlterTableMigration("dc_p", oldFields, newFields);
  }

  const columnLess = {
    manyToMany: (extra: Record<string, unknown>) => ({
      name: "tags",
      type: "relationship",
      relationTo: "tags",
      options: { relationTo: "tags", relationType: "manyToMany" },
      ...extra,
    }),
    component: (extra: Record<string, unknown>) => ({
      name: "tags",
      type: "component",
      component: "hero",
      ...extra,
    }),
  };

  it("emits no column statement when its index or flags change", () => {
    for (const dialect of DIALECTS) {
      for (const [label, make] of Object.entries(columnLess)) {
        for (const change of [
          { index: true },
          { required: true },
          { unique: true },
        ]) {
          const sql = alterSql(dialect, [make({})], [make(change)]);
          const offending = [
            "CREATE INDEX",
            "DROP INDEX",
            "ALTER COLUMN",
            "ADD COLUMN",
          ].filter(statement => sql.includes(statement));
          const at = `${dialect}.${label}.${Object.keys(change)[0]}`;

          expect({ [at]: offending }).toEqual({ [at]: [] });
        }
      }
    }
  });

  it("emits no DROP COLUMN when one is removed", () => {
    // The junction table is torn down elsewhere; the parent never had the column. On SQLite this
    // mattered most, because its DROP COLUMN carries no IF EXISTS to absorb the mistake.
    for (const dialect of DIALECTS) {
      for (const [label, make] of Object.entries(columnLess)) {
        const sql = alterSql(dialect, [make({})], []);

        expect({
          [`${dialect}.${label}`]: sql.includes("DROP COLUMN"),
        }).toEqual({ [`${dialect}.${label}`]: false });
      }
    }
  });

  it("still alters an ordinary field", () => {
    // The mirror, so the tests above cannot be satisfied by emitting nothing at all.
    const sql = alterSql(
      "postgresql",
      [{ name: "headline", type: "text" }],
      [{ name: "headline", type: "text", index: true }]
    );

    expect(sql).toContain("CREATE INDEX");
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

describe("the duplicate-column rule and the generator agree on which fields have a column", () => {
  it("exempts field types that store their values in their own tables", () => {
    // A component and a many-to-many relationship are declared on the table but keep their values
    // elsewhere, keyed by the field's declared name. Two of them whose names converge stay
    // distinct, so refusing the pair would reject a configuration that works — the same mistake as
    // applying the rule to nested fields, one level up.
    const component = (name: string) => ({
      name,
      type: "component",
      component: "hero",
    });
    const manyToMany = (name: string) => ({
      name,
      type: "relationship",
      relationTo: "tags",
      options: { relationTo: "tags", relationType: "manyToMany" },
    });

    const cases: Array<[string, unknown[]]> = [
      ["two components", [component("foo_bar"), component("FooBar")]],
      [
        "component beside a text field",
        [component("foo_bar"), { name: "FooBar", type: "text" }],
      ],
      ["two many-to-many", [manyToMany("foo_bar"), manyToMany("FooBar")]],
    ];

    for (const [label, fields] of cases) {
      const collection = validateCollectionConfig({
        slug: "probe",
        fields,
      } as never);
      const single = validateSingleConfig({
        slug: "probe",
        fields,
      } as never);

      expect({
        [`${label} (collection)`]: (collection.errors ?? []).filter(
          e => e.code === "FIELD_NAME_DUPLICATE"
        ),
        [`${label} (single)`]: (single.errors ?? []).filter(
          e => e.code === "FIELD_NAME_DUPLICATE"
        ),
      }).toEqual({
        [`${label} (collection)`]: [],
        [`${label} (single)`]: [],
      });
    }
  });

  it("does not exempt a field type it cannot recognise", () => {
    // An unregistered type falls back to a text column, so the rule has to keep applying to it.
    // Exempting the unknown case instead would let a plugin whose registration has not run yet
    // slip a table past validation that the database then refuses.
    const fields = [
      { name: "foo_bar", type: "somePluginTypeNotRegisteredYet" },
      { name: "FooBar", type: "somePluginTypeNotRegisteredYet" },
    ];

    const result = validateCollectionConfig({ slug: "probe", fields } as never);

    expect(
      (result.errors ?? []).filter(e => e.code === "FIELD_NAME_DUPLICATE")
    ).toHaveLength(1);
  });

  it("says a field has a column exactly when the generator emits one", () => {
    // The property the exemption depends on. If a new `return null` path appears in the descriptor
    // without the predicate learning about it, the rule starts refusing a field that has no column
    // again — which is the defect this describe block exists for.
    const VARIANTS: Array<Record<string, unknown>> = [
      {},
      { required: true },
      { hasMany: true },
      { relationTo: "tags" },
      { relationTo: ["tags", "cats"] },
      { options: { relationType: "manyToMany" } },
      { options: { relationType: "oneToMany" } },
    ];
    const TYPES = [
      "text",
      "number",
      "checkbox",
      "date",
      "relationship",
      "upload",
      "repeater",
      "group",
      "json",
      "component",
      "aTypeNobodyRegistered",
    ];

    const disagreements: string[] = [];
    for (const type of TYPES) {
      for (const [index, variant] of VARIANTS.entries()) {
        const field = { type, name: "probe", ...variant };
        for (const dialect of DIALECTS) {
          const emitsColumn =
            getColumnDescriptor(
              field as FieldDefinition,
              dialect,
              "codeFirst"
            ) !== null;
          if (fieldProducesColumn(field) !== emitsColumn) {
            disagreements.push(`${type}|v${index}|${dialect}`);
          }
        }
      }
    }

    expect(disagreements).toEqual([]);
  });
});
