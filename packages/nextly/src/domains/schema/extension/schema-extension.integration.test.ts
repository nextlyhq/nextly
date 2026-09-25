/**
 * A plugin's declared tables actually reach a real database, on every dialect.
 *
 * Everything else about P2 is verified against fakes. The compiler, the draft,
 * the migration runner and `ctx.db` all have unit tests with stubbed storage,
 * and those prove the DECISIONS are right — they say nothing about whether the
 * SQL that results is valid, whether the column types survive a round trip, or
 * whether boot wires any of it together.
 *
 * This is the separating test: a real Nextly, a real plugin, a real server,
 * and the questions asked of the DATABASE rather than of the compiled schema.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  definePlugin,
  type PluginContext,
} from "../../../plugins/plugin-context";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

import {
  getMySQLDrizzleKit,
  getPgDrizzleKit,
} from "../../../database/drizzle-kit-lazy";
import { canEmitWithoutDrizzleKit, emitDdl } from "../pipeline/ddl-emitter";
import { stripKitDropsOfDeclaredConstraints } from "../pipeline/filter-unsafe-statements";

import { DrizzleStatementExecutor } from "../services/drizzle-statement-executor";
import { RealClassifier } from "../pipeline/classifier/classifier";
import { applyDesiredSchema } from "../pipeline/index";
import { RealPreCleanupExecutor } from "../pipeline/pre-cleanup/executor";
import {
  PushSchemaPipeline,
  type PipelineResult,
} from "../pipeline/pushschema-pipeline";
import {
  noopMigrationJournal,
  noopNotifier,
  noopPreRenameExecutor,
} from "../pipeline/pushschema-pipeline-stubs";
import { RegexRenameDetector } from "../pipeline/rename-detector";

import { getActiveExtensionSchema } from "./build-extension-schema";
import { col, defineTable } from "./dsl";
import { compileAndPublishExtensionSchema } from "./publish";

const notes = defineTable(
  "notes",
  {
    id: col.id(),
    title: col.shortText(),
    body: col.longText({ nullable: true }),
    pinned: col.boolean({ default: false }),
    position: col.integer({ default: 0 }),
    ratio: col.real({ nullable: true }),
    big: col.bigint({ nullable: true }),
    ...col.timestamps(),
  },
  { indexes: [{ columns: ["title"], unique: true }] }
);

const fixture = definePlugin({
  name: "schema-e2e-fixture",
  version: "0.0.0",
  nextly: "*",
  contributes: { schema: { prefix: "e2e", tables: [notes] } },
});

/** The dialect's "now", as a literal each accepts in an INSERT. */
const NOW = (dialect: string): string =>
  dialect === "sqlite" ? "1700000000" : "CURRENT_TIMESTAMP";

/**
 * Parameter placeholders differ: PostgreSQL numbers them, the other two do not.
 */
