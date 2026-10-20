/**
 * `readTableIdentities` against each configured dialect's real catalog: the
 * token follows a table through a rename and through changes to its rows and
 * columns, and a table created under the name another was renamed away from
 * reads as a different table. That difference is what a plugin uninstall
 * refuses on when its `onUninstall` replaced a table its DOWNs drop.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import {
  readSqliteSchemaVersion,
  readTableIdentities,
} from "../table-identity";

/** Hand-made tables, prefixed so they meet nothing else in the database. */
const OWNED = "ti_owned";
const MOVED = "ti_owned_moved";

describe.each(getConfiguredTestDialects())(
  "readTableIdentities on %s",
  dialect => {
    let handle: TestNextly;

    const identities = (tables: readonly string[]) =>
      readTableIdentities(handle.adapter, dialect, tables);
    const run = (statement: string) => handle.adapter.executeQuery(statement);

    beforeEach(async () => {
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      await run(`CREATE TABLE ${OWNED} (id integer PRIMARY KEY, body text)`);
      await run(`INSERT INTO ${OWNED} (id, body) VALUES (1, 'kept')`);
    });

    afterEach(async () => {
      await run(`DROP TABLE IF EXISTS ${MOVED}`);
      await run(`DROP TABLE IF EXISTS ${OWNED}`);
      await handle?.destroy();
    });

    it("reports a table that exists, and nothing for one that does not", async () => {
      const read = await identities([OWNED, "ti_missing"]);
      expect([...read.keys()]).toEqual([OWNED]);
      expect(read.get(OWNED)).toEqual(expect.any(String));
    });

    it("keeps a table's token through deleted rows and an added column", async () => {
      const before = (await identities([OWNED])).get(OWNED);
      await run(
        dialect === "sqlite"
          ? `DELETE FROM ${OWNED}`
          : `TRUNCATE TABLE ${OWNED}`
      );
      await run(`ALTER TABLE ${OWNED} ADD COLUMN extra text`);
      expect((await identities([OWNED])).get(OWNED)).toBe(before);
    });

    it("reads a table created under a name another was renamed away from as another table", async () => {
      const before = (await identities([OWNED])).get(OWNED);
      // MySQL's token is the creation time, to the second: a replacement
      // made within the second its original was cannot be told apart, and
      // an original is created at install, long before an uninstall.
      if (dialect === "mysql") {
        await new Promise(resolve => setTimeout(resolve, 1100));
      }
      await run(`ALTER TABLE ${OWNED} RENAME TO ${MOVED}`);
      await run(`CREATE TABLE ${OWNED} (id integer PRIMARY KEY, body text)`);

      const after = await identities([OWNED, MOVED]);
      expect(after.get(OWNED)).toEqual(expect.any(String));
      expect(after.get(OWNED)).not.toBe(before);
      // The original went with its rows to the other name.
      expect(after.get(MOVED)).toBe(before);
    });
  }
);

describe("readSqliteSchemaVersion on SQLite", () => {
  let handle: TestNextly;
  const version = () => readSqliteSchemaVersion(handle.adapter);
  const run = (statement: string) => handle.adapter.executeQuery(statement);

  beforeEach(async () => {
    handle = await createTestNextly({});
    await run(`CREATE TABLE ${OWNED} (id integer PRIMARY KEY, body text)`);
  });

  afterEach(async () => {
    await run(`DROP TABLE IF EXISTS ${MOVED}`);
    await run(`DROP TABLE IF EXISTS ${OWNED}`);
    await handle?.destroy();
  });

  it("keeps its value through changes to rows", async () => {
    const before = await version();
    await run(`INSERT INTO ${OWNED} (id, body) VALUES (1, 'kept')`);
    await run(`DELETE FROM ${OWNED}`);
    expect(before).toEqual(expect.any(Number));
    expect(await version()).toBe(before);
  });

  it("moves on a rename and on VACUUM, which a replacement can hide behind", async () => {
    const before = await version();
    await run(`ALTER TABLE ${OWNED} RENAME TO ${MOVED}`);
    const renamed = await version();
    expect(renamed).not.toBe(before);
    await run("VACUUM");
    expect(await version()).not.toBe(renamed);
  });
});
