/**
 * A `nextly repair-columns` dry run against live tables on every configured dialect: it changes
 * nothing, shows each conversion's statements and cost, still reports while another schema change
 * holds the lock, and exits with the code its outcomes give.
 *
 * Tables are created by the production generator, and a legacy column is the current generator's
 * column retyped to the legacy type map's answer, as the Builder created it before its new columns
 * read the descriptor.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createContext } from "../../../../cli/context";
import { runRepairColumns } from "../../../../cli/commands/repair-columns";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import { DynamicCollectionSchemaService } from "../../../dynamic-collections/services/dynamic-collection-schema-service";
import { introspectLiveColumns } from "../../pipeline/diff/introspect-live";
import { getSchemaLockDdl, withSchemaLock } from "../../pipeline/schema-lock";
import type { SupportedDialect } from "../../services/field-column-descriptor";
import type { RepairRecord } from "../report";
import { findColumnDifferences } from "../find-differences";
import { dryRunReport } from "../run-report";
import type { RepairEntity } from "../types";

const f = (field: Record<string, unknown>) =>
  field as unknown as FieldDefinition;

const TABLE = "dc_rr_posts";

const fieldsWithAuthor = (required: boolean): FieldDefinition[] => [
  f({ name: "title", type: "text" }),
  f({
    name: "links",
    type: "repeater",
    fields: [{ name: "url", type: "text" }],
  }),
  f({ name: "author", type: "relationship", relationTo: "users", required }),
];

/** A repeater, held as text before 0.0.2-alpha.67, and a relationship that is now optional. */
const FIELDS = fieldsWithAuthor(false);
/** The same table as it was created, while the relationship was required: `author` NOT NULL. */
const CREATED_FIELDS = fieldsWithAuthor(true);

/** Fields whose columns the current generator creates exactly as their descriptors name them. */
const MATCHING_FIELDS: FieldDefinition[] = [f({ name: "title", type: "text" })];

const ROWS = 3;

/** The generator's SQL as statements a driver runs one at a time. */
function statements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .flatMap(chunk =>
      chunk
        .split("\n")
        .filter(line => !line.trim().startsWith("--"))
        .join("\n")
        .split(/;\s*(?:\n|$)/)
    )
    .map(statement => statement.trim())
    .filter(statement => statement.length > 0);
}

function entity(fields: FieldDefinition[]): RepairEntity {
  const definition = {
    fields,
    localized: false,
    origin: "collection" as const,
  };
  return {
    kind: "collection",
    slug: "rr-posts",
    table: TABLE,
    applied: { ...definition, source: "snapshot" },
    configured: definition,
  };
}

