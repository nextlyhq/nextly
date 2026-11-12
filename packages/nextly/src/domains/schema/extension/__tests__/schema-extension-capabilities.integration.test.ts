/**
 * The Payload parity matrix, against a REAL database (R-26).
 *
 * The unit file beside this one (`schema-extension-capabilities.test.ts`)
 * asserts what the compiled model says. This one is the matrix the spec
 * pins: one test per capability of the comparison with Payload
 * (`specs/schema-extensibility/research/2026-10-01-payload-v4-schema-capabilities.md`,
 * rows 1-26), and every test applies, enforces and rolls back on all three
 * dialects. The recorded exceptions are tested as recorded: a partial index
 * and the Drizzle hook's refused constructs as refusals on each dialect,
 * serial collection ids as a refusal where the collection is defined, and
 * R-24's PostgreSQL schema (whose support has not landed yet) as the refusal
 * that reads on `main` today.
 *
 * The matrix is data-driven: `CAPABILITIES` is one entry per row, and the
 * runner below applies each one on every dialect through the same path a
 * real install takes — `buildExtensionSchema` compiles the declaration, the
 * diff engine plans from an empty baseline, and the production DDL emitter
 * (`emitDdl`, the dev-push fast path) writes it. Enforcement is asserted
 * against the live database and through the diff engine's own
 * introspection; rollback drops what was applied and proves, by
 * introspection, that nothing remains.
 *
 * Runs on every dialect whose URL is set, and skips the rest rather than
 * failing — the same contract every other integration file here uses.
 * SQLite always runs, in memory.
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { createMySqlAdapter } from "@nextlyhq/adapter-mysql";
import { createPostgresAdapter } from "@nextlyhq/adapter-postgres";
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import { sql } from "drizzle-orm";
import {
  bigint as myBigint,
  check as myCheck,
  // drizzle 1.0's mysql-core names the 32-bit integer builder `int`.
  int as myInt,
  mysqlTable,
  text as myText,
  varchar as myVarchar,
} from "drizzle-orm/mysql-core";
import {
  bigint as pgBigint,
  check as pgCheck,
  index as pgIndex,
  integer as pgInteger,
  pgTable,
  text as pgText,
} from "drizzle-orm/pg-core";
import {
  check as liteCheck,
  index as liteIndex,
  integer as liteInteger,
  sqliteTable,
  text as liteText,
} from "drizzle-orm/sqlite-core";
import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import { validateCollectionConfig } from "../../../../collections/config/validate-config";
import { getDialectTables } from "../../../../database";
import { SchemaRegistry } from "../../../../database/schema-registry";
import type { NextlyServiceConfig } from "../../../../di/register";
import { NextlyError } from "../../../../errors/nextly-error";
import {
  generateEntryId,
  resolveEntryId,
} from "../../../collections/services/collection-id";
import { runEntityTransforms } from "../../../../plugins/entity-transforms";
import type { PluginContributions } from "../../../../plugins/contributions";
import type { PluginDefinition } from "../../../../plugins/plugin-context";
import { applyPluginSchemaContributions } from "../../../../plugins/schema/apply-contributions";
import { resolvePostgresSchema } from "../../services/postgres-schema";
import {
  fieldProducesColumn,
  renderDialectType,
} from "../../services/field-column-descriptor";
import { resolveCollectionTableName } from "../../utils/resolve-table-name";
import { emitDdl } from "../../pipeline/ddl-emitter";
import {
  quoteIdent,
  quoteIdentMysql,
} from "../../pipeline/ddl-emitter/identifiers";
import { diffSnapshots } from "../../pipeline/diff/diff";
import { introspectLiveSnapshot } from "../../pipeline/diff/introspect-live";
import type { Operation, TableSpec } from "../../pipeline/diff/types";
import { runAfterDrizzle, type DrizzleSchemaHook } from "../after-drizzle";
import {
  buildExtensionSchema,
  type ExtensionSchemaInput,
} from "../build-extension-schema";
import { toTableSpec } from "../compile";
import { entitySeedColumns } from "../entity-seed";
import {
  assertMayAddColumns,
  assertMayOverride,
  assertOverrideCompatible,
} from "../extension-columns";
import { col, defineTable, type TableDefinition } from "../dsl";
import type { ExtensionTable, SchemaOwner } from "../types";
import { REFUSED_CONSTRUCT_HOOKS } from "./after-drizzle-refused-constructs";

interface TestAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  executeQuery(sql: string): Promise<unknown>;
  /** The relations argument builds the RQB view; absent, plain query building. */
  getDrizzle<T = unknown>(relations?: unknown): T;
  setTableResolver(resolver: unknown): void;
}

const DIALECTS: {
  dialect: SupportedDialect;
  url: string | null;
  make: (url: string) => TestAdapter;
}[] = [
  {
    dialect: "postgresql",
    url: process.env.TEST_POSTGRES_URL ?? null,
    make: url => createPostgresAdapter({ url }) as unknown as TestAdapter,
  },
  {
    dialect: "mysql",
    url: process.env.TEST_MYSQL_URL ?? null,
    make: url => createMySqlAdapter({ url }) as unknown as TestAdapter,
  },
  {
    dialect: "sqlite",
    url: "memory",
    make: () => createSqliteAdapter({ memory: true }) as unknown as TestAdapter,
  },
];

/** Per-file isolation, so a shared server can run several files at once. */
const PREFIX = `px${randomBytes(4).toString("hex")}`;

/** The identifier quoting each dialect's DDL uses. */
function quoteName(name: string, dialect: SupportedDialect): string {
  return dialect === "mysql" ? quoteIdentMysql(name) : quoteIdent(name);
}

/** The one matrix context per dialect: the capability table runs against it. */
interface MatrixContext {
  readonly dialect: SupportedDialect;
  /** Quoted for this dialect, ready for SQL. */
  q(name: string): string;
  execute(sql: string): Promise<unknown>;
  /**
   * Apply compiled specs through the production emitter, the same routing a
   * dev push fast-path apply takes: the diff plans from an empty baseline,
   * and `emitDdl` renders what it plans. Every applied table is tracked for
   * the rollback the runner runs after the capability's assertions.
   */
  apply(specs: TableSpec[]): Promise<Operation[]>;
  /** Apply ops that are not a fresh create (a push-style follow-up). */
  applyOps(ops: Operation[]): Promise<void>;
  /** Register a table created outside `apply`, so rollback reaches it. */
  track(name: string): void;
  /** Read tables back through the same introspection the diff engine uses. */
  live(names: string[]): Promise<TableSpec[]>;
  /**
   * The adapter's Drizzle instance, for the typed-handle and RQB rows. The
   * relations argument builds the RQB view, as the registry-backed rows use.
   */
  drizzle<T>(relations?: unknown): Promise<T>;
  /** Install the schema registry the adapter resolves dynamic tables with. */
  setResolver(resolver: unknown): Promise<void>;
  /** What this capability has applied so far, in apply order. */
  applied(): string[];
}

/**
 * The harness-owned rollback every capability gets: whatever was applied is
 * dropped in reverse order (children before the parents their keys point
 * at), and the drop is proven by introspection — a table half-removed, or a
 * construct that leaked outside its tracked tables, fails here.
 */
async function rollbackApplied(ctx: MatrixContext): Promise<void> {
  const names = ctx.applied();
  for (const name of [...names].reverse()) {
    await ctx.execute(`DROP TABLE IF EXISTS ${ctx.q(name)}`);
  }
  if (names.length > 0) {
    expect(await ctx.live(names)).toEqual([]);
  }
}

// ---------------------------------------------------------------------------
// The capability table. One entry per row of the comparison with Payload.
// Each `run` applies, then enforces; the runner rolls back afterwards.
// ---------------------------------------------------------------------------

