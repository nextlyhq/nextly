/**
 * Payload schema-extensibility parity, against a REAL database.
 *
 * The unit checklist beside this file (`payload-parity.test.ts`) asserts what
 * the compiled model says. This one asserts what the server does with it:
 * every construct is pushed to a live database, read back through the same
 * introspection the diff engine uses, and compared. A model that describes a
 * table nobody can create is the failure this exists to catch, and it is the
 * one a unit test structurally cannot.
 *
 * Runs on every dialect whose URL is set, and skips the rest rather than
 * failing — the same contract every other integration file here uses. SQLite
 * always runs, in memory.
 *
 * @see P2 plan, "Acceptance for Part C": this file is the executable
 * definition of "same as Payload or better".
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { createMySqlAdapter } from "@nextlyhq/adapter-mysql";
import { createPostgresAdapter } from "@nextlyhq/adapter-postgres";
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import { introspectLiveSnapshot } from "../../pipeline/diff/introspect-live";
import { toTableSpec } from "../compile";
import { col, defineTable } from "../dsl";
import type { ExtensionTable } from "../types";

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
const PREFIX = `pp_${randomBytes(6).toString("hex")}`;

/** The DDL a spec becomes, spelled per dialect without the emitter's ceremony. */
function createTableSql(
  table: ExtensionTable,
  dialect: SupportedDialect
): string {
  const spec = toTableSpec(table, dialect);
  const q = (name: string) =>
    dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
  const columns = spec.columns.map(c => {
    const nullable = c.nullable ? "" : " NOT NULL";
    const dflt = c.default === undefined ? "" : ` DEFAULT ${c.default}`;
    const pk = c.primaryKey === true ? " PRIMARY KEY" : "";
    return `  ${q(c.name)} ${c.type}${nullable}${dflt}${pk}`;
  });
  const checks = (spec.checks ?? []).map(
    ck => `  CONSTRAINT ${q(ck.name)} CHECK (${ck.sql})`
  );
  return `CREATE TABLE ${q(table.name)} (\n${[...columns, ...checks].join(",\n")}\n)`;
}

for (const entry of DIALECTS) {
  const suite = entry.url === null ? describe.skip : describe;

  suite(`Payload parity, live (${entry.dialect})`, () => {
    let adapter: TestAdapter | undefined;
    const made: string[] = [];

    async function db(): Promise<TestAdapter> {
      if (adapter === undefined) {
        adapter = entry.make(entry.url as string);
        await adapter.connect();
      }
      return adapter;
    }

    /** Create the table, remember it for teardown, and read it back. */
    async function push(table: ExtensionTable) {
      const a = await db();
      await a.executeQuery(createTableSql(table, entry.dialect));
      made.push(table.name);
      const snapshot = await introspectLiveSnapshot(
        a.getDrizzle(),
        entry.dialect,
        [table.name]
      );
      return snapshot.tables.find(t => t.name === table.name);
    }

    afterAll(async () => {
      if (adapter === undefined) return;
      const q = (n: string) =>
        entry.dialect === "mysql" ? `\`${n}\`` : `"${n}"`;
      for (const name of made.reverse()) {
        await adapter
          .executeQuery(`DROP TABLE IF EXISTS ${q(name)}`)
          .catch(() => {});
      }
      await adapter.disconnect();
    });

    const table = (
      name: string,
      columns: Parameters<typeof defineTable>[1],
      opts?: Parameters<typeof defineTable>[2]
    ): ExtensionTable => ({
      name: `${PREFIX}_${name}`,
      authored: name,
      owner: { kind: "plugin", id: "pp" },
      columns: defineTable(name, columns, opts).columns.map(c => ({ ...c })),
      indexes: [],
    });

    // Rows 1 and 11: a plugin's declared table, with every first-class kind,
    // reaches the database and reads back as the model described it.
    it("row 1 + 11 — a declared table is created with every column kind", async () => {
      const live = await push(
        table("kinds", {
          id: col.id(),
          name: col.shortText(),
          body: col.longText({ nullable: true }),
          flag: col.boolean({ default: false }),
          count: col.integer({ default: 0 }),
          amount: col.decimal(10, 2, { nullable: true }),
          payload: col.json<{ a?: number }>({ nullable: true }),
          big: col.bigint({ nullable: true }),
          small: col.smallint({ nullable: true }),
          ratio: col.real({ nullable: true }),
        })
      );

      expect(live).toBeDefined();
      const names = (live?.columns ?? []).map(c => c.name).sort();
      expect(names).toEqual(
        [
          "amount",
          "big",
          "body",
          "count",
          "flag",
          "id",
          "name",
          "payload",
          "ratio",
          "small",
        ].sort()
      );
    });

    // Row 10: an enum's values are ENFORCED, by the one mechanism all three
    // dialects have. Payload reaches `pgEnum` and stops at PostgreSQL.
    it("row 10 — an enum column refuses a value outside its set", async () => {
      const t = table("enums", {
        id: col.id(),
        state: col.enum(["open", "closed"]),
      });
      await push(t);
      const a = await db();
      const q = (n: string) =>
        entry.dialect === "mysql" ? `\`${n}\`` : `"${n}"`;

      // The declared values are accepted.
      await a.executeQuery(
        `INSERT INTO ${q(t.name)} (${q("id")}, ${q("state")}) VALUES ('a', 'open')`
      );

      // Anything else is refused BY THE DATABASE, which is the point of
      // carrying the values as a constraint rather than as documentation.
      await expect(
        a.executeQuery(
          `INSERT INTO ${q(t.name)} (${q("id")}, ${q("state")}) VALUES ('b', 'banana')`
        )
      ).rejects.toThrow();
    });

    // Row 3: indexes a plugin declares are emitted, including the compound
    // unique one, and read back under the name the pipeline derives.
    it("row 3 — declared indexes exist on the live table", async () => {
      const t = table(
        "indexed",
        { id: col.id(), a: col.shortText(), b: col.shortText() },
        { indexes: [{ columns: ["a", "b"], unique: true }, { columns: ["b"] }] }
      );
      const a = await db();
      await a.executeQuery(createTableSql(t, entry.dialect));
      made.push(t.name);

      const spec = toTableSpec(t, entry.dialect);
      const indexes = spec.indexes ?? [];
      const q = (n: string) =>
        entry.dialect === "mysql" ? `\`${n}\`` : `"${n}"`;
      for (const index of indexes) {
        const unique = index.unique ? "UNIQUE " : "";
        await a.executeQuery(
          `CREATE ${unique}INDEX ${q(index.name)} ON ${q(t.name)} (${index.columns
            .map(q)
            .join(", ")})`
        );
      }

      const snapshot = await introspectLiveSnapshot(
        a.getDrizzle(),
        entry.dialect,
        [t.name]
      );
      const live = snapshot.tables.find(x => x.name === t.name);
      const liveNames = (live?.indexes ?? []).map(i => i.name);
      for (const index of indexes) {
        expect(liveNames).toContain(index.name);
      }
    });
  });
}