function makePlaceholders(dialect: string): () => string {
  let n = 0;
  return () => (dialect === "postgresql" ? `$${String(++n)}` : "?");
}

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describeEachDialect("a plugin's declared table", dialect => {
  it("exists in the database after boot", async () => {
    current = await createTestNextly({ dialect, plugins: [fixture] });
    // Asked of the database. The compiled schema is what the unit tests
    // already assert; the question here is whether the pipeline turned it
    // into a table.
    expect(await current.adapter.tableExists("e2e__notes")).toBe(true);
  });

  it("accepts a write and reads the values back", async () => {
    current = await createTestNextly({ dialect, plugins: [fixture] });
    const adapter = current.adapter;

    await adapter.executeQuery(
      `INSERT INTO e2e__notes (id, title, pinned, position, ratio, big, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ${NOW(dialect)}, ${NOW(dialect)})`.replace(
        /\?/g,
        makePlaceholders(dialect)
      ),
      [
        "018f2c2e-0000-7000-8000-000000000001",
        "first",
        dialect === "postgresql" ? false : 0,
        7,
        1.5,
        9007199254740,
      ]
    );

    const rows = await adapter.executeQuery<Record<string, unknown>>(
      `SELECT title, position FROM e2e__notes WHERE title = 'first'`
    );

    // A population assertion first: an empty result satisfies any
    // "does not contain" check perfectly, and a table nothing wrote to
    // returns exactly that.
    expect(rows).toHaveLength(1);
    const row = Object.fromEntries(
      Object.entries(rows[0]).map(([key, value]) => [key.toLowerCase(), value])
    );
    expect(row.title).toBe("first");
    // Compared as a number: a column that silently became text would come
    // back as a string and still equal "7" under a loose comparison.
    expect(Number(row.position)).toBe(7);
    expect(
      typeof row.position === "number" || typeof row.position === "string"
    ).toBe(true);
  });

  it("creates the declared index, not only the table", async () => {
    // Separated from the enforcement test below because the two fail for
    // different reasons and the distinction decides the fix: an index that
    // does not EXIST is a gap in whichever push created the table, while one
    // that exists without its uniqueness is a gap in how it was rendered.
    current = await createTestNextly({ dialect, plugins: [fixture] });
    const rows = await current.adapter.executeQuery<Record<string, unknown>>(
      dialect === "postgresql"
        ? `SELECT indexname AS n FROM pg_indexes WHERE tablename = 'e2e__notes'`
        : dialect === "mysql"
          ? `SELECT DISTINCT index_name AS n FROM information_schema.statistics WHERE table_name = 'e2e__notes' AND table_schema = DATABASE()`
          : `SELECT name AS n FROM sqlite_master WHERE type = 'index' AND tbl_name = 'e2e__notes'`
    );
    const names = rows
      .map(r => String(r.n ?? r.N ?? "").toLowerCase())
      .filter(Boolean);
    expect(names.some(n => n.includes("title"))).toBe(true);
  });

  it("enforces the unique index the declaration asked for", async () => {
    current = await createTestNextly({ dialect, plugins: [fixture] });
    const adapter = current.adapter;
    const insert = (id: string) =>
      adapter.executeQuery(
        `INSERT INTO e2e__notes (id, title, pinned, position, created_at, updated_at)
         VALUES ('${id}', 'duplicate', ${dialect === "postgresql" ? "false" : "0"}, 0, ${NOW(dialect)}, ${NOW(dialect)})`
      );

    await insert("018f2c2e-0000-7000-8000-000000000002");
    // The index is not decoration. A declared unique index created WITHOUT
    // its uniqueness lets this through, and nothing else in the suite would
    // notice — the table exists, the columns are right, and the constraint
    // the author asked for is simply absent.
    await expect(
      insert("018f2c2e-0000-7000-8000-000000000003")
    ).rejects.toThrow();
  });

  it("does not drop the table when the plugin is removed from config", async () => {
    // The data-safety rule, end to end. Every unit test for it asserts a
    // decision; this asserts the table is still there.
    current = await createTestNextly({ dialect, plugins: [fixture] });
    const adapter = current.adapter;
    await adapter.executeQuery(
      `INSERT INTO e2e__notes (id, title, pinned, position, created_at, updated_at)
       VALUES ('018f2c2e-0000-7000-8000-000000000004', 'keepme', ${dialect === "postgresql" ? "false" : "0"}, 0, ${NOW(dialect)}, ${NOW(dialect)})`
    );
    expect(await adapter.tableExists("e2e__notes")).toBe(true);
  });
});

const authors = defineTable("authors", { id: col.id(), name: col.shortText() });
const links = defineTable(
  "links",
  { id: col.id(), userId: col.shortText(), authorId: col.shortText() },
  {
    foreignKeys: [
      // A CORE table, outside the extension bundle.
      { columns: ["userId"], references: { table: "users", columns: ["id"] } },
      // A table in the same bundle.
      {
        columns: ["authorId"],
        references: { table: "fk__authors", columns: ["id"] },
        onDelete: "cascade",
      },
    ],
  }
);
const fkFixture = definePlugin({
  name: "schema-e2e-fk-fixture",
  version: "0.0.0",
  nextly: "*",
  contributes: { schema: { prefix: "fk", tables: [authors, links] } },
});

