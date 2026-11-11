/**
 * A value written after a column was last judged is never cut, coerced, changed or cleared by its
 * conversion.
 *
 * On PostgreSQL and SQLite the judgement and the change share one transaction that keeps writes
 * out, so a write made while the conversion runs waits until it has ended and every value the
 * conversion copied reads back as it was. On MySQL each schema statement commits on its own, so a
 * value can land between the judgement and the change; strict mode then refuses it, and the column
 * fails and keeps the written value.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { createPostgresAdapter } from "@nextlyhq/adapter-postgres";
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { applyRepairs } from "../apply";

import { collection, f, recordOf, tableTools } from "./apply-fixture";

const TABLE = "dc_rl_posts";

const TITLE = f({ name: "title", type: "text" });
const PRICE = f({
  name: "price",
  type: "number",
  options: { format: "float" },
});
const LINKS = f({
  name: "links",
  type: "repeater",
  fields: [{ name: "url", type: "text" }],
});
const STATUS = f({
  name: "status",
  type: "select",
  options: [{ label: "Draft", value: "draft" }],
});

/** An integer a double cannot hold exactly: 2^53 + 1. */
const INEXACT = "9007199254740993";

/** Whether `promise` settles within `ms`. */
async function settlesWithin(
  promise: Promise<unknown>,
  ms: number
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<false>(resolve => {
    timer = setTimeout(() => resolve(false), ms);
  });
  const settled = promise.then(
    () => true,
    () => true
  );
  const result = await Promise.race([settled, late]);
  clearTimeout(timer);
  return result;
}

const dialects = getConfiguredTestDialects();

describe.each(dialects.filter(d => d === "postgresql"))(
  "a late write on %s",
  dialect => {
    let handle: TestNextly;
    const tools = tableTools(() => handle.adapter, dialect);
    const { q, run } = tools;

    beforeEach(async () => {
      handle = await createTestNextly({ dialect });
    });

    afterEach(async () => {
      await run(`DROP TABLE IF EXISTS ${q(TABLE)}`);
      await handle?.destroy();
    });

    it("a late write of an inexact integer waits until the conversion ends and every copied value reads back equal", async () => {
      await run(
        `CREATE TABLE ${q(TABLE)} (${q("id")} text PRIMARY KEY, ${q("slug")} text, ${q("title")} text, ${q("price")} bigint)`
      );
      await tools.insert(TABLE, [
        { id: "p1", title: "a", price: 1 },
        { id: "p2", title: "b", price: 2 },
      ]);
      const before = await tools.values(TABLE, "price");
      // Another session, on its own connections; the harness points DATABASE_URL at this test's
      // database.
      const other = createPostgresAdapter({
        url: process.env.DATABASE_URL as string,
      });
      await other.connect();
      let write: Promise<unknown> | undefined;
      let waited = false;
      try {
        const document = await applyRepairs({
          adapter: handle.adapter,
          dialect,
          entities: [collection(TABLE, [TITLE, PRICE])],
          nextlyVersion: "test",
          beforeStep: async () => {
            write = other.executeQuery(
              `INSERT INTO ${q(TABLE)} (${q("id")}, ${q("title")}, ${q("price")}) VALUES ('late', 'c', ${INEXACT})`
            );
            waited = !(await settlesWithin(write, 300));
          },
        });
        expect(recordOf(document.result?.records, "price").outcome).toBe(
          "converted"
        );
        expect(waited).toBe(true);
        // The write goes through once the conversion has ended.
        await write;
      } finally {
        await other.disconnect();
      }
      const after = await tools.values(TABLE, "price");
      for (const [id, value] of Object.entries(before)) {
        expect(Number(after[id]), id).toBe(Number(value));
      }
      expect(Object.keys(after)).toContain("late");
    });
  }
);

/**
 * SQLite on a file, so a second connection can try to write while the conversion holds the
 * database's write lock. Its short busy wait makes it give up rather than wait the whole run.
 */