interface Capability {
  /** The row number in the pinned capability list. */
  row: number;
  title: string;
  /** Some rows boot a registry or traverse relations; they may need longer. */
  timeoutMs?: number;
  run(ctx: MatrixContext): Promise<void>;
}

const CAPABILITIES: Capability[] = [
  {
    row: 1,
    title: "add tables",
    run: async ctx => {
      const kinds = defineTable(`${PREFIX}_kinds`, {
        id: col.id(),
        name: col.shortText(),
        body: col.longText({ nullable: true }),
        count: col.integer({ default: 0 }),
        payload: col.json<{ a?: number }>({ nullable: true }),
      });
      const built = await buildExtensionSchema(
        schemaInput(ctx.dialect, {
          plugins: [{ owner: { kind: "plugin", id: "fx" }, tables: [kinds] }],
        })
      );
      const ops = await ctx.apply(built.specs);
      const name = built.specs[0]?.name ?? "";
      expect(name).toBe(`fx__${PREFIX}_kinds`);

      // The table exists with the declared columns, and the plugin's prefix
      // names it — a plugin's table, not an app's.
      const live = await ctx.live([name]);
      expect(live).toHaveLength(1);
      expect(live[0]?.columns.map(c => c.name).sort()).toEqual(
        ["id", "name", "body", "count", "payload"].sort()
      );

      // APPLY's DDL is the diff from an empty baseline: creates only.
      expect(ops.map(op => op.type)).toEqual(["add_table"]);

      // A written row reads back as written — the table is usable, not
      // merely present.
      await ctx.execute(
        `INSERT INTO ${ctx.q(name)} (${ctx.q("id")}, ${ctx.q("name")}) VALUES ('r1', 'hello')`
      );
      const rows = (await ctx.execute(
        `SELECT ${ctx.q("id")}, ${ctx.q("name")}, ${ctx.q("count")} FROM ${ctx.q(name)} WHERE ${ctx.q("id")} = 'r1'`
      )) as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.["name"]).toBe("hello");
      expect(Number(rows[0]?.["count"])).toBe(0);
    },
  },
  {
    row: 2,
    title: "hooks see every generated table",
    run: async ctx => {
      const seen: string[] = [];
      const hooked = defineTable(`${PREFIX}_hooked`, {
        id: col.id(),
        marker: col.shortText(),
      });
      const built = await buildExtensionSchema(
        schemaInput(ctx.dialect, {
          entities: [POSTS_ENTITY],
          plugins: [
            {
              owner: { kind: "plugin", id: "fx" },
              tables: [defineTable(`${PREFIX}_seeded`, { id: col.id() })],
              extend: [
                ({ schema }) => {
                  seen.push(...schema.tables().map(t => t.name));
                  schema.addTable(hooked);
                },
              ],
            },
          ],
        })
      );
      // The hook saw core and entity tables — what makes a reference to
      // `users` checkable — beside its own declaration's table, which the
      // draft already holds when the plugin's hooks run.
      expect(seen).toEqual(
        expect.arrayContaining([
          "users",
          "media",
          POSTS_TABLE,
          `fx__${PREFIX}_seeded`,
        ])
      );
      // What the hook ADDED reaches the compiled schema, and the database
      // through the same apply every other row takes.
      const hookedName = `fx__${PREFIX}_hooked`;
      expect(built.specs.map(spec => spec.name)).toContain(hookedName);
      await ctx.apply(built.specs);
      expect(await ctx.live([hookedName])).toHaveLength(1);
    },
  },
  {
    row: 3,
    title: "add columns to a generated collection table",
    run: async ctx => {
      const built = await buildExtensionSchema(
        schemaInput(ctx.dialect, {
          entities: [POSTS_ENTITY],
          plugins: [
            {
              owner: { kind: "plugin", id: "fx" },
              extend: [
                ({ schema }) => {
                  schema.extendTable(POSTS_TABLE, {
                    columns: { searchVector: col.text({ nullable: true }) },
                  });
                },
              ],
            },
          ],
        })
      );
      // Delivered as a HIDDEN column on the entity's table — never a table
      // of its own, and never a column an entry API returns.
      const contributed = built.entityColumns.get(POSTS_TABLE) ?? [];
      expect(contributed).toHaveLength(1);
      expect(contributed[0]).toMatchObject({
        name: "search_vector",
        hidden: true,
      });
      expect(built.tables).toHaveLength(0);

      // The database holds it: the entity's table with the contribution is
      // what push creates, so that shape is applied and read back, value
      // included.
      const base = defineTable(POSTS_TABLE, {
        id: col.id(),
        title: col.text({ nullable: true }),
      });
      const spec = toTableSpec(
        {
          ...extensionTable(base, { kind: "app" }),
          columns: [...base.columns.map(c => ({ ...c })), ...contributed],
        },
        ctx.dialect
      );
      await ctx.apply([spec]);
      const live = (await ctx.live([spec.name]))[0]!;
      expect(live.columns.map(c => c.name)).toContain("search_vector");
      await ctx.execute(
        `INSERT INTO ${ctx.q(spec.name)} (${ctx.q("id")}, ${ctx.q("title")}, ${ctx.q("search_vector")}) VALUES ('p1', 'one', 'vec-1')`
      );
      const rows = (await ctx.execute(
        `SELECT ${ctx.q("search_vector")} FROM ${ctx.q(spec.name)} WHERE ${ctx.q("id")} = 'p1'`
      )) as Array<Record<string, unknown>>;
      expect(rows[0]?.["search_vector"]).toBe("vec-1");
    },
  },
  {
    row: 4,
    title: "override a generated column's definition",
    run: async ctx => {
      // The rule is compile-time, within one value family, app-only.
      expect(() =>
        assertOverrideCompatible("text", "varchar", POSTS_TABLE, "city")
      ).not.toThrow();
      expect(() =>
        assertOverrideCompatible("text", "integer", POSTS_TABLE, "city")
      ).toThrow(NextlyError);
      // A plugin narrowing what the collection stores would change what
      // every reader of that field gets.
      expect(() =>
        assertMayOverride({ kind: "plugin", id: "fx" }, POSTS_TABLE, "city")
      ).toThrow(NextlyError);

      // The narrowed column is storage: the entity's table carries the
      // declared width, ENFORCED where the dialect enforces widths — MySQL
      // only. PostgreSQL compiles varchar to text (the width exists to make
      // the column indexable there), and SQLite keeps no width either, so on
      // those the narrowing is the compile-time rule above.
      const base = defineTable(POSTS_TABLE, {
        id: col.id(),
        city: col.varchar(10),
      });
      const spec = toTableSpec(
        extensionTable(base, { kind: "app" }),
        ctx.dialect
      );
      await ctx.apply([spec]);
      const live = (await ctx.live([spec.name]))[0]!;
      expect(live.columns.map(c => c.name)).toContain("city");
      await ctx.execute(
        `INSERT INTO ${ctx.q(spec.name)} (${ctx.q("id")}, ${ctx.q("city")}) VALUES ('o1', '0123456789')`
      );
      if (ctx.dialect === "mysql") {
        await expect(
          ctx.execute(
            `INSERT INTO ${ctx.q(spec.name)} (${ctx.q("id")}, ${ctx.q("city")}) VALUES ('o2', '0123456789X')`
          )
        ).rejects.toThrow();
      }
    },
  },
  {
    row: 5,
    title: "compound and unique indexes",
    run: async ctx => {
      const tagged = defineTable(
        `${PREFIX}_tagged`,
        { id: col.id(), a: col.shortText(), b: col.shortText() },
        {
          indexes: [{ columns: ["a", "b"], unique: true }, { columns: ["b"] }],
        }
      );
      const built = await buildExtensionSchema(
        schemaInput(ctx.dialect, {
          plugins: [{ owner: { kind: "plugin", id: "fx" }, tables: [tagged] }],
        })
      );
      const spec = built.specs[0]!;
      await ctx.apply([spec]);

      // Both indexes exist under the names the pipeline derives, so a later
      // diff reads them as its own and proposes nothing.
      const live = (await ctx.live([spec.name]))[0]!;
      const liveNames = (live.indexes ?? []).map(i => i.name).sort();
      for (const index of spec.indexes ?? []) {
        expect(liveNames).toContain(index.name);
      }

      // The UNIQUE compound index is ENFORCED by the database: two rows that
      // agree on (a, b) are refused, and one differing in the second column
      // is accepted — compound, not a plain duplicate check on one column.
      const q = ctx.q;
      await ctx.execute(
        `INSERT INTO ${q(spec.name)} (${q("id")}, ${q("a")}, ${q("b")}) VALUES ('t1', 'x', 'y')`
      );
      await expect(
        ctx.execute(
          `INSERT INTO ${q(spec.name)} (${q("id")}, ${q("a")}, ${q("b")}) VALUES ('t2', 'x', 'y')`
        )
      ).rejects.toThrow();
      await ctx.execute(
        `INSERT INTO ${q(spec.name)} (${q("id")}, ${q("a")}, ${q("b")}) VALUES ('t3', 'x', 'z')`
      );
    },
  },
  {
    row: 6,
    title: "partial indexes, refused on every dialect",
    run: async ctx => {
      const searched = defineTable(
        `${PREFIX}_psearched`,
        { id: col.id(), status: col.shortText() },
        {
          indexes: [
            {
              columns: ["status"],
              where: "status = 'open'",
              name: `idx_${PREFIX}_open`,
            },
          ],
        }
      );
      // The recorded exception (D7): MySQL has none, so the declaration is
      // refused where it is written — on THIS dialect too, whatever it
      // supports. Nothing is created to roll back.
      await expect(
        buildExtensionSchema(
          schemaInput(ctx.dialect, {
            plugins: [
              { owner: { kind: "plugin", id: "fx" }, tables: [searched] },
            ],
          })
        )
      ).rejects.toThrow(NextlyError);
    },
  },
  {
    row: 7,
    title: "expression indexes",
    run: async ctx => {
      const searched = defineTable(
        `${PREFIX}_searched`,
        { id: col.id(), email: col.shortText() },
        {
          indexes: [
            {
              columns: [],
              expression: "lower(email)",
              name: `idx_${PREFIX}_lower`,
            },
          ],
        }
      );
      const built = await buildExtensionSchema(
        schemaInput(ctx.dialect, {
          plugins: [
            { owner: { kind: "plugin", id: "fx" }, tables: [searched] },
          ],
        })
      );
      const spec = built.specs[0]!;
      await ctx.apply([spec]);

      // The index exists under its declared name...
      const live = (await ctx.live([spec.name]))[0]!;
      expect((live.indexes ?? []).map(i => i.name)).toContain(
        `idx_${PREFIX}_lower`
      );
      // ...and reads back as its own: the diff proposes no index work, so a
      // push that follows a push plans nothing.
      expect(
        diffSnapshots({ tables: [live] }, { tables: [spec] }).filter(
          op => op.type === "add_index" || op.type === "drop_index"
        )
      ).toEqual([]);
    },
  },
  {
    row: 8,
    title: "foreign keys with delete and update actions",
    run: async ctx => {
      const notes = defineTable(`${PREFIX}_fkn`, {
        id: col.id(),
        label: col.shortText(),
      });
      const linked = defineTable(
        `${PREFIX}_fkl`,
        { id: col.id(), noteId: col.shortText() },
        {
          indexes: [{ columns: ["noteId"] }],
          foreignKeys: [
            {
              columns: ["noteId"],
              references: { table: `fx__${PREFIX}_fkn`, columns: ["id"] },
              onDelete: "cascade",
              onUpdate: "cascade",
            },
          ],
        }
      );
      const built = await buildExtensionSchema(
        schemaInput(ctx.dialect, {
          plugins: [
            { owner: { kind: "plugin", id: "fx" }, tables: [notes, linked] },
          ],
        })
      );
      await ctx.apply(built.specs);

      const parent = built.specs[0]!;
      const child = built.specs[1]!;
      // The key the model declares is the key the database holds, with the
      // declared actions.
      const liveChild = (await ctx.live([child.name]))[0] as TableSpec;
      expect(liveChild.foreignKeys).toEqual([
        expect.objectContaining({
          columns: ["note_id"],
          referencesTable: parent.name,
          referencesColumns: ["id"],
          onDelete: "cascade",
          onUpdate: "cascade",
        }),
      ]);

      const q = ctx.q;
      await ctx.execute(
        `INSERT INTO ${q(parent.name)} (${q("id")}, ${q("label")}) VALUES ('p1', 'one')`
      );
      // ENFORCED: a child without its parent is refused.
      await expect(
        ctx.execute(
          `INSERT INTO ${q(child.name)} (${q("id")}, ${q("note_id")}) VALUES ('c0', 'missing')`
        )
      ).rejects.toThrow();
      await ctx.execute(
        `INSERT INTO ${q(child.name)} (${q("id")}, ${q("note_id")}) VALUES ('c1', 'p1')`
      );
      // The declared update action fires: updating the parent cascades to the child.
      await ctx.execute(
        `UPDATE ${q(parent.name)} SET ${q("id")} = 'p2' WHERE ${q("id")} = 'p1'`
      );
      const updatedChild = (await ctx.execute(
        `SELECT ${q("note_id")} FROM ${q(child.name)} WHERE ${q("id")} = 'c1'`
      )) as Array<Record<string, unknown>>;
      expect(updatedChild[0]?.["note_id"]).toBe("p2");

      // The declared delete action fires: deleting the parent takes the child.
      await ctx.execute(
        `DELETE FROM ${q(parent.name)} WHERE ${q("id")} = 'p2'`
      );
      const rows = (await ctx.execute(
        `SELECT ${q("id")} FROM ${q(child.name)}`
      )) as Array<Record<string, unknown>>;
      expect(rows).toEqual([]);
    },
  },
  {
    row: 9,
    title: "check constraints",
    run: async ctx => {
      const scored = defineTable(
        `${PREFIX}_scored`,
        { id: col.id(), score: col.integer({ nullable: true }) },
        { checks: [{ name: "score_ok", sql: "score >= 0" }] }
      );
      const built = await buildExtensionSchema(
        schemaInput(ctx.dialect, {
          plugins: [{ owner: { kind: "plugin", id: "fx" }, tables: [scored] }],
        })
      );
      const spec = built.specs[0]!;
      await ctx.apply([spec]);

      // The check exists under the derived name, on the live table.
      const live = (await ctx.live([spec.name]))[0]!;
      expect((live.checks ?? []).map(c => c.name)).toEqual(
        spec.checks?.map(c => c.name)
      );

      // ENFORCED: the violating value is refused by the database, the
      // conforming one is kept.
      const q = ctx.q;
      await expect(
        ctx.execute(
          `INSERT INTO ${q(spec.name)} (${q("id")}, ${q("score")}) VALUES ('s1', -1)`
        )
      ).rejects.toThrow();
      await ctx.execute(
        `INSERT INTO ${q(spec.name)} (${q("id")}, ${q("score")}) VALUES ('s2', 5)`
      );
    },
  },
  {
    row: 10,
    title: "enums",
    run: async ctx => {
      const orders = defineTable(`${PREFIX}_orders`, {
        id: col.id(),
        state: col.enum(["open", "closed", "it's"]),
        single: col.enum(["only"], { nullable: true }),
      });
      const built = await buildExtensionSchema(
        schemaInput(ctx.dialect, {
          plugins: [{ owner: { kind: "plugin", id: "fx" }, tables: [orders] }],
        })
      );
      const spec = built.specs[0]!;
      await ctx.apply([spec]);

      const live = (await ctx.live([spec.name]))[0]!;
      // The enum is carried as the one constraint all three dialects have.
      expect((live.checks ?? []).map(c => c.name).sort()).toEqual(
        (spec.checks ?? []).map(c => c.name).sort()
      );
      expect(spec.checks?.length).toBe(2);
      // And it compares equal to its declaration, so no diff proposes
      // dropping and re-adding it on every comparison.
      expect(
        diffSnapshots(
          { tables: live === undefined ? [] : [live] },
          { tables: [spec] }
        ).filter(op => op.type === "add_check" || op.type === "drop_check")
      ).toEqual([]);

      // ENFORCED: declared values are accepted, anything else is refused BY
      // THE DATABASE.
      const q = ctx.q;
      await ctx.execute(
        `INSERT INTO ${ctx.q(spec.name)} (${ctx.q("id")}, ${ctx.q("state")}, ${ctx.q("single")}) VALUES ('a', 'open', 'only')`
      );
      await expect(
        ctx.execute(
          `INSERT INTO ${ctx.q(spec.name)} (${ctx.q("id")}, ${ctx.q("state")}) VALUES ('b', 'banana')`
        )
      ).rejects.toThrow();
      await expect(
        ctx.execute(
          `INSERT INTO ${ctx.q(spec.name)} (${ctx.q("id")}, ${ctx.q("state")}, ${ctx.q("single")}) VALUES ('c', 'closed', 'other')`
        )
      ).rejects.toThrow();
    },
  },
  {
    row: 11,
    title: "any Drizzle column type through the app's escape hatch",
    run: async ctx => {
      // POSITIVE: the hook reshapes an app column with a Drizzle builder,
      // and the migration model follows the hook — the widened type is what
      // the specs describe, what the emitter writes, what the database
      // holds, and what the inserted value reads back as.
      const name = `${PREFIX}_escape`;
      const widen: DrizzleSchemaHook = ({ dialect }) => {
        if (dialect === "postgresql") {
          return {
            [name]: pgTable(name, {
              id: pgText("id").primaryKey(),
              title: pgBigint("title", { mode: "number" }),
            }),
          };
        }
        if (dialect === "mysql") {
          return {
            [name]: mysqlTable(name, {
              id: myVarchar("id", { length: 36 }).primaryKey(),
              title: myBigint("title", { mode: "number" }),
            }),
          };
        }
        return {
          [name]: sqliteTable(name, {
            id: liteText("id").primaryKey(),
            // drizzle 1.0's sqlite-core has no bigint: integer IS the
            // 64-bit column there.
            title: liteInteger("title"),
          }),
        };
      };
      const built = await buildExtensionSchema(
        schemaInput(ctx.dialect, {
          app: {
            owner: { kind: "app" },
            tables: [
              defineTable(name, { id: col.id(), title: col.shortText() }),
            ],
          },
          afterDrizzle: [widen],
        })
      );
      // A hook-only edit is dev-push-visible: the same declaration without
      // the hook fingerprints differently, so the push cache re-pushes on
      // what the hook changed and nothing else.
      const unhooked = await buildExtensionSchema(
        schemaInput(ctx.dialect, {
          app: {
            owner: { kind: "app" },
            tables: [
              defineTable(name, { id: col.id(), title: col.shortText() }),
            ],
          },
        })
      );
      expect(built.fingerprint).not.toBe(unhooked.fingerprint);
      const spec = built.specs[0]!;
      const widened = spec.columns.find(c => c.name === "title")!;
      // The converter's spelling of the widened type per dialect — NOT the
      // short text the declaration authored, which is the whole point of the
      // escape hatch.
      expect(widened.type).toBe(
        ctx.dialect === "sqlite" ? "integer" : "bigint"
      );
      await ctx.apply([spec]);
      await ctx.execute(
        `INSERT INTO ${ctx.q(spec.name)} (${ctx.q("id")}, ${ctx.q("title")}) VALUES ('w1', 5000000000)`
      );
      const rows = (await ctx.execute(
        `SELECT ${ctx.q("title")} FROM ${ctx.q(spec.name)} WHERE ${ctx.q("id")} = 'w1'`
      )) as Array<Record<string, unknown>>;
      expect(Number(rows[0]?.["title"])).toBe(5000000000);

      // REFUSED, per dialect, the constructs migrations cannot carry: a
      // generated column and a check constraint, each through its own
      // dialect's builders; on PostgreSQL, every entry of the shared
      // fixture — the list the documentation gives as the recorded
      // exception to this capability.
      const refusedBy = async (
        hook: DrizzleSchemaHook,
        construct: string
      ): Promise<void> => {
        const refused = await runAfterDrizzle({
          dialect: ctx.dialect,
          tables: {},
          hooks: [hook],
          owners: new Map([[name, { kind: "app" }]]),
          protectedTables: new Set(),
          naming: { coreTableNames: [], pluginPrefixes: [] },
        }).then(
          () => null,
          error => error
        );
        expect(NextlyError.isValidation(refused), construct).toBe(true);
        expect(JSON.stringify((refused as NextlyError).publicData)).toContain(
          construct
        );
      };
      const generated: DrizzleSchemaHook = ({ dialect }) => {
        const rc = `${PREFIX}_rcgen`;
        if (dialect === "postgresql") {
          return {
            [rc]: pgTable(rc, {
              id: pgText("id").primaryKey(),
              shout: pgText("shout").generatedAlwaysAs(sql`upper(id)`),
            }),
          };
        }
        if (dialect === "mysql") {
          return {
            [rc]: mysqlTable(rc, {
              id: myVarchar("id", { length: 36 }).primaryKey(),
              shout: myVarchar("shout", { length: 64 }).generatedAlwaysAs(
                sql`upper(id)`
              ),
            }),
          };
        }
        return {
          [rc]: sqliteTable(rc, {
            id: liteText("id").primaryKey(),
            shout: liteText("shout").generatedAlwaysAs(sql`upper(id)`),
          }),
        };
      };
      const checked: DrizzleSchemaHook = ({ dialect }) => {
        const rc = `${PREFIX}_rccheck`;
        if (dialect === "postgresql") {
          return {
            [rc]: pgTable(
              rc,
              { id: pgText("id").primaryKey(), rank: pgInteger("rank") },
              t => [pgCheck(`ck_${rc}`, sql`${t.rank} > 0`)]
            ),
          };
        }
        if (dialect === "mysql") {
          return {
            [rc]: mysqlTable(
              rc,
              {
                id: myVarchar("id", { length: 36 }).primaryKey(),
                rank: myInt("rank"),
              },
              t => [myCheck(`ck_${rc}`, sql`${t.rank} > 0`)]
            ),
          };
        }
        return {
          [rc]: sqliteTable(
            rc,
            { id: liteText("id").primaryKey(), rank: liteInteger("rank") },
            t => [liteCheck(`ck_${rc}`, sql`${t.rank} > 0`)]
          ),
        };
      };
      await refusedBy(generated, "a generated column");
      await refusedBy(checked, "a check constraint");
      if (ctx.dialect === "postgresql") {
        for (const [construct, hook] of Object.entries(
          REFUSED_CONSTRUCT_HOOKS
        )) {
          await refusedBy(hook, construct);
        }
      }
    },
  },
  {
    row: 12,
    title: "relations for typed relational queries",
    timeoutMs: 60_000,
    run: async ctx => {
      const owners = defineTable(`${PREFIX}_owners`, {
        id: col.id(),
        label: col.shortText(),
      });
      const linked = defineTable(`${PREFIX}_linked`, {
        id: col.id(),
        ownerId: col.ref(`fx__${PREFIX}_owners`),
      });
      const built = await buildExtensionSchema(
        schemaInput(ctx.dialect, {
          plugins: [
            { owner: { kind: "plugin", id: "fx" }, tables: [owners, linked] },
          ],
        })
      );
      await ctx.apply(built.specs);
      const q = ctx.q;
      await ctx.execute(
        `INSERT INTO ${q(`fx__${PREFIX}_owners`)} (${q("id")}, ${q("label")}) VALUES ('o1', 'Owner One')`
      );
      await ctx.execute(
        `INSERT INTO ${q(`fx__${PREFIX}_linked`)} (${q("id")}, ${q("owner_id")}) VALUES ('l1', 'o1')`
      );
      // The registry resolves the compiled edges, the adapter builds the
      // RQB from them, and the nested read returns the parent row through
      // the declared key.
      const registry = new SchemaRegistry(ctx.dialect);
      registry.registerStaticSchemas(getDialectTables(ctx.dialect) as never);
      for (const [tableName, table] of Object.entries(built.drizzle)) {
        registry.registerDynamicSchema(
          tableName,
          table,
          built.relations.get(tableName)
        );
      }
      await ctx.setResolver(registry);
      const rqb = await ctx.drizzle<{
        query: Record<
          string,
          {
            findMany(config?: {
              with?: Record<string, boolean>;
            }): Promise<Array<Record<string, unknown>>>;
          }
        >;
      }>(registry.getRelations());
      const rows = await rqb.query[`fx__${PREFIX}_linked`].findMany({
        with: { owner: true },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: "l1",
        ownerId: "o1",
        owner: { id: "o1", label: "Owner One" },
      });
    },
  },
  {
    row: 13,
    title: "typed access to added tables",
    run: async ctx => {
      const notes = defineTable(`${PREFIX}_typed`, {
        id: col.id(),
        title: col.shortText(),
      });
      const built = await buildExtensionSchema(
        schemaInput(ctx.dialect, {
          plugins: [{ owner: { kind: "plugin", id: "fx" }, tables: [notes] }],
        })
      );
      await ctx.apply(built.specs);
      // Typed access without codegen: the compiled handle writes and reads
      // the row as the declaration shaped it, through the adapter's own
      // Drizzle instance.
      const handle = built.drizzle[`fx__${PREFIX}_typed`];
      const db = await ctx.drizzle<{
        insert(table: unknown): {
          values(row: Record<string, unknown>): PromiseLike<unknown>;
        };
        select(): {
          from(table: unknown): PromiseLike<Array<Record<string, unknown>>>;
        };
      }>();
      await db.insert(handle).values({ id: "t1", title: "typed" });
      const rows = await db.select().from(handle);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: "t1", title: "typed" });
    },
  },
  {
    row: 14,
    title: "adopt an existing table without dropping it",
    run: async ctx => {
      const legacyName = `legacy_${PREFIX}_orders`;
      // The table exists BEFORE Nextly knows it, with data in it.
      await ctx.execute(
        `CREATE TABLE ${ctx.q(legacyName)} (${ctx.q("id")} varchar(36) PRIMARY KEY, ${ctx.q("total")} integer NOT NULL)`
      );
      ctx.track(legacyName);
      await ctx.execute(
        `INSERT INTO ${ctx.q(legacyName)} (${ctx.q("id")}, ${ctx.q("total")}) VALUES ('a1', 42)`
      );
      const legacy = defineTable(legacyName, {
        id: col.id(),
        total: col.integer(),
      });
      const built = await buildExtensionSchema(
        schemaInput(ctx.dialect, {
          app: {
            owner: { kind: "app" },
            extend: [
              ({ schema }) => {
                schema.adoptTable(legacy);
              },
            ],
          },
        })
      );
      // Structurally absent from everything that could drop or recreate it:
      // adopted, not managed — no spec on the diff's desired side.
      expect(Object.keys(built.adopted)).toEqual([legacyName]);
      expect(built.specs.find(t => t.name === legacyName)).toBeUndefined();
      // Typed access reaches it, and the data is exactly as it was —
      // adoption changed nothing about the table itself.
      const db = await ctx.drizzle<{
        select(): {
          from(table: unknown): PromiseLike<Array<Record<string, unknown>>>;
        };
      }>();
      const rows = await db.select().from(built.adopted[legacyName]!);
      expect(rows[0]).toMatchObject({ id: "a1", total: 42 });
    },
  },
  {
    row: 15,
    title: "extend core system tables",
    run: async ctx => {
      // The allowlist: the core tables carrying application data accept
      // columns; the machinery's own refuse — a broken extension there
      // fails open or strands the database.
      for (const table of ["users", "media", "nextly_jobs"]) {
        expect(() =>
          assertMayAddColumns({ kind: "core", table }, table, { kind: "app" })
        ).not.toThrow();
      }
      expect(() =>
        assertMayAddColumns(
          { kind: "core", table: "refresh_tokens" },
          "refresh_tokens",
          { kind: "app" }
        )
      ).toThrow(NextlyError);

      // The contribution reaches the database as a hidden column on the
      // core table's shape, value included.
      const built = await buildExtensionSchema(
        schemaInput(ctx.dialect, {
          app: {
            owner: { kind: "app" },
            extend: [
              ({ schema }) => {
                schema.extendTable("users", {
                  columns: { theme: col.shortText({ nullable: true }) },
                });
              },
            ],
          },
        })
      );
      const contributed = built.entityColumns.get("users") ?? [];
      expect(contributed).toHaveLength(1);
      expect(contributed[0]).toMatchObject({ name: "theme", hidden: true });

      const base = defineTable("users", {
        id: col.id(),
        email: col.shortText(),
      });
      const spec = toTableSpec(
        {
          ...extensionTable(base, { kind: "app" }),
          columns: [...base.columns.map(c => ({ ...c })), ...contributed],
        },
        ctx.dialect
      );
      await ctx.apply([spec]);
      const live = (await ctx.live([spec.name]))[0]!;
      expect(live.columns.map(c => c.name)).toContain("theme");
      await ctx.execute(
        `INSERT INTO ${ctx.q(spec.name)} (${ctx.q("id")}, ${ctx.q("email")}, ${ctx.q("theme")}) VALUES ('u1', 'a@b.c', 'dark')`
      );
      const rows = (await ctx.execute(
        `SELECT ${ctx.q("theme")} FROM ${ctx.q(spec.name)} WHERE ${ctx.q("id")} = 'u1'`
      )) as Array<Record<string, unknown>>;
      expect(rows[0]?.["theme"]).toBe("dark");
    },
  },
  {
    row: 16,
    title: "the app extending a plugin's tables",
    run: async ctx => {
      const notes = defineTable(`${PREFIX}_r16`, {
        id: col.id(),
        tag: col.shortText(),
      });
      const built = await buildExtensionSchema(
        schemaInput(ctx.dialect, {
          plugins: [{ owner: { kind: "plugin", id: "fx" }, tables: [notes] }],
          app: {
            owner: { kind: "app" },
            extend: [
              ({ schema }) => {
                schema.extendTable(`fx__${PREFIX}_r16`, {
                  columns: { appId: col.shortText({ nullable: true }) },
                  indexes: [{ columns: ["app_id"], name: `idx_${PREFIX}_app` }],
                });
              },
            ],
          },
        })
      );
      // Every contributed element is recorded to its contributor — the
      // app's migration stream carries it, and the owner's reconcile
      // excludes it.
      expect(built.elementOwners.get(`fx__${PREFIX}_r16`)).toEqual([
        {
          elementKind: "index",
          elementName: `idx_${PREFIX}_app`,
          owner: { kind: "app" },
        },
        {
          elementKind: "column",
          elementName: "app_id",
          owner: { kind: "app" },
        },
      ]);
      await ctx.apply(built.specs);
      const live = (await ctx.live([`fx__${PREFIX}_r16`]))[0]!;
      expect(live.columns.map(c => c.name)).toContain("app_id");
      expect((live.indexes ?? []).map(i => i.name)).toContain(
        `idx_${PREFIX}_app`
      );
      await ctx.execute(
        `INSERT INTO ${ctx.q(`fx__${PREFIX}_r16`)} (${ctx.q("id")}, ${ctx.q("tag")}, ${ctx.q("app_id")}) VALUES ('n1', 'x', 'app-1')`
      );
      const rows = (await ctx.execute(
        `SELECT ${ctx.q("app_id")} FROM ${ctx.q(`fx__${PREFIX}_r16`)} WHERE ${ctx.q("id")} = 'n1'`
      )) as Array<Record<string, unknown>>;
      expect(rows[0]?.["app_id"]).toBe("app-1");
    },
  },
  {
    row: 17,
    title: "added schema in migrations",
    run: async ctx => {
      const notes = defineTable(`${PREFIX}_mig`, {
        id: col.id(),
        title: col.shortText(),
      });
      const built = await buildExtensionSchema(
        schemaInput(ctx.dialect, {
          plugins: [{ owner: { kind: "plugin", id: "fx" }, tables: [notes] }],
        })
      );
      // The migration model is these specs: the diff from an empty baseline
      // plans exactly the creates migrate:create writes.
      const ops = await ctx.apply(built.specs);
      expect(ops.map(op => op.type)).toEqual(["add_table"]);
      // And once applied, the live table compares equal to its spec — a
      // migrate:create that ran now would plan nothing.
      const live = (await ctx.live(built.specs.map(s => s.name)))[0]!;
      expect(
        diffSnapshots({ tables: [live] }, { tables: built.specs })
      ).toEqual([]);
    },
  },
  {
    row: 18,
    title: "added schema in development push, hook edits included",
    run: async ctx => {
      const build = (extra: boolean) =>
        buildExtensionSchema(
          schemaInput(ctx.dialect, {
            plugins: [
              {
                owner: { kind: "plugin", id: "fx" },
                tables: [
                  defineTable(`${PREFIX}_push`, {
                    id: col.id(),
                    title: col.shortText(),
                    ...(extra
                      ? { extra: col.shortText({ nullable: true }) }
                      : {}),
                  }),
                ],
              },
            ],
          })
        );
      const before = await build(false);
      await ctx.apply(before.specs);

      // The schema-only edit moves the fingerprint, so the dev-push cache
      // re-pushes...
      const after = await build(true);
      expect(after.fingerprint).not.toBe(before.fingerprint);
      // ...the live database reads as the OLD shape, and the push plans
      // exactly the column the edit added...
      const live = (await ctx.live([`fx__${PREFIX}_push`]))[0]!;
      const ops = diffSnapshots({ tables: [live] }, { tables: after.specs });
      expect(ops.map(op => op.type)).toEqual(["add_column"]);
      // ...and the emitter applies it, leaving the database equal to the
      // new declaration.
      await ctx.applyOps(ops);
      const reread = (await ctx.live([`fx__${PREFIX}_push`]))[0]!;
      expect(reread.columns.map(c => c.name)).toContain("extra");
      expect(
        diffSnapshots({ tables: [reread] }, { tables: after.specs })
      ).toEqual([]);
    },
  },
  {
    row: 19,
    title: "a custom table name",
    run: async ctx => {
      // Payload's `dbName`. The resolver is the one answer — a dbName is
      // used as given under the collection prefix, a slug becomes the
      // prefixed form — and the resolved name is the physical table.
      expect(resolveCollectionTableName("legacy-posts")).toBe(
        "dc_legacy_posts"
      );
      const custom = resolveCollectionTableName(
        "legacy-posts",
        `legacy_${PREFIX}_orders`
      );
      expect(custom).toBe(`dc_legacy_${PREFIX}_orders`);
      const base = defineTable(custom, {
        id: col.id(),
        title: col.text({ nullable: true }),
      });
      const spec = toTableSpec(
        extensionTable(base, { kind: "app" }),
        ctx.dialect
      );
      await ctx.apply([spec]);
      expect(await ctx.live([custom])).toHaveLength(1);
      await ctx.execute(
        `INSERT INTO ${ctx.q(custom)} (${ctx.q("id")}, ${ctx.q("title")}) VALUES ('c1', 'kept')`
      );
      const rows = (await ctx.execute(
        `SELECT ${ctx.q("title")} FROM ${ctx.q(custom)} WHERE ${ctx.q("id")} = 'c1'`
      )) as Array<Record<string, unknown>>;
      expect(rows[0]?.["title"]).toBe("kept");
    },
  },
  {
    row: 20,
    title: "fields with no column",
    run: async ctx => {
      // The descriptor is the one rule every consumer honours for
      // column-less fields, and the root-level virtual flag rides it.
      expect(fieldProducesColumn({ type: "text", virtual: true })).toBe(false);
      expect(fieldProducesColumn({ type: "text" })).toBe(true);
      const fields: readonly {
        name: string;
        type: string;
        virtual?: unknown;
      }[] = [
        { name: "title", type: "text" },
        { name: "shadow", type: "text", virtual: true },
      ];
      const seeded = entitySeedColumns(
        {
          entityKind: "collection",
          tableName: `dc_${PREFIX}_virtual`,
          fields,
        },
        ctx.dialect
      );
      // The desired table has no column for the virtual field, so there is
      // no DDL, no insert, no select — the field is computed in afterRead.
      expect(seeded.map(c => c.name)).toContain("title");
      expect(seeded.map(c => c.name)).not.toContain("shadow");

      // The database agrees: the seeded shape applies, a row reads back,
      // and no shadow column exists anywhere on the table.
      const base = defineTable(`dc_${PREFIX}_virtual`, {
        id: col.id(),
        title: col.text({ nullable: true }),
      });
      const spec = toTableSpec(
        extensionTable(base, { kind: "app" }),
        ctx.dialect
      );
      await ctx.apply([spec]);
      const live = (await ctx.live([spec.name]))[0]!;
      expect(live.columns.map(c => c.name)).not.toContain("shadow");
      await ctx.execute(
        `INSERT INTO ${ctx.q(spec.name)} (${ctx.q("id")}, ${ctx.q("title")}) VALUES ('v1', 'shown')`
      );
      const rows = (await ctx.execute(
        `SELECT ${ctx.q("title")} FROM ${ctx.q(spec.name)} WHERE ${ctx.q("id")} = 'v1'`
      )) as Array<Record<string, unknown>>;
      expect(rows[0]?.["title"]).toBe("shown");
    },
  },
  {
    row: 21,
    title: "server-only custom configuration",
    run: async ctx => {
      // `custom` is configuration the server keeps for itself: it changes no
      // column, so the seeded shapes are identical with and without it.
      const plain: readonly { name: string; type: string }[] = [
        { name: "views", type: "number" },
      ];
      const customized: readonly {
        name: string;
        type: string;
        custom?: unknown;
      }[] = [
        {
          name: "views",
          type: "number",
          custom: { dashboard: { hidden: true } },
        },
      ];
      const without = entitySeedColumns(
        {
          entityKind: "collection",
          tableName: `dc_${PREFIX}_plain`,
          fields: plain,
        },
        ctx.dialect
      );
      const withCustom = entitySeedColumns(
        {
          entityKind: "collection",
          tableName: `dc_${PREFIX}_custom`,
          fields: customized,
        },
        ctx.dialect
      );
      expect(withCustom.map(c => `${c.name}:${c.kind}`)).toEqual(
        without.map(c => `${c.name}:${c.kind}`)
      );

      // And the applied table carries exactly those columns — nothing for
      // the custom object to have added.
      const base = defineTable(`dc_${PREFIX}_custom`, {
        id: col.id(),
        views: col.integer({ nullable: true }),
      });
      const spec = toTableSpec(
        extensionTable(base, { kind: "app" }),
        ctx.dialect
      );
      await ctx.apply([spec]);
      const live = (await ctx.live([spec.name]))[0]!;
      expect(live.columns.map(c => c.name)).toEqual(
        expect.arrayContaining(["id", "views"])
      );
    },
  },
  {
    row: 22,
    title: "a collection's id type",
    run: async ctx => {
      // THE RECORDED EXCEPTION (D19): `serial` is refused where the
      // collection is defined, naming col.serial() as the way to a
      // sequential number — a collection's id stays text, which every
      // relation and API path reads.
      const { errors } = validateCollectionConfig({
        slug: "orders",
        fields: [],
        db: { idType: "serial" as unknown as "uuid" },
      });
      expect(errors).toContainEqual(
        expect.objectContaining({
          path: "db.idType",
          code: "DB_ID_TYPE_INVALID",
          message: expect.stringContaining("col.serial()"),
        })
      );

      // The choice between generators changes the VALUES, never the storage:
      // version 7 shows in the version nibble, 36 characters either way, and
      // the column compiles to exactly what a plain uuid column compiles to.
      const v7 = generateEntryId({ idType: "uuidv7" });
      expect(v7).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      );
      expect(v7.length).toBe(36);
      const keyed = extensionTable(
        defineTable(`${PREFIX}_ids`, { id: col.id(), label: col.shortText() }),
        { kind: "plugin", id: "fx" },
        `fx__${PREFIX}_ids`
      );
      // APPLY the keyed table: the id column is the one text key either way,
      // and ids from either generator are stored and read back unchanged.
      await ctx.apply([toTableSpec(keyed, ctx.dialect)]);
      const q = ctx.q;
      const v4 = generateEntryId({});
      await ctx.execute(
        `INSERT INTO ${q(keyed.name)} (${q("id")}, ${q("label")}) VALUES ('${v7}', 'v7')`
      );
      await ctx.execute(
        `INSERT INTO ${q(keyed.name)} (${q("id")}, ${q("label")}) VALUES ('${v4}', 'v4')`
      );
      const rows = (await ctx.execute(
        `SELECT ${q("id")}, ${q("label")} FROM ${q(keyed.name)} ORDER BY ${q("label")}`
      )) as Array<Record<string, unknown>>;
      expect(rows.map(r => r["label"])).toEqual(["v4", "v7"]);
      // The exact strings the generators made are the ones the table holds
      // and returns — neither generator's output is reshaped on the way in.
      expect(rows.map(r => r["id"])).toEqual([v4, v7]);
    },
  },
  {
    row: 23,
    title: "a client-supplied id on create",
    run: async ctx => {
      // Opted in, the caller's id is kept; not opted in, it is ignored
      // rather than refused; opted in and malformed, refused — the key every
      // relation resolves through.
      const chosen = "018f1f77-bcf8-7c3e-9a1b-2c4d5e6f7a8b";
      expect(
        resolveEntryId({ allowIdOnCreate: true, idType: "uuidv7" }, chosen)
      ).toBe(chosen);
      expect(resolveEntryId({}, chosen)).not.toBe(chosen);
      expect(() =>
        resolveEntryId({ allowIdOnCreate: true }, "not-a-uuid")
      ).toThrow(NextlyError);

      // The column is an ordinary text key, so a kept id is stored and read
      // back exactly as the caller chose it.
      const keyed = extensionTable(
        defineTable(`${PREFIX}_clientids`, { id: col.id() }),
        { kind: "plugin", id: "fx" },
        `fx__${PREFIX}_clientids`
      );
      await ctx.apply([toTableSpec(keyed, ctx.dialect)]);
      await ctx.execute(
        `INSERT INTO ${ctx.q(keyed.name)} (${ctx.q("id")}) VALUES ('${chosen}')`
      );
      const rows = (await ctx.execute(
        `SELECT ${ctx.q("id")} FROM ${ctx.q(keyed.name)}`
      )) as Array<Record<string, unknown>>;
      expect(rows[0]?.["id"]).toBe(chosen);
    },
  },
  {
    row: 24,
    title: "a PostgreSQL schema other than public",
    run: async ctx => {
      // The recorded refusal, as `main` reads today: PostgreSQL refuses any
      // schema but public rather than honour it partly (the support itself
      // is R-24's work, and when it lands this row flips to a create-and-
      // introspect there); the dialects with no schema namespace ignore the
      // setting with a warning instead of failing an app that runs
      // perfectly. Either way the install is never pointed at a schema its
      // tables were not built in.
      if (ctx.dialect === "postgresql") {
        expect(() => resolvePostgresSchema("cms", ctx.dialect)).toThrow(
          expect.objectContaining({
            code: "NEXTLY_POSTGRES_SCHEMA_UNSUPPORTED",
          })
        );
        expect(resolvePostgresSchema("public", ctx.dialect)).toBe("public");
      } else {
        const warnings: string[] = [];
        expect(
          resolvePostgresSchema("cms", ctx.dialect, m => warnings.push(m))
        ).toBe("public");
        expect(warnings.join(" ")).toContain("no schema namespace");
      }
    },
  },
  {
    row: 25,
    title: "a plugin modifying another plugin's collections",
    run: async ctx => {
      const owned = {
        slug: "posts",
        kind: "collection" as const,
        owner: "upstream",
        definition: {
          slug: "posts",
          fields: [{ name: "title", type: "text" }],
        },
      };
      const [after] = runEntityTransforms(
        [owned],
        [
          {
            source: "plugin:fx",
            name: "fx",
            dependsOn: ["upstream"],
            transforms: [
              {
                target: "posts",
                transform: definition => ({
                  ...definition,
                  admin: { hidden: true },
                }),
              },
            ],
          },
        ]
      );
      // The transform changed an entity its plugin does not own — the gap
      // `setup(config)` had, because it ran before the merge.
      expect(
        (after?.definition as { admin?: { hidden?: boolean } })?.admin?.hidden
      ).toBe(true);

      // The changed definition is storage: the entity's columns are what the
      // database holds.
      const seeded = entitySeedColumns(
        {
          entityKind: "collection",
          tableName: `dc_${PREFIX}_posts`,
          fields: after?.definition.fields as readonly {
            name: string;
            type: string;
          }[],
        },
        ctx.dialect
      );
      expect(seeded.map(c => c.name)).toContain("title");
      const base = defineTable(`dc_${PREFIX}_posts`, {
        id: col.id(),
        title: col.text({ nullable: true }),
      });
      const spec = toTableSpec(
        extensionTable(base, { kind: "app" }),
        ctx.dialect
      );
      await ctx.apply([spec]);
      await ctx.execute(
        `INSERT INTO ${ctx.q(spec.name)} (${ctx.q("id")}, ${ctx.q("title")}) VALUES ('t1', 'hello')`
      );
      const rows = (await ctx.execute(
        `SELECT ${ctx.q("title")} FROM ${ctx.q(spec.name)} WHERE ${ctx.q("id")} = 't1'`
      )) as Array<Record<string, unknown>>;
      expect(rows[0]?.["title"]).toBe("hello");
    },
  },
  {
    row: 26,
    title: "a plugin adding fields to another plugin's collections",
    run: async ctx => {
      const merged = applyPluginSchemaContributions(cfg({ collections: [] }), [
        plugin("upstream", {
          collections: [
            { slug: "posts", fields: [{ name: "title", type: "text" }] },
          ],
        }),
        plugin(
          "fx",
          {
            extend: [
              {
                target: "posts",
                fields: [{ name: "priority", type: "number" }],
              },
            ],
          },
          { upstream: ">=0.0.0" }
        ),
      ]);
      const posts = merged.collections?.find(c => c.slug === "posts");
      expect((posts?.fields ?? []).map(f => f.name)).toContain("priority");

      // The added field is a column of the entity's table, on every
      // dialect, and it holds what was written to it.
      const seeded = entitySeedColumns(
        {
          entityKind: "collection",
          tableName: `dc_${PREFIX}_posts`,
          fields: (posts?.fields ?? []) as readonly {
            name: string;
            type: string;
          }[],
        },
        ctx.dialect
      );
      expect(seeded.map(c => c.name)).toContain("priority");
      const base = defineTable(`dc_${PREFIX}_posts`, {
        id: col.id(),
        title: col.text({ nullable: true }),
        priority: col.integer({ nullable: true }),
      });
      const spec = toTableSpec(
        extensionTable(base, { kind: "app" }),
        ctx.dialect
      );
      // The column the database holds is the one the merged config seeded —
      // same kind, same nullability — so a contribution the merge or the
      // seed mistyped never reaches the table unobserved. The seed holds the
      // column's kind and the spec the dialect's type for it (`int4` on
      // PostgreSQL, `int` on MySQL), so the kind is compared as the dialect
      // renders it.
      const seededPriority = seeded.find(c => c.name === "priority");
      const appliedPriority = spec.columns.find(c => c.name === "priority");
      expect(seededPriority?.kind).toBe("integer");
      expect(appliedPriority?.type).toBe(
        renderDialectType("integer", ctx.dialect, {})
      );
      expect(seededPriority?.nullable).toBe(appliedPriority?.nullable);
      await ctx.apply([spec]);
      const live = (await ctx.live([spec.name]))[0]!;
      expect(live.columns.map(c => c.name)).toContain("priority");
      await ctx.execute(
        `INSERT INTO ${ctx.q(spec.name)} (${ctx.q("id")}, ${ctx.q("title")}, ${ctx.q("priority")}) VALUES ('e1', 'one', 3)`
      );
      const rows = (await ctx.execute(
        `SELECT ${ctx.q("priority")} FROM ${ctx.q(spec.name)} WHERE ${ctx.q("id")} = 'e1'`
      )) as Array<Record<string, unknown>>;
      expect(Number(rows[0]?.["priority"])).toBe(3);
    },
  },
];