describe.each(getConfiguredTestDialects())(
  "repair-columns dry run on %s",
  dialect => {
    let handle: TestNextly;
    const run = (statement: string) => handle.adapter.executeQuery(statement);
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
    const report = (fields: FieldDefinition[] = FIELDS) =>
      dryRunReport({
        adapter: handle.adapter,
        dialect,
        entities: [entity(fields)],
        nextlyVersion: "test",
      });

    /** The table as the current generator makes it, with the legacy column where the dialect has one. */
    async function createTable(fields: FieldDefinition[], legacy: boolean) {
      const sql = new DynamicCollectionSchemaService(
        undefined,
        dialect
      ).generateMigrationSQL(TABLE, fields, {});
      for (const statement of statements(sql)) await run(statement);
      // SQLite keeps JSON as text, so its repeater column is already what the descriptor names.
      if (!legacy || dialect === "sqlite") return;
      await run(
        dialect === "postgresql"
          ? `ALTER TABLE ${q(TABLE)} ALTER COLUMN ${q("links")} TYPE text USING ${q("links")}::text`
          : `ALTER TABLE ${q(TABLE)} MODIFY ${q("links")} text NULL`
      );
    }

    async function insertRows(count: number, withAuthor = true) {
      for (let i = 1; i <= count; i++) {
        const author = withAuthor ? `, ${q("author")}` : "";
        const authorValue = withAuthor ? `, 'u${i}'` : "";
        await run(
          `INSERT INTO ${q(TABLE)} (${q("id")}, ${q("slug")}, ${q("title")}, ${q("links")}${author}) VALUES ('p${i}', 'post-${i}', 'Post ${i}', '[{"url":"https://example.com/${i}"}]'${authorValue})`
        );
      }
    }

    /** Every base table this database holds, by name. */
    async function tableNames(): Promise<string[]> {
      const rows = (await run(
        dialect === "postgresql"
          ? "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'"
          : dialect === "mysql"
            ? "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'"
            : "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
      )) as Array<{ name?: string; NAME?: string }>;
      return rows.map(row => String(row.name ?? row.NAME)).sort();
    }

    /**
     * The database as a value: every table's columns, and every row of every table, so a run that
     * changes any table, row, registry entry, ledger row or lock claim changes the value.
     */
    async function fingerprint(): Promise<string> {
      const tables = await tableNames();
      const schema = await introspectLiveColumns(
        handle.adapter.getDrizzle(),
        dialect,
        tables
      );
      const rows: Record<string, string[]> = {};
      for (const table of tables) {
        const read = (await run(`SELECT * FROM ${q(table)}`)) as unknown[];
        rows[table] = read.map(row => JSON.stringify(row)).sort();
      }
      return JSON.stringify({ schema, rows });
    }

    const at = (records: RepairRecord[], column: string) => {
      const found = records.filter(r => r.column === column);
      expect(found, column).toHaveLength(1);
      return found[0];
    };

    beforeEach(async () => {
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
    });

    afterEach(async () => {
      await run(`DROP TABLE IF EXISTS ${q(TABLE)}`);
      await handle?.destroy();
    });

    it("a dry run changes nothing", async () => {
      await createTable(CREATED_FIELDS, true);
      await insertRows(ROWS);
      const before = await fingerprint();

      const document = await report();
      expect(document.result?.records.length).toBeGreaterThan(0);
      expect(await fingerprint()).toBe(before);

      // The fingerprint sees a one-row change, so its equality above is evidence.
      await run(
        `UPDATE ${q(TABLE)} SET ${q("title")} = 'changed' WHERE ${q("id")} = 'p1'`
      );
      expect(await fingerprint()).not.toBe(before);
    });

    describe("shows the statements and the rewrite for a type change and a NOT NULL drop", () => {
      /** Each column's record from a legacy table holding ROWS rows. */
      async function legacyRecords() {
        await createTable(CREATED_FIELDS, true);
        await insertRows(ROWS);
        return (await report()).result?.records ?? [];
      }

      /** Whether dropping NOT NULL rewrites the table on each dialect. */
      const DROP_REWRITES: Record<SupportedDialect, boolean> = {
        // PostgreSQL drops NOT NULL without touching a row.
        postgresql: false,
        // MySQL rebuilds the table in place, and SQLite rebuilds it in a transaction.
        mysql: true,
        sqlite: true,
      };

      it("a NOT NULL drop", async () => {
        // The required relationship's NOT NULL, which the descriptor drops.
        const author = at(await legacyRecords(), "author");
        expect(author.outcome).toBe("would-convert");
        expect(author.live?.nullable).toBe(false);
        expect(author.expected?.nullable).toBe(true);
        expect(author.conversion?.steps.flat().join("\n")).toMatch(/author/i);
        expect(author.conversion?.rewritesTable).toBe(DROP_REWRITES[dialect]);
        expect(author.rowsRewritten).toBe(DROP_REWRITES[dialect] ? ROWS : 0);
      });

      it("a type change", async () => {
        const records = await legacyRecords();
        // A repeater's JSON is text on SQLite: there is no type change to show.
        const expected = dialect === "sqlite" ? 0 : 1;
        const links = records.filter(r => r.column === "links");
        expect(links).toHaveLength(expected);
        for (const record of links) {
          expect(record.outcome).toBe("would-convert");
          expect(record.live?.type).toBe("text");
          expect(record.conversion?.steps.flat().join("\n")).toMatch(/links/i);
          expect(record.conversion?.rewritesTable).toBe(true);
          expect(record.conversion?.blocks).toBe(
            dialect === "postgresql" ? "reads-and-writes" : "writes"
          );
          expect(record.rowsRewritten).toBe(ROWS);
        }
      });
    });

    it("counts a table's rows once for all the columns whose conversion rewrites it", async () => {
      await createTable(CREATED_FIELDS, true);
      await insertRows(ROWS);
      // The handle the report reads through, with each row count it sends counted.
      let counts = 0;
      const drizzle = handle.adapter.getDrizzle() as object;
      const counted = new Proxy(drizzle, {
        get(target, key, receiver) {
          const value: unknown = Reflect.get(target, key, receiver);
          if (typeof value !== "function") return value;
          return (...args: unknown[]) => {
            if (
              (key === "execute" || key === "all") &&
              JSON.stringify(args[0]).includes("COUNT(*) AS")
            ) {
              counts += 1;
            }
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        },
      });
      const findings = await findColumnDifferences({
        db: counted,
        dialect,
        entities: [entity(FIELDS)],
      });
      const rewriting = findings.filter(
        f => f.kind === "differs" && f.conversion?.rewritesTable === true
      );
      // MySQL rewrites the table for both the type change and the NOT NULL drop, so the count is
      // asked for twice there; PostgreSQL rewrites only for the type change, and SQLite has only
      // the NOT NULL drop.
      expect(rewriting).toHaveLength(dialect === "mysql" ? 2 : 1);
      expect(counts).toBe(1);
    });

    it("reports while the schema lock is held by another process", async () => {
      await createTable(CREATED_FIELDS, true);
      await insertRows(1);

      const free = await report();
      expect(free.result?.schemaLock).toEqual({
        state: "free",
        holder: null,
        unreadable: null,
      });
      expect(free.warnings).toEqual([]);

      const held = await withSchemaLock(
        {
          adapter: handle.adapter,
          command: "nextly migrate",
          whenHeld: "refuse",
        },
        () => report()
      );
      if (!held.ran) throw new Error("the test could not take the schema lock");
      const document = held.value;
      expect(document.result?.schemaLock.state).toBe("held");
      expect(document.result?.schemaLock.holder).toContain("`nextly migrate`");
      expect(document.warnings).toEqual([
        expect.objectContaining({
          code: "NEXTLY_REPAIR_COLUMNS_SCHEMA_CHANGE_RUNNING",
          message:
            "Another schema change is running, so this report may change once it ends.",
        }),
      ]);
      // It still reports every column.
      expect(document.result?.records.map(r => r.column).sort()).toEqual(
        free.result?.records.map(r => r.column).sort()
      );
    });

    it("exit codes for no difference, differences remaining and could not run", async () => {
      await createTable(MATCHING_FIELDS, false);
      const none = await report(MATCHING_FIELDS);
      expect(none.result?.records).toEqual([]);
      expect(none).toMatchObject({ ok: true, exitCode: 0 });

      await run(`DROP TABLE IF EXISTS ${q(TABLE)}`);
      await createTable(CREATED_FIELDS, true);
      const remain = await report();
      expect(remain).toMatchObject({ ok: false, exitCode: 2 });

      // A configuration that does not load stops the run before it reads anything.
      const env = {
        url: process.env.DATABASE_URL,
        dialect: process.env.DB_DIALECT,
      };
      process.env.DATABASE_URL =
        dialect === "sqlite" ? "file:./unused.db" : "postgres://unused";
      process.env.DB_DIALECT = dialect;
      try {
        const { document } = await runRepairColumns(
          { config: "./no-such-nextly.config.ts", json: true },
          createContext({ quiet: true })
        );
        expect(document).toMatchObject({
          ok: false,
          exitCode: 1,
          result: null,
        });
        expect(document.errors).toHaveLength(1);
      } finally {
        if (env.url === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = env.url;
        if (env.dialect === undefined) delete process.env.DB_DIALECT;
        else process.env.DB_DIALECT = env.dialect;
      }
    });
  }
);

/**
 * SQLite held in exclusive locking mode by another connection: no table's definition can be read,
 * so every column the entity names is reported as unavailable, locked, with the one read's facts,
 * and the run exits with differences remaining rather than as one that could not run.
 */
describe("repair-columns dry run on SQLite held by another connection", () => {
  type Connected = DrizzleAdapter & {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
  };
  let dir: string;
  let reader: Connected;
  let holder: Connected;

  /**
   * A connection to the file that waits briefly for a lock, so the test does not wait long. In a
   * rollback journal rather than WAL: in WAL mode a connection already open keeps its share of the
   * WAL index, which stops another from taking the database whole, while in a rollback journal the
   * holder's first write in exclusive locking mode shuts every other connection out until it
   * closes, the hold this case is about.
   */
  const open = async (file: string) => {
    const adapter = createSqliteAdapter({
      url: `file:${file}`,
      busyTimeout: 100,
      wal: false,
    }) as unknown as Connected;
    await adapter.connect();
    return adapter;
  };

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "repair-columns-held-"));
    const file = join(dir, "site.db");
    reader = await open(file);
    const sql = new DynamicCollectionSchemaService(
      undefined,
      "sqlite"
    ).generateMigrationSQL(TABLE, FIELDS, {});
    for (const statement of statements(sql)) {
      await reader.executeQuery(statement);
    }
    // The schema lock's table, as a site that has run a migration has it, so reading the lock
    // meets the held database rather than a table that does not exist.
    for (const statement of getSchemaLockDdl("sqlite")) {
      await reader.executeQuery(statement);
    }
    holder = await open(file);
    // Exclusive locking mode keeps the lock its first write takes until the connection closes.
    await holder.executeQuery("PRAGMA locking_mode = EXCLUSIVE");
    await holder.executeQuery("CREATE TABLE rr_hold (x integer)");
  });

  afterEach(async () => {
    await holder?.disconnect();
    await reader?.disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports each column the entity names as unavailable, locked, and exits 2", async () => {
    const document = await dryRunReport({
      adapter: reader,
      dialect: "sqlite",
      // A field the configuration adds and no migration has applied yet is named too.
      entities: [
        {
          ...entity(FIELDS),
          configured: {
            fields: [...FIELDS, f({ name: "subtitle", type: "text" })],
            localized: false,
            origin: "collection",
          },
        },
      ],
      nextlyVersion: "test",
    });
    const records = document.result?.records ?? [];
    expect(records.map(r => r.column).sort()).toEqual(
      ["author", "links", "subtitle", "title"].sort()
    );
    for (const record of records) {
      expect(record).toMatchObject({
        outcome: "unavailable-locked",
        differenceKnown: false,
        live: null,
        class: null,
        lock: {
          table: TABLE,
          tries: 1,
          holder: { sessions: [], wholeDatabase: true },
        },
      });
      expect(record.expected).not.toBeNull();
    }
    expect(document.result?.summary.outcomes["unavailable-locked"]).toBe(4);
    expect(document).toMatchObject({ ok: false, exitCode: 2 });
    // The lock tables could not be read either, so whether a schema change runs is unknown.
    expect(document.result?.schemaLock.state).toBe("unknown");
    expect(document.warnings.map(w => w.code)).toContain(
      "NEXTLY_REPAIR_COLUMNS_SCHEMA_LOCK_UNREADABLE"
    );
  });
});