describe.skipIf(!dialects.includes("sqlite"))("a late write on sqlite", () => {
  type Connected = DrizzleAdapter & {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
  };
  let dir: string;
  let site: Connected;
  let writer: Connected;
  let booted: TestNextly;
  const tools = tableTools(() => site, "sqlite");

  const open = async (file: string, busyTimeout: number) => {
    const adapter = createSqliteAdapter({
      url: `file:${file}`,
      busyTimeout,
    }) as unknown as Connected;
    await adapter.connect();
    return adapter;
  };

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "repair-columns-late-"));
    const file = join(dir, "site.db");
    site = await open(file, 5000);
    // Booted as a site, so its core tables, the lock tables among them, exist as after a migrate.
    booted = await createTestNextly({ adapter: site });
    writer = await open(file, 100);
  });

  afterEach(async () => {
    await writer?.disconnect();
    // Disconnects the site's adapter too.
    await booted?.destroy();
    rmSync(dir, { recursive: true, force: true });
  });

  it("a late write of an inexact integer waits until the conversion ends and every copied value reads back equal", async () => {
    await site.executeQuery(
      `CREATE TABLE "${TABLE}" ("id" text PRIMARY KEY, "slug" text, "title" text, "price" integer)`
    );
    await tools.insert(TABLE, [
      { id: "p1", title: "a", price: 1 },
      { id: "p2", title: "b", price: 2 },
    ]);
    const before = await tools.values(TABLE, "price");
    const late = `INSERT INTO "${TABLE}" ("id", "title", "price") VALUES ('late', 'c', ${INEXACT})`;
    let refusedWhileRunning: unknown = null;
    const document = await applyRepairs({
      adapter: site,
      dialect: "sqlite",
      entities: [collection(TABLE, [TITLE, PRICE])],
      nextlyVersion: "test",
      beforeStep: async () => {
        try {
          await writer.executeQuery(late);
        } catch (error) {
          refusedWhileRunning = error;
        }
      },
    });
    expect(recordOf(document.result?.records, "price").outcome).toBe(
      "converted"
    );
    // The write could not land while the conversion held the database.
    expect(String((refusedWhileRunning as Error | null)?.message)).toMatch(
      /locked|busy/i
    );
    // Once it has ended, the same write goes through.
    await writer.executeQuery(late);
    const after = await tools.values(TABLE, "price");
    for (const [id, value] of Object.entries(before)) {
      expect(Number(after[id]), id).toBe(Number(value));
    }
  });
});

describe.each(dialects.filter(d => d === "mysql"))(
  "a late write on %s",
  dialect => {
    let handle: TestNextly;
    const tools = tableTools(() => handle.adapter, dialect);
    const { q, run } = tools;

    beforeEach(async () => {
      handle = await createTestNextly({ dialect });
    });

    afterEach(async () => {
      await run(`DROP TABLE IF EXISTS ${q(TABLE)}`);
      await handle?.destroy();
    });

    it("a late unparseable text and a late over-long select value each fail the column, which holds the written value", async () => {
      await tools.createTable(TABLE, [TITLE, LINKS, STATUS]);
      await tools.retype(TABLE, "links", "text");
      await tools.retype(TABLE, "status", "text");
      await tools.insert(TABLE, [
        { id: "p1", title: "a", links: "[]", status: "draft" },
      ]);
      const longer = "x".repeat(300);
      const lateValue: Record<string, string> = {
        links: "not json",
        status: longer,
      };
      const before = await tools.definition(TABLE);

      // Each value lands after its column was judged and before its conversion runs.
      const document = await applyRepairs({
        adapter: handle.adapter,
        dialect,
        entities: [collection(TABLE, [TITLE, LINKS, STATUS])],
        nextlyVersion: "test",
        beforeStep: async ({ column }: { column: string }) => {
          await run(
            `UPDATE ${q(TABLE)} SET ${q(column)} = '${lateValue[column]}' WHERE ${q("id")} = 'p1'`
          );
        },
      });

      for (const column of ["links", "status"]) {
        const record = recordOf(document.result?.records, column);
        expect(record.outcome, column).toBe("failed");
        expect(record.failure?.reason, column).not.toBe("");
        // The column holds the written value, neither cut nor cleared.
        const value = (await tools.values(TABLE, column)).p1;
        expect(value, column).toBe(lateValue[column]);
      }
      expect(await tools.definition(TABLE)).toEqual(before);
      expect(document.exitCode).toBe(3);
    });
  }
);
