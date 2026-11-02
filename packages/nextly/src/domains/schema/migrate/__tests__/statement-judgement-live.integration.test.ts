/**
 * The live schema a judgement reads (`readLiveSchema`), on a real database of
 * each dialect: tables found whatever case a statement writes them in,
 * columns, indexes by name with and without their table, and named foreign
 * keys, checks and unique constraints by the names the catalog holds. Then
 * one judgement of a statement list against what the database really holds.
 *
 * A fake `LiveSchema` cannot show any of this: the unit matrix proves the
 * rules, and only the catalogs can prove the facts the rules are fed.
 */
import { randomBytes } from "node:crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  LOCK_DIALECTS,
  lockWorld,
  type LockWorld,
} from "../../pipeline/__tests__/helpers/schema-lock-world";
import { judgeStatements, readLiveSchema } from "../statement-judgement";

describe.each(LOCK_DIALECTS)(
  "the live schema a judgement reads on %s",
  dialect => {
    const P = `sjl_${randomBytes(3).toString("hex")}`;
    const owners = `${P}_owners`;
    const posts = `${P}_posts`;
    const gone = `${P}_gone`;
    let world: LockWorld;
    let adapter: DrizzleAdapter;

    // Every object the statements below name, so one read covers them all.
    const statements = [
      `CREATE TABLE ${owners} (id integer PRIMARY KEY)`,
      `CREATE TABLE ${posts} (id integer PRIMARY KEY, owner_id integer, score integer, slug varchar(64), CONSTRAINT ${P}_fk FOREIGN KEY (owner_id) REFERENCES ${owners} (id), CONSTRAINT ${P}_ck CHECK (score >= 0), CONSTRAINT ${P}_uq UNIQUE (slug))`,
      `CREATE INDEX ${P}_ix ON ${posts} (score)`,
      `ALTER TABLE ${posts} ADD COLUMN body varchar(32)`,
      `CREATE TABLE ${gone} (id integer)`,
      `DROP INDEX ${P}_never${dialect === "mysql" ? ` ON ${posts}` : ""}`,
      `INSERT INTO ${posts} (id, score) VALUES (1, 2)`,
    ];

    beforeAll(async () => {
      world = await lockWorld(dialect, { fresh: true });
      adapter = await world.connect();
      // The database the judgement meets: the first three statements ran, the
      // column was never added, and the third table was never created.
      for (const statement of statements.slice(0, 3)) {
        await adapter.executeQuery(statement);
      }
    }, 120_000);

    afterAll(async () => {
      await adapter.disconnect();
      await world.dispose();
    }, 60_000);

    it("answers each fact as the catalog holds it, whatever case the statement writes a name in", async () => {
      const live = await readLiveSchema(adapter.getDrizzle(), dialect, [
        ...statements,
        // The same tables written in another case: still found.
        `DROP TABLE ${owners.toUpperCase()}`,
      ]);
      expect(live.hasTable(owners)).toBe(true);
      expect(live.hasTable(owners.toUpperCase())).toBe(true);
      expect(live.hasTable(gone)).toBe(false);
      expect(live.hasColumn(posts, "score")).toBe(true);
      expect(live.hasColumn(posts, "body")).toBe(false);
      expect(live.hasIndex(`${P}_ix`, posts)).toBe(true);
      expect(live.hasIndex(`${P}_ix`, owners)).toBe(false);
      expect(live.hasIndex(`${P}_never`, posts)).toBe(false);
      if (dialect !== "sqlite") {
        // SQLite has no ALTER TABLE ADD or DROP CONSTRAINT, so no statement
        // there claims a constraint, and none is read.
        expect(live.hasConstraint(posts, `${P}_fk`)).toBe(true);
        expect(live.hasConstraint(posts, `${P}_uq`)).toBe(true);
      }
      expect(live.hasConstraint(posts, `${P}_absent`)).toBe(false);
      if (dialect !== "mysql") {
        // PostgreSQL and SQLite drop an index by its name alone.
        expect(live.hasIndex(`${P}_ix`)).toBe(true);
        expect(live.hasIndex(`${P}_never`)).toBe(false);
      }
    }, 120_000);

    it.runIf(dialect !== "sqlite")(
      "reads a named check by the name the catalog holds",
      async () => {
        // SQLite keeps a check's name only in the table's CREATE text, which
        // the snapshot reads too; asserted where the catalog names it.
        const live = await readLiveSchema(adapter.getDrizzle(), dialect, [
          statements[1] ?? "",
        ]);
        expect(live.hasConstraint(posts, `${P}_ck`)).toBe(true);
      },
      120_000
    );

    it.runIf(dialect === "mysql")(
      "reads a foreign key MySQL dropped as gone, though its backing index keeps the key's name",
      async () => {
        const child = `${P}_child`;
        const created = `ALTER TABLE ${child} ADD CONSTRAINT ${P}_cfk FOREIGN KEY (owner_id) REFERENCES ${owners} (id)`;
        const dropped = `ALTER TABLE ${child} DROP FOREIGN KEY ${P}_cfk`;
        await adapter.executeQuery(
          `CREATE TABLE ${child} (id integer PRIMARY KEY, owner_id integer)`
        );
        await adapter.executeQuery(created);
        await adapter.executeQuery(dropped);
        const live = await readLiveSchema(adapter.getDrizzle(), dialect, [
          dropped,
        ]);
        // The index MySQL made for the key is still there, under its name.
        expect(live.hasIndex(`${P}_cfk`, child)).toBe(true);
        expect(
          judgeStatements([dropped], dialect, live).map(s => s.verdict)
        ).toEqual(["done"]);
      },
      120_000
    );

    it.runIf(dialect === "postgresql")(
      "judges a primary key or an exclusion constraint dropped by name from the catalog, done only once it is gone",
      async () => {
        const keyed = `${P}_keyed`;
        const dropKey = `ALTER TABLE ${keyed} DROP CONSTRAINT ${keyed}_pkey`;
        const dropExclusion = `ALTER TABLE ${keyed} DROP CONSTRAINT ${P}_ex`;
        await adapter.executeQuery(
          `CREATE TABLE ${keyed} (id integer PRIMARY KEY, n integer, CONSTRAINT ${P}_ex EXCLUDE USING btree (n WITH =))`
        );
        const verdicts = async () =>
          judgeStatements(
            [dropKey, dropExclusion],
            dialect,
            await readLiveSchema(adapter.getDrizzle(), dialect, [
              dropKey,
              dropExclusion,
            ])
          ).map(s => s.verdict);
        // Neither ran: both constraints are in the catalog.
        expect(await verdicts()).toEqual(["not_done", "not_done"]);
        await adapter.executeQuery(dropKey);
        expect(await verdicts()).toEqual(["done", "not_done"]);
        await adapter.executeQuery(dropExclusion);
        expect(await verdicts()).toEqual(["done", "done"]);
      },
      120_000
    );

    it.runIf(dialect === "postgresql")(
      "judges an index a failed CREATE INDEX CONCURRENTLY left invalid as not done, to create or to drop",
      async () => {
        const dupes = `${P}_dupes`;
        const create = `CREATE UNIQUE INDEX CONCURRENTLY ${P}_dupes_uq ON ${dupes} (n)`;
        const drop = `DROP INDEX CONCURRENTLY ${P}_dupes_uq`;
        await adapter.executeQuery(`CREATE TABLE ${dupes} (n integer)`);
        await adapter.executeQuery(`INSERT INTO ${dupes} (n) VALUES (1), (1)`);
        // Fails on the duplicates, and leaves the index in the catalog, invalid.
        await expect(adapter.executeQuery(create)).rejects.toThrow();
        const verdicts = async (statements: string[]) =>
          judgeStatements(
            statements,
            dialect,
            await readLiveSchema(adapter.getDrizzle(), dialect, statements)
          ).map(s => s.verdict);
        // An invalid index is neither the created index nor gone.
        expect(await verdicts([create])).toEqual(["not_done"]);
        expect(await verdicts([drop])).toEqual(["not_done"]);
        await adapter.executeQuery(drop);
        expect(await verdicts([create])).toEqual(["not_done"]);
        expect(await verdicts([drop])).toEqual(["done"]);
      },
      120_000
    );

    it.runIf(dialect === "postgresql")(
      "judges a constraint added NOT VALID as not the validated constraint a plain ADD makes",
      async () => {
        const checked = `${P}_checked`;
        const validating = `ALTER TABLE ${checked} ADD CONSTRAINT ${P}_pos CHECK (n > 0)`;
        const notValid = `${validating} NOT VALID`;
        const validate = `ALTER TABLE ${checked} VALIDATE CONSTRAINT ${P}_pos`;
        await adapter.executeQuery(`CREATE TABLE ${checked} (n integer)`);
        await adapter.executeQuery(`INSERT INTO ${checked} (n) VALUES (-1)`);
        await adapter.executeQuery(notValid);
        const verdict = async (statement: string) =>
          judgeStatements(
            [statement],
            dialect,
            await readLiveSchema(adapter.getDrizzle(), dialect, [statement])
          ).map(s =>
            s.reason === undefined ? s.verdict : `${s.verdict}:${s.reason}`
          );
        // Present but not validated: a plain ADD did not run; NOT VALID did.
        expect(await verdict(validating)).toEqual(["not_done"]);
        expect(await verdict(notValid)).toEqual(["done"]);
        // A VALIDATE step is never read as done.
        expect(await verdict(validate)).toEqual(["unknown:unread"]);
        await adapter.executeQuery(`DELETE FROM ${checked}`);
        await adapter.executeQuery(validate);
        expect(await verdict(validating)).toEqual(["done"]);
      },
      120_000
    );

    it("judges a statement list against the database as it stands", async () => {
      const live = await readLiveSchema(
        adapter.getDrizzle(),
        dialect,
        statements
      );
      expect(
        judgeStatements(statements, dialect, live).map(({ verdict, reason }) =>
          reason === undefined ? verdict : `${verdict}:${reason}`
        )
      ).toEqual([
        "done",
        "done",
        "done",
        "not_done",
        "not_done",
        // Absent, as the DROP leaves it: the database shows its effect.
        "done",
        "unknown:rows",
      ]);
    }, 120_000);
  }
);
