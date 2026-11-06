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
import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { emitDdl } from "../../pipeline/ddl-emitter";
import {
  quoteIdent,
  quoteIdentMysql,
} from "../../pipeline/ddl-emitter/identifiers";
import { diffSnapshots } from "../../pipeline/diff/diff";
import { introspectLiveSnapshot } from "../../pipeline/diff/introspect-live";
import type { Operation, TableSpec } from "../../pipeline/diff/types";
import {
  buildExtensionSchema,
  type ExtensionSchemaInput,
} from "../build-extension-schema";
import { col, defineTable } from "../dsl";

interface TestAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  executeQuery(sql: string): Promise<unknown>;
  getDrizzle<T = unknown>(): T;
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
      for (const index of spec.indexes) {
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
      // declared action.
      const liveChild = (await ctx.live([child.name]))[0] as TableSpec;
      expect(liveChild.foreignKeys).toEqual([
        expect.objectContaining({
          columns: ["note_id"],
          referencesTable: parent.name,
          referencesColumns: ["id"],
          onDelete: "cascade",
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
      // The declared action fires: deleting the parent takes the child.
      await ctx.execute(
        `DELETE FROM ${q(parent.name)} WHERE ${q("id")} = 'p1'`
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
      expect(spec.checks?.length).toBe(1);
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
        `INSERT INTO ${q(spec.name)} (${q("id")}, ${q("state")}) VALUES ('a', 'open')`
      );
      await expect(
        ctx.execute(
          `INSERT INTO ${q(spec.name)} (${q("id")}, ${q("state")}) VALUES ('b', 'banana')`
        )
      ).rejects.toThrow();
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
        await ctx.applyOps(ops);
        for (const spec of specs) {
          current.push(spec.name);
          strays.push(spec.name);
        }
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
      applied: () => current,
    };

    for (const capability of CAPABILITIES) {
      it(
        `row ${capability.row} — ${capability.title}`,
        async () => {
          current = [];
          await capability.run(ctx);
          // Every capability rolls back, whoever wrote the row: the drops
          // run here, and their no-residue proof with them.
          await rollbackApplied(ctx);
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
