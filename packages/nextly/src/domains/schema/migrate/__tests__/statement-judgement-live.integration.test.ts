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

describe.each(LOCK_DIALECTS.filter(dialect => dialect !== "sqlite"))(
  "what a snapshot does not record of a column, read on %s",
  dialect => {
    const P = `lcf_${randomBytes(3).toString("hex")}`;
    const assigned = `${P}_assigned`;
    const plain = `${P}_plain`;
    let world: LockWorld;
    let adapter: DrizzleAdapter;

    const creates =
      dialect === "postgresql"
        ? [
            `CREATE TABLE ${assigned} (id serial PRIMARY KEY, seat integer GENERATED ALWAYS AS IDENTITY, turn integer GENERATED BY DEFAULT AS IDENTITY, label text)`,
            `CREATE TABLE ${plain} (id integer PRIMARY KEY, label text)`,
          ]
        : [
            `CREATE TABLE ${assigned} (id int NOT NULL AUTO_INCREMENT PRIMARY KEY, label varchar(20), bin varchar(20) COLLATE utf8mb4_bin, noted varchar(20) COMMENT 'by hand', hidden int INVISIBLE, touched timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, doubled int GENERATED ALWAYS AS (hidden * 2) VIRTUAL, spot point SRID 4326)`,
            `CREATE TABLE ${plain} (id int NOT NULL PRIMARY KEY, label varchar(20))`,
          ];

    beforeAll(async () => {
      world = await lockWorld(dialect, { fresh: true });
      adapter = await world.connect();
      for (const statement of creates) await adapter.executeQuery(statement);
    }, 120_000);

    afterAll(async () => {
      await adapter.disconnect();
      await world.dispose();
    }, 60_000);

    it("tells a key the database assigns from a plain one", async () => {
      const live = await readLiveSchema(adapter.getDrizzle(), dialect, creates);
      expect(live.generatesKey(assigned, "id")).toBe(true);
      expect(live.generatesKey(assigned.toUpperCase(), "ID")).toBe(true);
      expect(live.generatesKey(assigned, "label")).toBe(false);
      expect(live.generatesKey(plain, "id")).toBe(false);
      if (dialect === "postgresql") {
        expect(live.generatesKey(assigned, "seat")).toBe(true);
        // An identity column by its mode; a serial column is not one.
        expect(live.identityMode(assigned, "seat")).toBe("always");
        expect(live.identityMode(assigned, "turn")).toBe("by-default");
        expect(live.identityMode(assigned, "id")).toBeUndefined();
      } else {
        expect(live.settingsReadable(assigned)).toBe(true);
      }
    });

    it.runIf(dialect === "mysql")(
      "names each setting a plain restatement of a column would put back",
      async () => {
        const live = await readLiveSchema(
          adapter.getDrizzle(),
          dialect,
          creates
        );
        const settings = (column: string) =>
          live.untrackedSettings(assigned, column);
        expect(settings("label")).toEqual([]);
        expect(settings("id")).toEqual(["AUTO_INCREMENT"]);
        expect(settings("bin")).toEqual(["COLLATE utf8mb4_bin"]);
        expect(settings("noted")).toEqual(["COMMENT"]);
        expect(settings("hidden")).toEqual(["INVISIBLE"]);
        expect(settings("touched")).toEqual(["ON UPDATE"]);
        expect(settings("doubled")).toEqual(["GENERATED"]);
        expect(settings("spot")).toEqual(["SRID"]);
        expect(live.untrackedSettings(plain, "label")).toEqual([]);
      }
    );

    it.runIf(dialect === "mysql")(
      "reads the table of a statement that only restates a column, which claims no object",
      async () => {
        // A `MODIFY` alone, as a type change is written: no table, column or index is made or
        // removed, and the column's settings must still be read.
        const live = await readLiveSchema(adapter.getDrizzle(), dialect, [
          `ALTER TABLE ${assigned} MODIFY COLUMN noted varchar(40)`,
        ]);
        expect(live.settingsReadable(assigned)).toBe(true);
        expect(live.untrackedSettings(assigned, "noted")).toEqual(["COMMENT"]);
      }
    );
  }
);