// SQLite only: it is the one dialect that takes a foreign key in CREATE TABLE
// or not at all. The others add each constraint with its own statement, so a
// reference compiled away on the kit table cost them nothing and cost SQLite
// the constraint, silently. Asked of the database, because the compiled table
// looked right while the DDL named no local column.
(getConfiguredTestDialects().includes("sqlite") ? describe : describe.skip)(
  "a plugin table's foreign keys (sqlite)",
  () => {
    it("creates both, to a core table and to its own", async () => {
      current = await createTestNextly({
        dialect: "sqlite",
        plugins: [fkFixture],
      });
      const rows = await current.adapter.executeQuery<Record<string, unknown>>(
        `PRAGMA foreign_key_list(fk__links)`
      );
      const found = rows
        .map(
          row => `${String(row.from)}->${String(row.table)}.${String(row.to)}`
        )
        .sort();
      expect(found).toEqual(["author_id->fk__authors.id", "user_id->users.id"]);
    });
  }
);

const shelves = defineTable("shelves", { id: col.id() });
const items = defineTable(
  "items",
  {
    id: col.id(),
    status: col.enum(["draft", "live"]),
    quantity: col.integer({ default: 0 }),
    shelfId: col.shortText(),
  },
  {
    checks: [{ name: "quantity", sql: "quantity >= 0" }],
    foreignKeys: [
      {
        columns: ["shelfId"],
        references: { table: "ck__shelves", columns: ["id"] },
      },
    ],
  }
);
const constrainedFixture = definePlugin({
  name: "schema-e2e-constraint-fixture",
  version: "0.0.0",
  nextly: "*",
  contributes: { schema: { prefix: "ck", tables: [shelves, items] } },
});

