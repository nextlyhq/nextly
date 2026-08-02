// The system columns are declared once and every consumer reads a projection of that declaration.
// Two kinds of test guard it. The pinned sets below name today's columns on purpose: they record
// the exact contract each consumer holds, so a projection that silently widens or narrows one
// fails here. The property tests that follow name no column at all — they are what makes the NEXT
// column safe.

import { getColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { FieldConfig } from "../../collections/fields/types";
import { fieldNameSchema } from "../../domains/dynamic-collections/services/dynamic-collection-validation-service";
import { FieldGroupSchemaService } from "../../domains/field-groups/services/field-group-schema-service";
import { getSystemColumnDescriptors } from "../../domains/schema/services/field-column-descriptor";
import { generateRuntimeSchema } from "../../domains/schema/services/runtime-schema-generator";
import { SYSTEM_SCHEMA_VERSION } from "../../domains/schema/services/schema-hash";
import { uiSchemaFieldSchema } from "../../schemas/_zod/ui-schema";

import {
  immutableSystemFieldsFor,
  IMMUTABLE_SYSTEM_FIELDS_ANY_ENTITY,
} from "../immutable-system-fields";
import {
  reservedSystemFieldNames,
  SYSTEM_COLUMNS,
  systemColumnDefaultSql,
  systemColumnDialectType,
  systemColumnNames,
  type ReservationSurface,
  type SystemColumnDialect,
  type SystemColumnKind,
} from "../system-columns";

const sorted = (names: Iterable<string>): string[] => [...names].sort();

describe("immutability projections", () => {
  it("closes exactly the provenance columns on a collection", () => {
    expect(sorted(immutableSystemFieldsFor("collection"))).toEqual(
      sorted([
        "id",
        "created_at",
        "createdAt",
        "updated_at",
        "updatedAt",
        "created_by",
        "createdBy",
        "first_published_at",
        "firstPublishedAt",
      ])
    );
  });

  it("leaves a single's own created_by alone", () => {
    // No owner column is injected onto a single's table, so the name is an ordinary one there.
    // Sharing one list wholesale is how a single's own column got stripped on every write.
    const single = immutableSystemFieldsFor("single");

    expect(single.has("created_by")).toBe(false);
    expect(single.has("createdBy")).toBe(false);
    expect(sorted(single)).toEqual(
      sorted([
        "id",
        "created_at",
        "createdAt",
        "updated_at",
        "updatedAt",
        "first_published_at",
        "firstPublishedAt",
      ])
    );
  });

  it("protects the owner column on every entity when the entity is not known", () => {
    // A restore runs before the write paths strip anything and protects both kinds at once.
    expect(sorted(IMMUTABLE_SYSTEM_FIELDS_ANY_ENTITY)).toEqual(
      sorted([
        "id",
        "created_at",
        "createdAt",
        "updated_at",
        "updatedAt",
        "created_by",
        "createdBy",
        "first_published_at",
        "firstPublishedAt",
      ])
    );
  });

  it("leaves content and lifecycle writable", () => {
    // `title`, `slug` and `status` are system-injected but authored. Closing them would make the
    // editor unable to set a title.
    for (const entity of ["collection", "single"] as const) {
      const closed = immutableSystemFieldsFor(entity);
      for (const name of ["title", "slug", "status"]) {
        expect({ [`${entity}.${name}`]: closed.has(name) }).toEqual({
          [`${entity}.${name}`]: false,
        });
      }
    }
  });
});

describe("reservation projections", () => {
  it("refuses both spellings of every column the Schema Builder reserves", () => {
    // Widened from the previous literal, which held `created_by`/`createdBy` but only
    // `created_at`. A field named `createdAt` snake-cases onto the injected column and lands in
    // the same CREATE TABLE twice, which the database rejects — so no collection carrying one can
    // exist, and refusing the name moves the failure to where it is chosen.
    expect(sorted(reservedSystemFieldNames("builder"))).toEqual(
      sorted([
        "id",
        "title",
        "slug",
        "created_at",
        "createdAt",
        "updated_at",
        "updatedAt",
        "created_by",
        "createdBy",
        "first_published_at",
        "firstPublishedAt",
      ])
    );
  });

  it("refuses the owner column and the marker in a code-first collection", () => {
    expect(sorted(reservedSystemFieldNames("collectionConfig"))).toEqual(
      sorted([
        "created_by",
        "createdBy",
        "first_published_at",
        "firstPublishedAt",
      ])
    );
  });

  it("refuses only the marker in a code-first single", () => {
    // A single gets no owner column, so `created_by` stays a legal field name there.
    expect(sorted(reservedSystemFieldNames("singleConfig"))).toEqual(
      sorted(["first_published_at", "firstPublishedAt"])
    );
  });

  it("refuses both spellings of the universal columns in the UI field-payload schema", () => {
    // The narrowest surface, because it also validates component fields and a component's table
    // carries only these three. It carries them under the same physical names, though, so the
    // camelCase spelling collides there exactly as it does on a collection.
    expect(sorted(reservedSystemFieldNames("uiSchema"))).toEqual(
      sorted(["id", "created_at", "createdAt", "updated_at", "updatedAt"])
    );
  });
});

describe("component tables, which are declared elsewhere on purpose", () => {
  // A component keeps its values in a `comp_` table of its own, built by its own generator. Those
  // tables are NOT projections of these declarations, and this records why so the question does
  // not have to be answered again from the DDL:
  //
  //   - they carry three of the declared columns — id, created_at, updated_at — and none of the
  //     rest: no title, slug, status, owner or publication marker;
  //   - their timestamps are NOT NULL, where a collection's are nullable with the same default;
  //   - their timestamps are emitted AFTER the author's fields, where a collection's come before;
  //   - they carry five structural columns of their own (parent id, parent table, parent field,
  //     order, type) that no other entity has.
  //
  // Two of those are shape differences and one is an ordering difference, so folding them into the
  // declarations would mean per-entity overrides of both — a heavier model for one entity whose
  // majority of columns still would not fit. What matters instead is that the columns they DO
  // share cannot drift apart unnoticed, which is what these assert.

  const componentDdl = (dialect: SystemColumnDialect): string =>
    new FieldGroupSchemaService(dialect).generateMigrationSQL("comp_probe", [
      { name: "headline", type: "text" } as FieldConfig,
    ]);

  /** MySQL quotes identifiers with backticks; the other two use double quotes. */
  const quoted = (dialect: SystemColumnDialect, name: string): string =>
    dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

  it("still carries every shared column under its declared name", () => {
    // A rename in the declarations that the component generator does not follow would leave a
    // component's rows describing themselves with a name nothing else uses.
    const shared = ["id", "created_at", "updated_at"];
    for (const dialect of [
      "postgresql",
      "mysql",
      "sqlite",
    ] as SystemColumnDialect[]) {
      const ddl = componentDdl(dialect);
      for (const name of shared) {
        expect({
          [`${dialect}.${name}`]: ddl.includes(quoted(dialect, name)),
        }).toEqual({ [`${dialect}.${name}`]: true });
      }
    }
    // And the names are the declared ones, not a copy that has drifted from them.
    for (const name of shared) {
      expect({ [name]: SYSTEM_COLUMNS.some(c => c.name === name) }).toEqual({
        [name]: true,
      });
    }
  });

  it("carries none of the columns that belong to an entity with a lifecycle", () => {
    // A component has no draft/published state and no owner, so a marker or owner column appearing
    // in its table would mean a projection had started including it by accident.
    const ddl = componentDdl("postgresql");
    for (const name of ["status", "first_published_at", "created_by", "slug"]) {
      expect({ [name]: ddl.includes(`"${name}"`) }).toEqual({ [name]: false });
    }
  });

  it("would emit a duplicate column for a field named like a shared one", () => {
    // The reason the UI field-payload schema refuses both spellings. `createdAt` snake-cases onto
    // the injected `created_at` and both are emitted, which the database rejects — so the payload
    // could never have produced a working table, and refusing the name loses nothing.
    const ddl = new FieldGroupSchemaService("postgresql").generateMigrationSQL(
      "comp_probe",
      [{ name: "createdAt", type: "text" } as FieldConfig]
    );

    expect(ddl.match(/"created_at"/g)?.length).toBe(2);
  });
});

describe("the validators actually refuse what the projection lists", () => {
  // The projections above prove the SET. These prove the wiring: a validator reading the
  // projection rather than a literal of its own is the whole point, and a set nobody consults
  // would satisfy every test above.

  it("refuses every projected name in the Schema Builder", () => {
    for (const name of reservedSystemFieldNames("builder")) {
      expect({ [name]: fieldNameSchema.safeParse(name).success }).toEqual({
        [name]: false,
      });
    }
  });

  it("still accepts an ordinary field name", () => {
    // The mirror, so the case above cannot be satisfied by a validator that refuses everything.
    expect(fieldNameSchema.safeParse("headline").success).toBe(true);
  });

  it("refuses every projected name in the UI field-payload schema", () => {
    // The surface that validates a component's fields as well as a collection's. Asserted through
    // the schema rather than the projection, because a set nobody consults would satisfy the
    // pinned test above and still let the payload through.
    for (const name of reservedSystemFieldNames("uiSchema")) {
      const parsed = uiSchemaFieldSchema.safeParse({ name, type: "text" });
      expect({ [name]: parsed.success }).toEqual({ [name]: false });
    }
  });

  it("accepts an ordinary field name in the UI field-payload schema", () => {
    // The mirror, so the case above cannot pass because the payload shape is wrong.
    expect(
      uiSchemaFieldSchema.safeParse({ name: "headline", type: "text" }).success
    ).toBe(true);
  });

  it("refuses the camelCase spelling of a timestamp column", () => {
    // The name this widened to. It snake-cases onto the injected column and lands in the same
    // CREATE TABLE twice, so the collection could never have been created; refusing it here
    // reports the collision where the name is chosen instead of as a database error.
    expect(fieldNameSchema.safeParse("createdAt").success).toBe(false);
    expect(fieldNameSchema.safeParse("updatedAt").success).toBe(false);
  });
});

describe("the declaration set itself", () => {
  const SURFACES: ReservationSurface[] = [
    "builder",
    "collectionConfig",
    "singleConfig",
    "uiSchema",
  ];

  it("gives every column a camelCase spelling that snake-cases back to it", () => {
    // The two spellings reach the same column, which is why reserving one alone reserves nothing.
    const toSnake = (name: string) =>
      name
        .replace(/([A-Z])/g, "_$1")
        .toLowerCase()
        .replace(/^_/, "");

    for (const column of SYSTEM_COLUMNS) {
      expect({ [column.name]: toSnake(column.camelName) }).toEqual({
        [column.name]: column.name,
      });
    }
  });

  it("declares a shape for every dialect", () => {
    // A column missing a dialect would reach the runtime schema and not the table, and every read
    // of that entity would then select a column that does not exist.
    for (const column of SYSTEM_COLUMNS) {
      for (const dialect of ["postgresql", "mysql", "sqlite"] as const) {
        expect({
          [`${column.name}.${dialect}`]: typeof systemColumnDialectType(
            column.shape[dialect],
            dialect
          ),
        }).toEqual({ [`${column.name}.${dialect}`]: "string" });
      }
    }
  });

  it("applies every column to at least one entity", () => {
    for (const column of SYSTEM_COLUMNS) {
      expect({ [column.name]: column.appliesTo.length > 0 }).toEqual({
        [column.name]: true,
      });
    }
  });

  it("builds the runtime schema to match every declared shape", () => {
    // The physical table and the runtime schema are made by different code from the same
    // declaration, and a disagreement between them is silent: the table is created one way and
    // every query reads it another. The runtime builder used to dispatch on the column NAME, with
    // a fall-through that made anything it did not recognise non-null text, so a newly declared
    // timestamp would have been created as a timestamp and read through text.
    //
    // This asserts the two agree for every declared column rather than for the ones that exist
    // today, so a column added to the declarations cannot be silently mishandled by the builder.
    const EXPECTED_COLUMN_TYPE: Record<
      SystemColumnDialect,
      Record<SystemColumnKind, string>
    > = {
      postgresql: {
        text: "PgText",
        varchar: "PgVarchar",
        timestamp: "PgTimestamp",
      },
      mysql: {
        text: "MySqlText",
        varchar: "MySqlVarChar",
        timestamp: "MySqlTimestamp",
      },
      sqlite: {
        text: "SQLiteText",
        varchar: "SQLiteText",
        timestamp: "SQLiteTimestamp",
      },
    };

    for (const dialect of [
      "postgresql",
      "mysql",
      "sqlite",
    ] as SystemColumnDialect[]) {
      for (const isSingle of [false, true]) {
        const { table } = generateRuntimeSchema(
          isSingle ? "single_probe" : "dc_probe",
          [{ name: "body", type: "textarea" }],
          dialect,
          { status: true, isSingle }
        );
        const built = getColumns(table as never) as Record<string, unknown>;
        const byName = new Map(
          Object.values(built).map(column => {
            const c = column as Record<string, unknown>;
            return [c.name as string, c];
          })
        );

        for (const descriptor of getSystemColumnDescriptors(dialect, {
          hasTitleField: false,
          hasSlugField: false,
          hasStatus: true,
          isSingle,
        })) {
          const where = `${dialect}${isSingle ? "/single" : ""}.${descriptor.name}`;
          const built = byName.get(descriptor.name);
          expect({ [where]: built !== undefined }).toEqual({ [where]: true });
          if (!built) continue;

          expect({
            [`${where}.type`]: built.columnType,
            [`${where}.notNull`]: built.notNull,
            [`${where}.hasDefault`]: built.hasDefault,
            [`${where}.primary`]: built.primary,
          }).toEqual({
            [`${where}.type`]: EXPECTED_COLUMN_TYPE[dialect][descriptor.kind],
            // A primary key is NOT NULL whether or not it says so.
            [`${where}.notNull`]: descriptor.primaryKey || !descriptor.nullable,
            [`${where}.hasDefault`]: descriptor.default !== undefined,
            [`${where}.primary`]: descriptor.primaryKey,
          });
        }
      }
    }
  });

  it("never reserves a name on a surface without declaring the column", () => {
    // The projections are the only source, so this holds by construction — it is asserted so that
    // a future surface added to the union cannot be forgotten in `reservedSystemFieldNames`.
    const declared = new Set(systemColumnNames(() => true));
    for (const surface of SURFACES) {
      for (const name of reservedSystemFieldNames(surface)) {
        expect({ [`${surface}:${name}`]: declared.has(name) }).toEqual({
          [`${surface}:${name}`]: true,
        });
      }
    }
  });

  it("closes every column that is stripped from responses", () => {
    // A value the server refuses to return is not one a client may set. The owner column is the
    // case: owner-only access filters on it in SQL, so it never leaves the server.
    for (const column of SYSTEM_COLUMNS) {
      if (!column.strippedFromResponses) continue;
      expect({ [column.name]: column.writableByClient }).toEqual({
        [column.name]: false,
      });
    }
  });
});

describe("the physical shape is pinned to the schema version", () => {
  /**
   * One line per column, carrying only what decides a physical table: the name, when the column is
   * present, which entities carry it, and its shape per dialect. Policies that never reach a
   * `CREATE TABLE` — who may write it, who publishes it, who reserves the name — are deliberately
   * absent, so changing one of those does not demand a schema-version bump.
   */
  const physicalShape = (): string[] =>
    SYSTEM_COLUMNS.map(column => {
      const shapes = (["postgresql", "mysql", "sqlite"] as const)
        .map(dialect => {
          const s = column.shape[dialect];
          return [
            dialect.slice(0, 2),
            systemColumnDialectType(s, dialect),
            s.length ?? "-",
            s.nullable ? "null" : "notnull",
            s.primaryKey ? "pk" : "-",
            systemColumnDefaultSql(s, dialect) ?? "-",
          ].join(":");
        })
        .join(" ");
      return `${column.name} | ${column.presence} | ${[...column.appliesTo].sort().join(",")} | ${shapes}`;
    });

  it("has not changed without SYSTEM_SCHEMA_VERSION being bumped", () => {
    // `SYSTEM_SCHEMA_VERSION` is mixed into every collection's stored schema hash, and a table is
    // only rebuilt when that hash changes. Add or reshape a column without bumping it and existing
    // installs are never told: the runtime schema selects a column their table does not have, and
    // the failure is silent until a read runs. That is the worst of the ways this can go wrong,
    // because it hits upgrades rather than new installs.
    //
    // It is pinned rather than derived on purpose. Deriving would change the value now, for every
    // install at once, and every stored hash would read as "schema changed" — a migration for
    // everyone, to record a refactor. So the fingerprint is checked and the bump stays a decision.
    //
    // If this fails: confirm the diff is the column change you meant, bump SYSTEM_SCHEMA_VERSION,
    // add its line to the history in schema-hash.ts, and update both values here.
    expect({
      version: SYSTEM_SCHEMA_VERSION,
      shape: physicalShape(),
    }).toEqual({
      version: 3,
      shape: [
        "id | always | collection,single | po:text:-:notnull:pk:- my:varchar(36):36:notnull:pk:- sq:text:-:notnull:pk:-",
        "title | unlessAuthorDeclaredTitle | collection,single | po:text:-:notnull:-:- my:varchar(255):255:notnull:-:- sq:text:-:notnull:-:-",
        "slug | unlessAuthorDeclaredSlug | collection,single | po:text:-:notnull:-:- my:varchar(255):255:notnull:-:- sq:text:-:notnull:-:-",
        "created_at | always | collection,single | po:timestamp:-:null:-:now() my:timestamp:-:null:-:CURRENT_TIMESTAMP sq:integer:-:null:-:(strftime('%s', 'now'))",
        "updated_at | always | collection,single | po:timestamp:-:null:-:now() my:timestamp:-:null:-:CURRENT_TIMESTAMP sq:integer:-:null:-:(strftime('%s', 'now'))",
        "created_by | always | collection | po:text:-:null:-:- my:varchar(191):191:null:-:- sq:text:-:null:-:-",
        "status | withStatusLifecycle | collection,single | po:varchar:20:notnull:-:'draft' my:varchar(20):20:notnull:-:'draft' sq:text:-:notnull:-:'draft'",
        "first_published_at | withStatusLifecycle | collection,single | po:timestamp:-:null:-:- my:timestamp:-:null:-:- sq:integer:-:null:-:-",
      ],
    });
  });
});
