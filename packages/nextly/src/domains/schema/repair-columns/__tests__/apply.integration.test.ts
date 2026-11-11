/**
 * `nextly repair-columns --apply` against live tables on every configured dialect: it takes the
 * schema lock, classes every difference again, converts each column that is safe now towards its
 * field as last applied, leaves every other column as it was with its reason, and exits with the
 * code its outcomes give.
 *
 * Tables are made by the production generator, and each legacy column is the generator's column
 * retyped to the type an older version left.
 */
import { createPostgresAdapter } from "@nextlyhq/adapter-postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import {
  readSchemaLockState,
  withSchemaLock,
} from "../../pipeline/schema-lock";
import { applyRepairs } from "../apply";
import { dryRunReport } from "../run-report";
import type { RepairEntity } from "../types";

import { asJson, collection, f, recordOf, tableTools } from "./apply-fixture";

const TABLE = "dc_ra_posts";

const LINKS = f({
  name: "links",
  type: "repeater",
  fields: [{ name: "url", type: "text" }],
});
const AUTHOR = f({
  name: "author",
  type: "relationship",
  relationTo: "users",
  required: true,
});
const PRICE = f({
  name: "price",
  type: "number",
  options: { format: "float" },
});
const SCORE = f({ name: "score", type: "number" });
const STATUS = f({
  name: "status",
  type: "select",
  options: [
    { label: "Draft", value: "draft" },
    { label: "Live", value: "live" },
  ],
});
const TITLE = f({ name: "title", type: "text" });

/** An integer a double cannot hold exactly: 2^53 + 1. */
const INEXACT = "9007199254740993";