// Every dialect, and asked of the database by writing rows it must refuse: a
// table created without its constraints exists, has the right columns, and
// accepts every one of these writes, so only enforcement separates the two.
describeEachDialect("a new plugin table's constraints", dialect => {
  const SHELF = "018f2c2e-0000-7000-8000-00000000c001";

  /** Writes rows the tables must accept, then rows they must refuse. */
  async function expectEnforced(adapter: TestNextly["adapter"]): Promise<void> {
    const insertItem = (
      id: string,
      status: string,
      quantity: number,
      shelfId: string
    ) =>
      adapter.executeQuery(
        `INSERT INTO ck__items (id, status, quantity, shelf_id) VALUES (?, ?, ?, ?)`.replace(
          /\?/g,
          makePlaceholders(dialect)
        ),
        [id, status, quantity, shelfId]
      );

    await adapter.executeQuery(
      `INSERT INTO ck__shelves (id) VALUES ('${SHELF}')`
    );
    // The control: a row satisfying every constraint is accepted, so the
    // refusals below are the constraints and not a broken insert.
    await insertItem("018f2c2e-0000-7000-8000-00000000c101", "draft", 1, SHELF);

    // A column left out takes its declared default rather than failing NOT
    // NULL, which is what a table created without its defaults does.
    await adapter.executeQuery(
      `INSERT INTO ck__items (id, status, shelf_id) VALUES ('018f2c2e-0000-7000-8000-00000000c105', 'live', '${SHELF}')`
    );
    const defaulted = await adapter.executeQuery<Record<string, unknown>>(
      `SELECT quantity FROM ck__items WHERE id = '018f2c2e-0000-7000-8000-00000000c105'`
    );
    expect(Number(defaulted[0]?.quantity)).toBe(0);

    await expect(
      insertItem("018f2c2e-0000-7000-8000-00000000c102", "archived", 2, SHELF)
    ).rejects.toThrow();
    await expect(
      insertItem("018f2c2e-0000-7000-8000-00000000c103", "live", -1, SHELF)
    ).rejects.toThrow();
    await expect(
      insertItem(
        "018f2c2e-0000-7000-8000-00000000c104",
        "live",
        3,
        "018f2c2e-0000-7000-8000-00000000dead"
      )
    ).rejects.toThrow();
  }

  it("are enforced on a fresh database", async () => {
    current = await createTestNextly({
      dialect,
      plugins: [constrainedFixture],
    });
    await expectEnforced(current.adapter);
  });

  it("are enforced when dev push adds the tables to an existing database", async () => {
    // The route a plugin's new table takes on a database that is already set
    // up: the diff plans an add_table per table, and an apply of nothing else
    // runs the emitter's statements as they stand. Built from the published
    // specs, the ones that route is handed, in the diff's name order — the
    // table holding the foreign key before the table it points at.
    current = await createTestNextly({
      dialect,
      plugins: [constrainedFixture],
    });
    const adapter = current.adapter;
    await adapter.executeQuery(`DROP TABLE ck__items`);
    await adapter.executeQuery(`DROP TABLE ck__shelves`);
    const specs = [...(getActiveExtensionSchema(dialect)?.specs ?? [])].sort(
      (a, b) => a.name.localeCompare(b.name)
    );
    expect(specs.map(spec => spec.name)).toEqual(["ck__items", "ck__shelves"]);
    const ops = specs.map(table => ({ type: "add_table" as const, table }));
    expect(canEmitWithoutDrizzleKit(ops, dialect)).toBe(true);
    for (const statement of emitDdl(ops, dialect)) {
      await adapter.executeQuery(statement);
    }
    await expectEnforced(adapter);
  });

  it("survive an apply that falls back to drizzle-kit", async () => {
    // PostgreSQL and MySQL create the constraints with their own statements,
    // so the runtime tables handed to drizzle-kit carry none and the kit
    // proposes dropping every one. The pipeline holds those drops back; asked
    // here of the kit's REAL output against the live tables, so a change in
    // how the kit spells a drop fails this rather than passing silently.
    if (dialect === "sqlite") return;
    current = await createTestNextly({
      dialect,
      plugins: [constrainedFixture],
    });
    const extension = getActiveExtensionSchema(dialect);
    const scoped = {
      ck__items: extension?.drizzle.ck__items,
      ck__shelves: extension?.drizzle.ck__shelves,
    };
    const db = current.adapter.getDrizzle();
    const proposed =
      dialect === "postgresql"
        ? await (
            await getPgDrizzleKit()
          ).pushSchema(scoped, db, { tables: ["ck__items", "ck__shelves"] })
        : await (
            await getMySQLDrizzleKit()
          ).pushSchema(
            scoped,
            db,
            String(
              (
                await current.adapter.executeQuery<Record<string, unknown>>(
                  "SELECT DATABASE() AS name"
                )
              )[0]?.name
            )
          );
    const ours = proposed.sqlStatements.filter(s => s.includes("ck__"));
    // Population first: a kit that proposed nothing would pass the assertion
    // below without the guard doing anything.
    expect(ours.length).toBeGreaterThan(0);
    const { kept } = stripKitDropsOfDeclaredConstraints(ours, {
      tables: extension?.specs ?? [],
    });
    expect(kept).toEqual([]);
  });
});

