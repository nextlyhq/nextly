/**
 * A code-first apply's field type change that keeps its column is judged over the values the
 * column holds before anything runs (`refuseConfiguredTypeChanges`): no statement, and so no other
 * rule, sees it. A change that alters the column's type is the conversion rule's, and is left to
 * it; a Schema Builder entity is the Builder save's, and is left to that.
 *
 * Against real databases: SQLite in memory, and PostgreSQL and MySQL where their URLs are set,
 * each in a table of this file's own prefix.
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import Database from "better-sqlite3";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzleMysql } from "drizzle-orm/mysql2";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { createPool, type Pool as MysqlPool } from "mysql2";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { makeTestContext } from "../../../../database/__tests__/integration/helpers/test-db";
import { getColumnDescriptor } from "../../services/field-column-descriptor";
import type { DesiredSchema } from "../types";
import { refuseConfiguredTypeChanges } from "../ui-type-changes";

const TEXT = { name: "heading", type: "text" };
const SELECT = {
  name: "heading",
  type: "select",
  options: [{ label: "A", value: "a" }],
};
const NUMBER = { name: "heading", type: "number" };

/** A code-first apply of `table` from `before` to `after`, stating the fields it changes from. */
function applying(
  table: string,
  before: object,
  after: object,
  builderOwned = false
): DesiredSchema {
  return {
    collections: {
      [table]: {
        slug: table,
        tableName: table,
        fields: [after] as never,
        recordedFields: [before] as never,
        ...(builderOwned ? { builderOwned: true } : {}),
      },
    },
    singles: {},
    components: {},
  };
}

interface Connection {
  db: unknown;
  dialect: SupportedDialect;
  run: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
}

/** The cases, given a table holding `heading` values by row id, created as code-first creates it. */
function cases(open: () => { connection: Connection; table: string }) {
  async function holding(values: Record<string, string>) {
    const { connection, table } = open();
    const q = (n: string) =>
      connection.dialect === "mysql" ? `\`${n}\`` : `"${n}"`;
    const column = getColumnDescriptor(
      TEXT as never,
      connection.dialect,
      "codeFirst"
    );
    await connection.run(`DROP TABLE IF EXISTS ${q(table)}`);
    await connection.run(
      `CREATE TABLE ${q(table)} (${q("id")} varchar(36) PRIMARY KEY, ${q("heading")} ${column?.dialectType ?? "text"})`
    );
    for (const [id, value] of Object.entries(values)) {
      await connection.run(
        `INSERT INTO ${q(table)} (${q("id")}, ${q("heading")}) VALUES ('${id}', '${value}')`
      );
    }
    return { connection, table };
  }

  it("refuses a change that keeps its column over a value the new type cannot read", async () => {
    const { connection, table } = await holding({ r1: "a", r2: "Hello" });

    await expect(
      refuseConfiguredTypeChanges(
        applying(table, TEXT, SELECT),
        connection.db,
        connection.dialect
      )
    ).rejects.toMatchObject({
      publicData: {
        errors: [{ path: "fields.heading", code: "TYPE_CHANGE_LOSES_VALUES" }],
      },
    });
  });

  it("lets the same change go ahead where every value is one the new type reads", async () => {
    const { connection, table } = await holding({ r1: "a", r2: "a" });

    await expect(
      refuseConfiguredTypeChanges(
        applying(table, TEXT, SELECT),
        connection.db,
        connection.dialect
      )
    ).resolves.toBeUndefined();
  });

  it("leaves a change of the column's type to the conversion rule", async () => {
    // A text becoming a number changes the column's type: the classifier's conversion rule judges
    // it, so this precondition does not, whatever the values hold.
    const { connection, table } = await holding({ r1: "abc" });

    await expect(
      refuseConfiguredTypeChanges(
        applying(table, TEXT, NUMBER),
        connection.db,
        connection.dialect
      )
    ).resolves.toBeUndefined();
  });

  it("leaves a Schema Builder entity to the Builder save", async () => {
    const { connection, table } = await holding({ r1: "Hello" });

    await expect(
      refuseConfiguredTypeChanges(
        applying(table, TEXT, SELECT, true),
        connection.db,
        connection.dialect
      )
    ).resolves.toBeUndefined();
  });
}

describe("a code-first type change that keeps its column (sqlite)", () => {
  let sqlite: Database.Database;
  let connection: Connection;
  beforeEach(() => {
    sqlite?.close();
    sqlite = new Database(":memory:");
    connection = {
      db: drizzleSqlite({ client: sqlite }),
      dialect: "sqlite",
      run: sql => Promise.resolve(sqlite.exec(sql)),
      close: () => Promise.resolve(),
    };
  });
  afterAll(() => sqlite?.close());

  cases(() => ({ connection, table: "dc_cfg_items" }));
});

const SERVERS: Array<{
  dialect: "postgresql" | "mysql";
  open: (url: string) => Connection;
}> = [
  {
    dialect: "postgresql",
    open: url => {
      const pool = new Pool({ connectionString: url });
      return {
        db: drizzlePg({ client: pool }),
        dialect: "postgresql",
        run: sql => pool.query(sql),
        close: () => pool.end(),
      };
    },
  },
  {
    dialect: "mysql",
    open: url => {
      const pool: MysqlPool = createPool({ uri: url });
      return {
        db: drizzleMysql({ client: pool }),
        dialect: "mysql",
        run: sql => pool.promise().query(sql),
        close: () => new Promise<void>(done => pool.end(() => done())),
      };
    },
  },
];

for (const server of SERVERS) {
  const context = makeTestContext(server.dialect);
  describe.skipIf(!context.url)(
    `a code-first type change that keeps its column (${server.dialect})`,
    () => {
      const table = `dc_${context.prefix}_cfg_items`;
      let connection: Connection;
      beforeAll(() => {
        connection = server.open(context.url ?? "");
      });
      afterAll(async () => {
        await connection.run(
          `DROP TABLE IF EXISTS ${server.dialect === "mysql" ? `\`${table}\`` : `"${table}"`}`
        );
        await connection.close();
      });

      cases(() => ({ connection, table }));
    }
  );
}