describe.each(getConfiguredTestDialects())(
  "repair-columns --apply on %s",
  dialect => {
    let handle: TestNextly;
    const tools = tableTools(() => handle.adapter, dialect);
    const { q, run } = tools;

    const apply = (entities: RepairEntity[], extra = {}) =>
      applyRepairs({
        adapter: handle.adapter,
        dialect,
        entities,
        nextlyVersion: "test",
        ...extra,
      });
    const dryRun = (entities: RepairEntity[]) =>
      dryRunReport({
        adapter: handle.adapter,
        dialect,
        entities,
        nextlyVersion: "test",
      });

    beforeEach(async () => {
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
    });

    afterEach(async () => {
      await run(`DROP TABLE IF EXISTS ${q(TABLE)}`);
      await handle?.destroy();
    });

    it("converts every safe shape with its values read back equal", async () => {
      // Each legacy shape this dialect can hold, every one safe for these rows.
      const fields =
        dialect === "sqlite"
          ? [TITLE, AUTHOR]
          : dialect === "mysql"
            ? [TITLE, LINKS, AUTHOR, PRICE, STATUS]
            : [TITLE, LINKS, AUTHOR, PRICE];
      await tools.createTable(TABLE, fields);
      if (dialect !== "sqlite") {
        await tools.retype(TABLE, "links", "text");
        await tools.retype(TABLE, "price", "decimal(10,2)");
      }
      if (dialect === "mysql") await tools.retype(TABLE, "status", "text");
      await tools.insert(
        TABLE,
        [1, 2, 3].map(i => ({
          id: `p${i}`,
          title: `Post ${i}`,
          author: `u${i}`,
          ...(dialect !== "sqlite"
            ? { links: `[{"url":"https://example.com/${i}"}]`, price: i + 0.25 }
            : {}),
          ...(dialect === "mysql"
            ? { status: i === 1 ? "draft" : "live" }
            : {}),
        }))
      );
      const entity = collection(TABLE, fields);
      const before = (await dryRun([entity])).result?.records ?? [];
      const converting = before.map(r => r.column).sort();
      expect(converting).toEqual(
        (dialect === "sqlite"
          ? ["author"]
          : dialect === "mysql"
            ? ["author", "links", "price", "status"]
            : ["author", "links", "price"]
        ).sort()
      );
      const valuesBefore = Object.fromEntries(
        await Promise.all(
          converting.map(
            async column => [column, await tools.values(TABLE, column)] as const
          )
        )
      );

      const document = await apply([entity]);

      for (const column of converting) {
        expect(recordOf(document.result?.records, column).outcome, column).toBe(
          "converted"
        );
        // The column is now what its field names.
        const expected = recordOf(before, column).expected;
        expect(await tools.columnState(TABLE, column), column).toMatchObject({
          nullable: expected?.nullable,
        });
      }
      expect(document.result?.summary.outcomes.converted).toBe(
        converting.length
      );
      expect(document).toMatchObject({ ok: true, exitCode: 0 });
      // A second look finds nothing left to convert.
      expect((await dryRun([entity])).result?.records).toEqual([]);

      // Every value reads back as the value it was.
      for (const column of converting) {
        const after = await tools.values(TABLE, column);
        for (const [id, value] of Object.entries(valuesBefore[column])) {
          if (column === "links") {
            expect(asJson(after[id]), `${column} ${id}`).toEqual(asJson(value));
          } else if (column === "price") {
            expect(Number(after[id]), `${column} ${id}`).toBe(Number(value));
          } else {
            expect(after[id], `${column} ${id}`).toEqual(value);
          }
        }
      }
    });

    it("leaves a pending change and a plugin's column unchanged, and converts a legacy shape under a pending field to the applied definition only", async () => {
      const PLUGIN_TABLE = "dc_ra_seo";
      await tools.createTable(TABLE, [TITLE, AUTHOR]);
      await tools.createTable(PLUGIN_TABLE, [TITLE, AUTHOR]);
      try {
        await tools.insert(TABLE, [{ id: "p1", title: "12", author: "u1" }]);
        await tools.insert(PLUGIN_TABLE, [
          { id: "s1", title: "x", author: "u1" },
        ]);
        // The configuration makes the title and the author numbers, and no migration has applied
        // either. The author's column is also the legacy NOT NULL under its applied definition,
        // which is the repair this run makes.
        const pending = collection(TABLE, [TITLE, AUTHOR], {
          configured: [
            f({ name: "title", type: "number" }),
            f({ name: "author", type: "number" }),
          ],
        });
        const plugin = collection(PLUGIN_TABLE, [TITLE, AUTHOR], {
          plugin: "seo-tools",
        });
        const titleBefore = await tools.columnState(TABLE, "title");
        const pluginBefore = await tools.definition(PLUGIN_TABLE);

        const document = await apply([pending, plugin]);
        const records = document.result?.records ?? [];

        // The title's pending change is left to its migration.
        const title = records.filter(r => r.column === "title");
        expect(title.map(r => r.outcome)).toEqual(["pending-migration"]);
        expect(await tools.columnState(TABLE, "title")).toEqual(titleBefore);
        // The author is converted to its applied definition, nullable, and its pending change is
        // still reported apart.
        const author = records.filter(
          r => r.column === "author" && r.table === TABLE
        );
        expect(author.map(r => r.outcome).sort()).toEqual(
          ["converted", "pending-migration"].sort()
        );
        expect(await tools.columnState(TABLE, "author")).toMatchObject({
          nullable: true,
        });
        // The plugin's table is reported and never changed.
        expect(
          records
            .filter(r => r.table === PLUGIN_TABLE)
            .map(r => [r.column, r.outcome])
        ).toEqual([["author", "plugin-owned"]]);
        expect(await tools.definition(PLUGIN_TABLE)).toEqual(pluginBefore);
      } finally {
        await run(`DROP TABLE IF EXISTS ${q(PLUGIN_TABLE)}`);
      }
    });

    /**
     * A table with one safe, one lossy and one blocked column. SQLite keeps JSON as text, so its
     * lossy column is a word under a number field.
     */
    async function mixedTable() {
      const lossyField = dialect === "sqlite" ? SCORE : LINKS;
      const fields = [TITLE, AUTHOR, lossyField, PRICE];
      if (dialect === "sqlite") {
        await run(
          `CREATE TABLE ${q(TABLE)} (${q("id")} text PRIMARY KEY, ${q("slug")} text, ${q("title")} text, ${q("author")} text NOT NULL, ${q("score")} text, ${q("price")} integer)`
        );
      } else {
        await tools.createTable(TABLE, fields);
        await tools.retype(TABLE, "links", "text");
        await tools.retype(TABLE, "price", "bigint");
      }
      const lossyColumn = lossyField.name;
      await tools.insert(TABLE, [
        { id: "p1", title: "a", author: "u1", [lossyColumn]: "oops", price: 1 },
        { id: "p2", title: "b", author: "u2", price: 2 },
      ]);
      // MySQL blocks a 64-bit integer becoming a double whatever it holds; elsewhere the value
      // a double cannot hold exactly blocks it.
      if (dialect !== "mysql") {
        await tools.insert(TABLE, [
          { id: "p3", title: "c", author: "u3", price: INEXACT },
        ]);
      }
      return { entity: collection(TABLE, fields), lossyColumn };
    }

    it("mixes safe, lossy and blocked columns", async () => {
      const { entity, lossyColumn } = await mixedTable();
      const lossyBefore = await tools.columnState(TABLE, lossyColumn);
      const lossyValues = await tools.values(TABLE, lossyColumn);
      const priceBefore = await tools.columnState(TABLE, "price");
      const priceValues = await tools.values(TABLE, "price");

      const document = await apply([entity]);
      const records = document.result?.records;

      expect(recordOf(records, "author").outcome).toBe("converted");
      expect(await tools.columnState(TABLE, "author")).toMatchObject({
        nullable: true,
      });
      expect(recordOf(records, lossyColumn).outcome).toBe(
        "skipped-needs-consent"
      );
      expect(await tools.columnState(TABLE, lossyColumn)).toEqual(lossyBefore);
      expect(await tools.values(TABLE, lossyColumn)).toEqual(lossyValues);
      const price = recordOf(records, "price");
      expect(price.outcome).toBe("blocked");
      expect(price.reasons?.length).toBeGreaterThan(0);
      expect(await tools.columnState(TABLE, "price")).toEqual(priceBefore);
      expect(await tools.values(TABLE, "price")).toEqual(priceValues);
      expect(document).toMatchObject({ ok: false, exitCode: 2 });
    });

    it.skipIf(dialect === "mysql")(
      "a value added between the dry run and the apply that does not convert",
      async () => {
        await run(
          dialect === "sqlite"
            ? `CREATE TABLE ${q(TABLE)} (${q("id")} text PRIMARY KEY, ${q("slug")} text, ${q("title")} text, ${q("price")} integer)`
            : `CREATE TABLE ${q(TABLE)} (${q("id")} text PRIMARY KEY, ${q("slug")} text, ${q("title")} text, ${q("price")} bigint)`
        );
        await tools.insert(TABLE, [{ id: "p1", title: "a", price: 1 }]);
        const entity = collection(TABLE, [TITLE, PRICE]);
        expect(
          recordOf((await dryRun([entity])).result?.records, "price").outcome
        ).toBe("would-convert");
        await tools.insert(TABLE, [{ id: "p2", title: "b", price: INEXACT }]);
        const before = await tools.columnState(TABLE, "price");
        const values = await tools.values(TABLE, "price");

        const document = await apply([entity]);
        // The run acts on the class it finds now, not the one the dry run showed.
        expect(recordOf(document.result?.records, "price").outcome).toBe(
          "blocked"
        );
        expect(await tools.columnState(TABLE, "price")).toEqual(before);
        expect(await tools.values(TABLE, "price")).toEqual(values);
      }
    );

    it.skipIf(dialect !== "mysql")(
      "the MySQL 64-bit integer column is unchanged",
      async () => {
        await tools.createTable(TABLE, [TITLE, PRICE]);
        await tools.retype(TABLE, "price", "bigint");
        // Every stored value a double holds exactly: the pair is blocked all the same, as a value
        // written while the conversion ran could be rounded.
        await tools.insert(TABLE, [{ id: "p1", title: "a", price: 7 }]);
        const before = await tools.definition(TABLE);
        const document = await apply([collection(TABLE, [TITLE, PRICE])]);
        expect(recordOf(document.result?.records, "price").outcome).toBe(
          "blocked"
        );
        expect(await tools.definition(TABLE)).toEqual(before);
      }
    );

    it.skipIf(dialect !== "sqlite")(
      "an integer column becoming real converts when exact and is unchanged when not",
      async () => {
        const create = () =>
          run(
            `CREATE TABLE ${q(TABLE)} (${q("id")} text PRIMARY KEY, ${q("slug")} text, ${q("title")} text, ${q("price")} integer)`
          );
        const entity = collection(TABLE, [TITLE, PRICE]);
        await create();
        await tools.insert(TABLE, [{ id: "p1", title: "a", price: 3 }]);
        const exact = await apply([entity]);
        expect(recordOf(exact.result?.records, "price").outcome).toBe(
          "converted"
        );
        expect((await tools.columnState(TABLE, "price"))?.type).toBe("real");
        expect(Number((await tools.values(TABLE, "price")).p1)).toBe(3);

        await run(`DROP TABLE ${q(TABLE)}`);
        await create();
        await tools.insert(TABLE, [{ id: "p1", title: "a", price: INEXACT }]);
        const before = await tools.definition(TABLE);
        const values = await tools.values(TABLE, "price");
        const inexact = await apply([entity]);
        expect(recordOf(inexact.result?.records, "price").outcome).toBe(
          "blocked"
        );
        expect(await tools.definition(TABLE)).toEqual(before);
        expect(await tools.values(TABLE, "price")).toEqual(values);
      }
    );

    it("two safe columns of one table both end converted", async () => {
      // Each conversion is planned from the table as the one before it left it: on SQLite a
      // rebuild planned from the table as it first stood would put the first column back.
      await run(
        dialect === "sqlite"
          ? `CREATE TABLE ${q(TABLE)} (${q("id")} text PRIMARY KEY, ${q("slug")} text, ${q("title")} text, ${q("author")} text NOT NULL, ${q("price")} integer)`
          : `CREATE TABLE ${q(TABLE)} (${q("id")} varchar(36) PRIMARY KEY, ${q("slug")} text, ${q("title")} text, ${q("author")} varchar(36) NOT NULL, ${q("price")} ${dialect === "mysql" ? "decimal(10,2)" : "numeric(10,2)"})`
      );
      await tools.insert(TABLE, [
        { id: "p1", title: "a", author: "u1", price: 3 },
      ]);
      const entity = collection(TABLE, [TITLE, AUTHOR, PRICE]);
      const before = (await dryRun([entity])).result?.records ?? [];
      expect(before.map(r => r.column).sort()).toEqual(["author", "price"]);

      const document = await apply([entity]);
      expect(
        document.result?.records.map(r => [r.column, r.outcome]).sort()
      ).toEqual([
        ["author", "converted"],
        ["price", "converted"],
      ]);
      // Nothing is left: neither conversion undid the other.
      expect((await dryRun([entity])).result?.records).toEqual([]);
      expect(Number((await tools.values(TABLE, "price")).p1)).toBe(3);
    });

    it.skipIf(dialect !== "postgresql")(
      "a real column becoming double precision reads back every value as before",
      async () => {
        await run(
          `CREATE TABLE ${q(TABLE)} (${q("id")} text PRIMARY KEY, ${q("slug")} text, ${q("title")} text, ${q("price")} real)`
        );
        await tools.insert(TABLE, [
          { id: "p1", title: "a", price: 0.1 },
          { id: "p2", title: "b", price: 3.14159 },
          { id: "p3", title: "c", price: 100.7 },
        ]);
        // Each value as the database prints it, which is what the field reads.
        const printed = async () =>
          Object.fromEntries(
            (
              (await run(
                `SELECT ${q("id")} AS id, ${q("price")}::text AS v FROM ${q(TABLE)}`
              )) as Array<{ id: string; v: string }>
            ).map(row => [row.id, row.v])
          );
        const before = await printed();
        expect(before).toEqual({ p1: "0.1", p2: "3.14159", p3: "100.7" });
        const entity = collection(TABLE, [TITLE, PRICE]);
        expect(
          recordOf((await dryRun([entity])).result?.records, "price").class
        ).toBe("safe");

        const document = await apply([entity]);
        expect(recordOf(document.result?.records, "price").outcome).toBe(
          "converted"
        );
        expect((await tools.columnState(TABLE, "price"))?.type).toMatch(
          /double precision|float8/
        );
        expect(await printed()).toEqual(before);
      }
    );

    it("reads the entities it converts towards only once it holds the schema lock", async () => {
      // Read before the lock, a migration finishing while the run waited would leave it comparing
      // the migrated columns with the definitions from before, and converting them back.
      await tools.createTable(TABLE, [TITLE, AUTHOR]);
      await tools.insert(TABLE, [{ id: "p1", title: "a", author: "u1" }]);
      const seen: string[] = [];
      const document = await applyRepairs({
        adapter: handle.adapter,
        dialect,
        nextlyVersion: "test",
        entities: async () => {
          seen.push((await readSchemaLockState(handle.adapter)).state);
          return [collection(TABLE, [TITLE, AUTHOR])];
        },
      });
      expect(seen).toEqual(["held"]);
      expect(recordOf(document.result?.records, "author").outcome).toBe(
        "converted"
      );
    });

    it("changes nothing while the schema lock is held", async () => {
      await tools.createTable(TABLE, [TITLE, AUTHOR]);
      await tools.insert(TABLE, [{ id: "p1", title: "a", author: "u1" }]);
      const before = await tools.definition(TABLE);
      const entity = collection(TABLE, [TITLE, AUTHOR]);

      // Another run holds the lock, in its own async context, until the test lets it go.
      let release!: () => void;
      const released = new Promise<void>(resolve => {
        release = resolve;
      });
      let holding!: () => void;
      const held = new Promise<void>(resolve => {
        holding = resolve;
      });
      const holder = withSchemaLock(
        {
          adapter: handle.adapter,
          command: "nextly migrate",
          whenHeld: "refuse",
        },
        async () => {
          holding();
          await released;
        }
      );
      await held;
      try {
        await expect(
          apply([entity], { schemaLockWaitMs: 300 })
        ).rejects.toMatchObject({ code: "NEXTLY_MIGRATE_LOCK_BUSY" });
      } finally {
        release();
        await holder;
      }
      expect(await tools.definition(TABLE)).toEqual(before);
      // No record of a repair was made, nor the place one would be kept.
      const tables = (await run(
        dialect === "postgresql"
          ? "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema()"
          : dialect === "mysql"
            ? "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()"
            : "SELECT name FROM sqlite_master WHERE type = 'table'"
      )) as Array<{ name?: string; NAME?: string }>;
      expect(tables.map(t => String(t.name ?? t.NAME))).not.toContain(
        "nextly_column_repairs"
      );
    });

    it.skipIf(dialect !== "mysql")(
      "MySQL select held as text: converts when it fits, blocked when a value is longer",
      async () => {
        const OTHER = "dc_ra_pages";
        await tools.createTable(TABLE, [TITLE, STATUS]);
        await tools.createTable(OTHER, [TITLE, STATUS]);
        try {
          await tools.retype(TABLE, "status", "text");
          await tools.retype(OTHER, "status", "text");
          await tools.insert(TABLE, [
            { id: "p1", title: "a", status: "draft" },
          ]);
          await tools.insert(OTHER, [
            { id: "q1", title: "a", status: "x".repeat(256) },
          ]);
          const otherBefore = await tools.definition(OTHER);
          const otherValues = await tools.values(OTHER, "status");

          const document = await apply([
            collection(TABLE, [TITLE, STATUS]),
            collection(OTHER, [TITLE, STATUS]),
          ]);
          const records = document.result?.records ?? [];
          const fits = records.find(
            r => r.table === TABLE && r.column === "status"
          );
          const longer = records.find(
            r => r.table === OTHER && r.column === "status"
          );
          expect(fits?.outcome).toBe("converted");
          expect(await tools.columnState(TABLE, "status")).toMatchObject({
            type: "varchar(255)",
          });
          expect((await tools.values(TABLE, "status")).p1).toBe("draft");
          expect(longer?.outcome).toBe("blocked");
          expect(longer?.reasons?.[0]?.rows?.first).toEqual([{ id: "q1" }]);
          expect(await tools.definition(OTHER)).toEqual(otherBefore);
          expect(await tools.values(OTHER, "status")).toEqual(otherValues);
        } finally {
          await run(`DROP TABLE IF EXISTS ${q(OTHER)}`);
        }
      }
    );

    it.skipIf(dialect === "mysql")("no such difference", async () => {
      // A select's column is what its field names on PostgreSQL and SQLite, so there is nothing
      // for a MySQL-only narrowing to meet.
      await tools.createTable(TABLE, [TITLE, STATUS]);
      await tools.insert(TABLE, [
        { id: "p1", title: "a", status: "x".repeat(300) },
      ]);
      const document = await apply([collection(TABLE, [TITLE, STATUS])]);
      expect(document.result?.records).toEqual([]);
    });

    it.skipIf(dialect !== "mysql")(
      "a conversion the database refuses to run as reported ends failed and is not run another way",
      async () => {
        // A NOT NULL drop is reported as running in place, with reads and writes continuing.
        // MySQL cannot rebuild a table holding a FULLTEXT index in place, so it refuses.
        await tools.createTable(TABLE, [TITLE, AUTHOR]);
        await run(
          `ALTER TABLE ${q(TABLE)} ADD FULLTEXT INDEX ${q("ra_title_ft")} (${q("title")})`
        );
        await tools.insert(TABLE, [{ id: "p1", title: "a", author: "u1" }]);
        const entity = collection(TABLE, [TITLE, AUTHOR]);
        const reported = recordOf(
          (await dryRun([entity])).result?.records,
          "author"
        );
        expect(reported.conversion?.blocks).toBe("brief-locks");
        const before = await tools.definition(TABLE);

        const document = await apply([entity]);
        const author = recordOf(document.result?.records, "author");
        expect(author.outcome).toBe("failed");
        expect(author.failure?.reason).toMatch(
          /ALGORITHM=INPLACE is not supported/
        );
        // Left exactly as it was: not run by copying instead.
        expect(await tools.definition(TABLE)).toEqual(before);
        expect(document.exitCode).toBe(3);
      }
    );

    it.skipIf(dialect !== "postgresql")(
      "what waits and what continues during a type change and a NOT NULL drop is what the report said",
      async () => {
        // PostgreSQL closes the table to reads and writes for both changes, as the report says;
        // the table is closed before the rows are judged, so it is closed when each step starts.
        await tools.createTable(TABLE, [TITLE, LINKS, AUTHOR]);
        await tools.retype(TABLE, "links", "text");
        await tools.insert(TABLE, [
          { id: "p1", title: "a", links: "[]", author: "u1" },
        ]);
        const entity = collection(TABLE, [TITLE, LINKS, AUTHOR]);
        const reported = (await dryRun([entity])).result?.records ?? [];
        for (const column of ["links", "author"]) {
          expect(recordOf(reported, column).conversion?.blocks).toBe(
            "reads-and-writes"
          );
        }
        // A second session reading, then writing, while each step starts; each gives up after
        // a short wait rather than hold the test.
        const seen: Record<string, { read: string; write: string }> = {};
        // Its own connection pool, so it is another session, never the run's own transaction.
        // The harness points DATABASE_URL at this test's own database.
        const other = createPostgresAdapter({
          url: process.env.DATABASE_URL as string,
        });
        await other.connect();
        const attempt = async (statement: string) => {
          try {
            await other.transaction(async ctx => {
              await ctx.execute("SET LOCAL lock_timeout = '300ms'");
              await ctx.execute(statement);
            });
            return "continued";
          } catch (error) {
            // Only a lock timeout is a wait; any other error is the test's own fault.
            if (
              /lock timeout/i.test(String((error as Error).message ?? error))
            ) {
              return "waited";
            }
            throw error;
          }
        };
        const document = await apply([entity], {
          beforeStep: async ({ column }: { column: string }) => {
            seen[column] = {
              read: await attempt(`SELECT * FROM ${q(TABLE)}`),
              write: await attempt(
                `UPDATE ${q(TABLE)} SET ${q("title")} = 'b' WHERE ${q("id")} = 'p1'`
              ),
            };
          },
        });
        expect(recordOf(document.result?.records, "links").outcome).toBe(
          "converted"
        );
        expect(recordOf(document.result?.records, "author").outcome).toBe(
          "converted"
        );
        // Once the run has ended, the same session reads at once: its waits above were the run's.
        const after = await attempt(`SELECT * FROM ${q(TABLE)}`);
        await other.disconnect();
        expect(seen).toEqual({
          links: { read: "waited", write: "waited" },
          author: { read: "waited", write: "waited" },
        });
        expect(after).toBe("continued");
      }
    );

    it("one failing column among several, and failed with blocked exits with the failed code", async () => {
      const { entity } = await mixedTable();
      const SECOND = "dc_ra_pages";
      await tools.createTable(SECOND, [TITLE, AUTHOR]);
      try {
        await tools.insert(SECOND, [{ id: "q1", title: "a", author: "u1" }]);
        const secondBefore = await tools.definition(SECOND);
        // The first table's author converts; the second's fails as its step starts, as a
        // database refusing it would.
        const document = await apply(
          [entity, collection(SECOND, [TITLE, AUTHOR])],
          {
            beforeStep: ({ table }: { table: string }) => {
              if (table === SECOND) {
                throw new Error("the database refused the statement");
              }
              return Promise.resolve();
            },
          }
        );
        const records = document.result?.records ?? [];
        const failed = records.find(
          r => r.table === SECOND && r.column === "author"
        );
        expect(failed?.outcome).toBe("failed");
        expect(failed?.failure?.reason).toContain(
          "the database refused the statement"
        );
        expect(await tools.definition(SECOND)).toEqual(secondBefore);
        expect(
          records.find(r => r.table === TABLE && r.column === "author")?.outcome
        ).toBe("converted");
        expect(
          records.find(r => r.table === TABLE && r.column === "price")?.outcome
        ).toBe("blocked");
        // Each outcome counted, and a failure among blocked columns exits with the failed code.
        expect(document.result?.summary.outcomes).toMatchObject({
          converted: 1,
          failed: 1,
          blocked: 1,
          "skipped-needs-consent": 1,
        });
        expect(document).toMatchObject({ ok: false, exitCode: 3 });
      } finally {
        await run(`DROP TABLE IF EXISTS ${q(SECOND)}`);
      }
    });
  }
);