// ---------------------------------------------------------------------------
// Shared input + the runner
// ---------------------------------------------------------------------------

/** The input every row compiles under, overridden per row. */
function schemaInput(
  dialect: SupportedDialect,
  extra: Partial<ExtensionSchemaInput> = {}
): ExtensionSchemaInput {
  return {
    dialect,
    coreTableNames: ["users", "media"],
    entities: [],
    pluginPrefixes: new Map([["fx", "fx"]]),
    plugins: [],
    ...extra,
  };
}

/**
 * One code-first collection, as the config seeds it, for the rows whose
 * capability is about a GENERATED table.
 */
const POSTS_TABLE = `dc_${PREFIX}_posts`;
const POSTS_ENTITY: ExtensionSchemaInput["entities"][number] = {
  name: POSTS_TABLE,
  slug: "posts",
  entityKind: "collection",
  columns: [
    { name: "id", kind: "varchar", nullable: false },
    { name: "title", kind: "text", nullable: true },
  ],
};

/**
 * The `ExtensionTable` a declaration becomes, under its FINAL SQL name — the
 * same conversion `draft.addTable` performs, for rows that apply a shape the
 * draft does not own (an entity's table, an adopted one).
 */
function extensionTable(
  def: TableDefinition,
  owner: SchemaOwner,
  finalName = def.name
): ExtensionTable {
  return {
    name: finalName,
    authored: def.name,
    owner,
    columns: def.columns.map(column => ({ ...column })),
    indexes: [...def.indexes],
    ...(def.foreignKeys.length > 0
      ? { foreignKeys: [...def.foreignKeys] }
      : {}),
    ...(def.checks.length > 0 ? { checks: [...def.checks] } : {}),
    ...(def.relations.length > 0 ? { relations: [...def.relations] } : {}),
  };
}