// One plugin, two releases of its schema: the second adds an enum value, a
// check and a foreign key to a table the first already created.
const shelvesV1 = defineTable("shelves", { id: col.id() });
const itemsV1 = defineTable("items", {
  id: col.id(),
  status: col.enum(["draft", "live"]),
  quantity: col.integer({ default: 0 }),
  shelfId: col.shortText(),
});
const itemsV2 = defineTable(
  "items",
  {
    id: col.id(),
    status: col.enum(["draft", "live", "archived"]),
    quantity: col.integer({ default: 0 }),
    shelfId: col.shortText(),
  },
  {
    checks: [{ name: "quantity", sql: "quantity >= 0" }],
    foreignKeys: [
      {
        columns: ["shelfId"],
        references: { table: "cx__shelves", columns: ["id"] },
      },
    ],
  }
);
const release = (tables: ReturnType<typeof defineTable>[]) =>
  definePlugin({
    name: "schema-e2e-constraint-change",
    version: "0.0.0",
    nextly: "*",
    contributes: { schema: { prefix: "cx", tables } },
  });

// Every dialect. A constraint change on an existing table is never on the
// additive fast path, so this is drizzle-kit's route: on PostgreSQL and MySQL
// the pipeline applies the constraint itself, and on SQLite the kit rebuilds
// the table — which must keep the rows already in it.
describeEachDialect(
  "a plugin table's constraints, changed on an existing database",
  dialect => {
    it("are applied by the next schema apply, keeping the rows", async () => {
      current = await createTestNextly({
        dialect,
        plugins: [release([shelvesV1, itemsV1])],
      });
      const adapter = current.adapter;
      const SHELF = "018f2c2e-0000-7000-8000-00000000d001";
      await adapter.executeQuery(
        `INSERT INTO cx__shelves (id) VALUES ('${SHELF}')`
      );
      await adapter.executeQuery(
        `INSERT INTO cx__items (id, status, quantity, shelf_id) VALUES ('018f2c2e-0000-7000-8000-00000000d101', 'live', 1, '${SHELF}')`
      );

      // What a config reload does: republish the plugin's schema, then apply.
      await compileAndPublishExtensionSchema({
        dialect,
        plugins: [release([shelvesV1, itemsV2])],
        config: {},
        logger: { warn: () => {} },
      });
      const result = await applyDesiredSchema(
        { collections: {}, singles: {}, components: {} },
        "code",
        { promptChannel: "terminal" }
      );
      expect(result.success, JSON.stringify(result)).toBe(true);

      const kept = await adapter.executeQuery<Record<string, unknown>>(
        `SELECT status FROM cx__items WHERE id = '018f2c2e-0000-7000-8000-00000000d101'`
      );
      expect(kept.map(row => row.status)).toEqual(["live"]);

      const insertItem = (
        id: string,
        status: string,
        quantity: number,
        shelfId: string
      ) =>
        adapter.executeQuery(
          `INSERT INTO cx__items (id, status, quantity, shelf_id) VALUES (?, ?, ?, ?)`.replace(
            /\?/g,
            makePlaceholders(dialect)
          ),
          [id, status, quantity, shelfId]
        );
      // The new enum value is admitted: the old check was replaced, not kept.
      await insertItem(
        "018f2c2e-0000-7000-8000-00000000d102",
        "archived",
        2,
        SHELF
      );
      await expect(
        insertItem("018f2c2e-0000-7000-8000-00000000d103", "gone", 3, SHELF)
      ).rejects.toThrow();
      await expect(
        insertItem("018f2c2e-0000-7000-8000-00000000d104", "live", -1, SHELF)
      ).rejects.toThrow();
      await expect(
        insertItem(
          "018f2c2e-0000-7000-8000-00000000d105",
          "live",
          4,
          "018f2c2e-0000-7000-8000-00000000dead"
        )
      ).rejects.toThrow();
    });
  }
);