describe.each(LOCK_DIALECTS)(
  "what a snapshot does not record of a constraint or an index, read on %s",
  dialect => {
    const P = `lnf_${randomBytes(3).toString("hex")}`;
    const owners = `${P}_owners`;
    const posts = `${P}_posts`;
    const counted = `${P}_counted`;
    let world: LockWorld;
    let adapter: DrizzleAdapter;

    const deferred =
      dialect === "postgresql" ? " DEFERRABLE INITIALLY DEFERRED" : "";
    const unenforced = dialect === "mysql" ? " NOT ENFORCED" : "";
    const creates = [
      `CREATE TABLE ${owners} (id integer PRIMARY KEY)`,
      `CREATE TABLE ${posts} (id integer PRIMARY KEY, owner_id integer, other_id integer, score integer, slug varchar(64), CONSTRAINT ${P}_fk FOREIGN KEY (owner_id) REFERENCES ${owners} (id), CONSTRAINT ${P}_fkd FOREIGN KEY (other_id) REFERENCES ${owners} (id)${deferred}, CONSTRAINT ${P}_ck CHECK (score >= 0), CONSTRAINT ${P}_cku CHECK (score < 100)${unenforced})`,
      `CREATE INDEX ${P}_plain ON ${posts} (score, slug)`,
      `CREATE INDEX ${P}_desc ON ${posts} (score DESC)`,
      ...(dialect === "postgresql"
        ? [`CREATE INDEX ${P}_hash ON ${posts} USING hash (slug)`]
        : []),
      ...(dialect === "mysql"
        ? [`CREATE FULLTEXT INDEX ${P}_text ON ${posts} (slug)`]
        : []),
    ];

    beforeAll(async () => {
      world = await lockWorld(dialect, { fresh: true });
      adapter = await world.connect();
      for (const statement of creates) await adapter.executeQuery(statement);
    }, 120_000);

    afterAll(async () => {
      await adapter.disconnect();
      await world.dispose();
    }, 60_000);

    it("tells a plain index from one built by another method", async () => {
      const live = await readLiveSchema(adapter.getDrizzle(), dialect, creates);
      expect(live.indexShape(posts, `${P}_plain`)).toBe("plain");
      // A descending key is the same method: Nextly's own tables carry one.
      expect(live.indexShape(posts, `${P}_desc`)).toBe("plain");
      expect(live.indexShape(posts, `${P}_never`)).toBeUndefined();
      if (dialect === "postgresql") {
        expect(live.indexShape(posts, `${P}_hash`)).toBe("other");
      }
      if (dialect === "mysql") {
        expect(live.indexShape(posts, `${P}_text`)).toBe("other");
      }
    });

    it.runIf(dialect === "postgresql")(
      "tells how each foreign key defers its check",
      async () => {
        const live = await readLiveSchema(
          adapter.getDrizzle(),
          dialect,
          creates
        );
        expect(live.keyDeferrability(posts, `${P}_fk`)).toBe("not");
        expect(live.keyDeferrability(posts, `${P}_fkd`)).toBe("deferred");
      }
    );

    it.runIf(dialect === "mysql")(
      "tells an enforced check from one that is not",
      async () => {
        const live = await readLiveSchema(
          adapter.getDrizzle(),
          dialect,
          creates
        );
        expect(live.checkEnforced(posts, `${P}_ck`)).toBe(true);
        expect(live.checkEnforced(posts, `${P}_cku`)).toBe(false);
        expect(live.checkEnforced(posts, `${P}_never`)).toBeUndefined();
      }
    );

    it.runIf(dialect === "sqlite")(
      "tells whether a table's AUTOINCREMENT counter covers its rows",
      async () => {
        const covers = async () =>
          (
            await readLiveSchema(adapter.getDrizzle(), dialect, [
              `CREATE TABLE ${counted} (id integer)`,
              `CREATE TABLE ${posts} (id integer)`,
            ])
          ).counterCovers(counted);
        await adapter.executeQuery(
          `CREATE TABLE ${counted} (id INTEGER PRIMARY KEY AUTOINCREMENT, label text)`
        );
        // No row and no counter yet: nothing a key could be given out again from.
        expect(await covers()).toBe(true);
        await adapter.executeQuery(
          `INSERT INTO ${counted} (label) VALUES ('a'), ('b'), ('c')`
        );
        expect(await covers()).toBe(true);
        // The counter set back below the highest key, as a table copied by hand leaves it.
        await adapter.executeQuery(
          `UPDATE sqlite_sequence SET seq = 1 WHERE name = '${counted}'`
        );
        expect(await covers()).toBe(false);
        await adapter.executeQuery(
          `DELETE FROM sqlite_sequence WHERE name = '${counted}'`
        );
        expect(await covers()).toBe(false);
        // The word in a default's text declares nothing: an empty table with no counter is not
        // taken for an AUTOINCREMENT one that has yet to be written.
        const worded = `${P}_worded`;
        await adapter.executeQuery(
          `CREATE TABLE ${worded} (id INTEGER PRIMARY KEY, note text DEFAULT 'no AUTOINCREMENT here')`
        );
        expect(
          (
            await readLiveSchema(adapter.getDrizzle(), dialect, [
              `CREATE TABLE ${worded} (id integer)`,
            ])
          ).counterCovers(worded)
        ).toBe(false);
        // A column named rowid hides the table's own: the highest key is read from the key column.
        const shadowed = `${P}_shadowed`;
        await adapter.executeQuery(
          `CREATE TABLE ${shadowed} (id INTEGER PRIMARY KEY AUTOINCREMENT, rowid text)`
        );
        await adapter.executeQuery(
          `INSERT INTO ${shadowed} (rowid) VALUES ('100'), ('200')`
        );
        expect(
          (
            await readLiveSchema(adapter.getDrizzle(), dialect, [
              `CREATE TABLE ${shadowed} (id integer)`,
            ])
          ).counterCovers(shadowed)
        ).toBe(true);
        // A table not declared AUTOINCREMENT has no counter to cover it.
        expect(
          (
            await readLiveSchema(adapter.getDrizzle(), dialect, creates)
          ).counterCovers(posts)
        ).toBe(false);
      }
    );
  }
);