/** Minimal config and plugin fixtures, as the apply-contributions suite uses them. */
function cfg(partial: Partial<NextlyServiceConfig>): NextlyServiceConfig {
  return { imageProcessor: {}, ...partial } as unknown as NextlyServiceConfig;
}

function plugin(
  name: string,
  contributes: PluginContributions,
  dependsOn?: Record<string, string>
): PluginDefinition {
  return {
    name,
    version: "1.0.0",
    nextly: ">=0.0.0",
    enabled: true,
    contributes,
    ...(dependsOn !== undefined ? { dependsOn } : {}),
  };
}

for (const entry of DIALECTS) {
  const suite = entry.url === null ? describe.skip : describe;

  suite(`Payload parity matrix, live (${entry.dialect})`, () => {
    let adapter: TestAdapter | undefined;
    /** Everything ever applied here, so a failing test leaves nothing. */
    const strays: string[] = [];

    async function db(): Promise<TestAdapter> {
      if (adapter === undefined) {
        adapter = entry.make(entry.url as string);
        await adapter.connect();
      }
      return adapter;
    }

    // What THIS capability has applied; reset per test, read by `applied`,
    // and handed to the rollback the runner runs after the assertions.
    let current: string[] = [];

    const ctx: MatrixContext = {
      dialect: entry.dialect,
      q: name => quoteName(name, entry.dialect),
      execute: async sql => (await db()).executeQuery(sql),
      apply: async specs => {
        const ops = diffSnapshots({ tables: [] }, { tables: specs });
        // A fresh apply is creates only: anything else here is the model
        // planning a change against an empty database, which fails loudly
        // rather than applying as if it were a create.
        for (const op of ops) {
          expect(op.type).toBe("add_table");
        }
        // Track before executing DDL so rollback and afterAll cleanup reach
        // whatever was created even if a multi-statement apply throws mid-run.
        for (const spec of specs) {
          current.push(spec.name);
          strays.push(spec.name);
        }
        await ctx.applyOps(ops);
        return ops;
      },
      applyOps: async ops => {
        const a = await db();
        for (const statement of emitDdl(ops, entry.dialect)) {
          await a.executeQuery(statement);
        }
      },
      track: name => {
        current.push(name);
        strays.push(name);
      },
      live: async names => {
        if (names.length === 0) return [];
        const snapshot = await introspectLiveSnapshot(
          (await db()).getDrizzle(),
          entry.dialect,
          names
        );
        return snapshot.tables;
      },
      drizzle: async <T>(relations?: unknown) =>
        (await db()).getDrizzle<T>(relations as never),
      setResolver: async resolver => {
        (await db()).setTableResolver(resolver);
      },
      applied: () => current,
    };

    for (const capability of CAPABILITIES) {
      it(
        `row ${capability.row} — ${capability.title}`,
        async () => {
          current = [];
          try {
            await capability.run(ctx);
          } finally {
            // Every capability rolls back, whoever wrote the row, EVEN ONE
            // THAT FAILED: a leftover table would fail the rows behind it
            // with "already exists" instead of its own finding.
            await rollbackApplied(ctx);
          }
        },
        capability.timeoutMs
      );
    }

    afterAll(async () => {
      if (adapter === undefined) return;
      for (const name of [...new Set(strays)].reverse()) {
        await adapter
          .executeQuery(
            `DROP TABLE IF EXISTS ${quoteName(name, entry.dialect)}`
          )
          .catch(() => {});
      }
      await adapter.disconnect();
    });
  });
}