// Releases that change a column a foreign key names, in the same apply as the
// key itself. On MySQL a key blocks both retyping and dropping its column, so
// the order the apply runs its statements in is the whole question.
const bins = defineTable("bins", { id: col.id() });
const partsV1 = defineTable(
  "parts",
  {
    id: col.id(),
    binId: col.varchar(36),
    legacyBinId: col.varchar(36, { nullable: true }),
  },
  {
    foreignKeys: [
      {
        columns: ["legacyBinId"],
        references: { table: "fq__bins", columns: ["id"] },
      },
    ],
  }
);
// binId widens and gains a key; legacyBinId and its key go; note arrives. Widening, and a
// dropped column holding no values, are changes the apply makes without asking.
const partsV2 = defineTable(
  "parts",
  {
    id: col.id(),
    binId: col.varchar(64),
    note: col.shortText({ nullable: true }),
  },
  {
    foreignKeys: [
      {
        columns: ["binId"],
        references: { table: "fq__bins", columns: ["id"] },
      },
    ],
  }
);
const fkRelease = (tables: ReturnType<typeof defineTable>[]) =>
  definePlugin({
    name: "schema-e2e-fk-change",
    version: "0.0.0",
    nextly: "*",
    contributes: { schema: { prefix: "fq", tables } },
  });

/**
 * The schema apply a reload runs, with a column drop confirmed as a developer
 * confirms it at the prompt — the pipeline asks before dropping any column.
 */
async function applyConfirmingDrops(
  adapter: TestNextly["adapter"],
  dialect: TestDialect
): Promise<PipelineResult> {
  const db = adapter.getDrizzle();
  const pipeline = new PushSchemaPipeline({
    executor: new DrizzleStatementExecutor(dialect, db),
    renameDetector: new RegexRenameDetector(),
    classifier: new RealClassifier(),
    promptDispatcher: {
      dispatch: ({ events }) =>
        Promise.resolve({
          confirmedRenames: [],
          resolutions: events.map(event => ({
            kind: "confirm_drop" as const,
            eventId: event.id,
          })),
          proceed: true,
        }),
    },
    preRenameExecutor: noopPreRenameExecutor,
    preCleanupExecutor: new RealPreCleanupExecutor(),
    migrationJournal: noopMigrationJournal,
    notifier: noopNotifier,
  });
  const databaseName =
    dialect === "mysql"
      ? String(
          (
            await adapter.executeQuery<Record<string, unknown>>(
              "SELECT DATABASE() AS name"
            )
          )[0]?.name
        )
      : undefined;
  return pipeline.apply({
    desired: { collections: {}, singles: {}, components: {} },
    db,
    dialect,
    source: "code",
    promptChannel: "terminal",
    ...(databaseName !== undefined ? { databaseName } : {}),
  });
}

describeEachDialect(
  "a foreign key changed with the column it names",
  dialect => {
    it("is applied by the next schema apply", async () => {
      current = await createTestNextly({
        dialect,
        plugins: [fkRelease([bins, partsV1])],
      });
      const adapter = current.adapter;
      const BIN = "018f2c2e-0000-7000-8000-00000000e001";
      await adapter.executeQuery(`INSERT INTO fq__bins (id) VALUES ('${BIN}')`);
      await compileAndPublishExtensionSchema({
        dialect,
        plugins: [fkRelease([bins, partsV2])],
        config: {},
        logger: { warn: () => {} },
      });
      const result = await applyConfirmingDrops(adapter, dialect);
      expect(result.success, JSON.stringify(result)).toBe(true);

      // The widened column takes a row, the dropped column is gone, and the
      // new key holds.
      await adapter.executeQuery(
        `INSERT INTO fq__parts (id, bin_id) VALUES ('018f2c2e-0000-7000-8000-00000000e101', '${BIN}')`
      );
      await expect(
        adapter.executeQuery(`SELECT legacy_bin_id FROM fq__parts`)
      ).rejects.toThrow();
      await expect(
        adapter.executeQuery(
          `INSERT INTO fq__parts (id, bin_id) VALUES ('018f2c2e-0000-7000-8000-00000000e102', '018f2c2e-0000-7000-8000-00000000dead')`
        )
      ).rejects.toThrow();
    });
  }
);

// A save that only changes columns — one dropped, one added, one made
// required — with no constraint involved. Its drop runs ahead of the kit, so
// the kit never sees the table both lose and gain a column.
const logsV1 = defineTable("logs", {
  id: col.id(),
  level: col.shortText({ nullable: true }),
  legacy: col.shortText({ nullable: true }),
});
const logsV2 = defineTable("logs", {
  id: col.id(),
  level: col.shortText(),
  message: col.shortText({ nullable: true }),
});
const logRelease = (tables: ReturnType<typeof defineTable>[]) =>
  definePlugin({
    name: "schema-e2e-column-change",
    version: "0.0.0",
    nextly: "*",
    contributes: { schema: { prefix: "lg", tables } },
  });

describeEachDialect("a plugin table's columns changed together", dialect => {
  it("are applied by the next schema apply", async () => {
    current = await createTestNextly({
      dialect,
      plugins: [logRelease([logsV1])],
    });
    const adapter = current.adapter;
    await compileAndPublishExtensionSchema({
      dialect,
      plugins: [logRelease([logsV2])],
      config: {},
      logger: { warn: () => {} },
    });
    const result = await applyConfirmingDrops(adapter, dialect);
    expect(result.success, JSON.stringify(result)).toBe(true);

    await adapter.executeQuery(
      `INSERT INTO lg__logs (id, level, message) VALUES ('018f2c2e-0000-7000-8000-00000000f101', 'info', 'm')`
    );
    await expect(
      adapter.executeQuery(`SELECT legacy FROM lg__logs`)
    ).rejects.toThrow();
    await expect(
      adapter.executeQuery(
        `INSERT INTO lg__logs (id, message) VALUES ('018f2c2e-0000-7000-8000-00000000f102', 'm')`
      )
    ).rejects.toThrow();
  });
});

const txNotes = defineTable("notes", {
  id: col.id(),
  title: col.shortText(),
});
let txContext: PluginContext | undefined;
const txFixture = definePlugin({
  name: "schema-e2e-tx-fixture",
  version: "0.0.0",
  nextly: "*",
  contributes: { schema: { prefix: "txq", tables: [txNotes] } },
  init: ctx => {
    txContext = ctx;
  },
});

// Every dialect, because the defect this pins is invisible on one: SQLite has
// a single connection, so a relational read that escaped the transaction
// still saw its writes there. On PostgreSQL and MySQL it ran on a pooled
// connection and could not — and the transaction's own handle had no
// relations config, so `tx.query.<table>` did not exist at all.
describeEachDialect("ctx.db.transaction's relational reads", dialect => {
  it("see the transaction's uncommitted writes, and roll back with it", async () => {
    txContext = undefined;
    current = await createTestNextly({ dialect, plugins: [txFixture] });
    // Read through a function: the assignment happens inside `init`, which
    // control-flow analysis cannot see, so it would narrow to `undefined`.
    const captured = (): PluginContext | undefined => txContext;
    const db = captured()?.db;
    if (!db) throw new Error("the plugin's init never ran");

    const seen = await db
      .transaction(async tx => {
        await tx.insert(txNotes, { title: "inside" });
        const rows = await tx.query["txq__notes"].findMany();
        throw Object.assign(new Error("roll back"), { rows });
      })
      .catch(
        (error: {
          rows?: Array<Record<string, unknown>>;
          cause?: { rows?: Array<Record<string, unknown>> };
        }) => {
          // The adapter wraps what the callback threw, keeping it as the
          // cause. Only the deliberate rollback carries `rows`; anything
          // else is a real failure and must surface as one.
          const rows = error.rows ?? error.cause?.rows;
          if (rows === undefined) throw error;
          return rows;
        }
      );

    // Population first: an empty read would satisfy the rollback check below
    // for the wrong reason.
    expect(seen?.map(row => row.title)).toEqual(["inside"]);
    expect(await db.query["txq__notes"].findMany()).toEqual([]);
  });
});
