/**
 * The rows a run removes through foreign keys it adds itself, on real servers: each statement list
 * is judged (`fileDeletions`), then run, and what it really removed is compared with what it named.
 * The keys reach into another schema (PostgreSQL) or another database (MySQL) and back, and, on
 * PostgreSQL, through `TRUNCATE ... CASCADE`, which empties a referencing table whatever its key's
 * ON DELETE action.
 *
 * Only a server can say which rows really go: the unit matrix proves the rules, not that the rules
 * match what the database does.
 */
import { randomBytes } from "node:crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  LOCK_DIALECTS,
  lockWorld,
  type LockWorld,
} from "../../pipeline/__tests__/helpers/schema-lock-world";
import {
  fileDeletions,
  readDeletionFacts,
  type DeletionFacts,
} from "../file-deletions";

/** What a list really did to the rows the fixture holds. */
interface Outcome {
  posts: "kept" | "lost" | "blanked";
  middle: "kept" | "lost";
  guest: "kept" | "lost";
}

const KEPT: Outcome = { posts: "kept", middle: "kept", guest: "kept" };

describe.each(LOCK_DIALECTS.filter(dialect => dialect !== "sqlite"))(
  "the rows a run removes through keys it adds, on %s",
  dialect => {
    const P = `fdk_${randomBytes(3).toString("hex")}`;
    /** Another schema (PostgreSQL) or another database (MySQL). */
    const other = `${P}_other`;
    const acct = `${P}_acct`;
    const users = `${P}_users`;
    const posts = `${P}_posts`;
    const middle = `${other}.middle`;
    const guest = `${other}.guest`;
    const postgres = dialect === "postgresql";
    let world: LockWorld;
    let adapter: DrizzleAdapter;
    /** The app's own schema or database, as a qualified name writes it. */
    let own: string;

    const run = (statement: string) => adapter.executeQuery(statement);
    const count = async (from: string) =>
      (await run(`SELECT 1 FROM ${from}`)).length;

    beforeAll(async () => {
      world = await lockWorld(dialect, { fresh: true });
      adapter = await world.connect();
      const [row] = (await run(
        postgres ? "SELECT current_schema() AS own" : "SELECT DATABASE() AS own"
      )) as { own: string }[];
      own = row.own;
      for (const statement of [
        postgres ? `CREATE SCHEMA ${other}` : `CREATE DATABASE ${other}`,
        `CREATE TABLE ${acct} (id integer PRIMARY KEY)`,
        `CREATE TABLE ${users} (id integer PRIMARY KEY)`,
        `CREATE TABLE ${other}.${users} (id integer PRIMARY KEY)`,
        `CREATE TABLE ${guest} (id integer PRIMARY KEY, ref integer)`,
        `CREATE TABLE ${middle} (id integer PRIMARY KEY, acct_id integer, CONSTRAINT ${P}_mid FOREIGN KEY (acct_id) REFERENCES ${own}.${acct} (id) ON DELETE CASCADE)`,
        `CREATE TABLE ${posts} (id integer PRIMARY KEY, ref integer)`,
      ]) {
        await run(statement);
      }
    }, 120_000);

    afterAll(async () => {
      // A key across the two would keep either from being dropped, so the app's side goes first.
      await run(`DROP TABLE IF EXISTS ${posts}`);
      await run(
        postgres ? `DROP SCHEMA ${other} CASCADE` : `DROP DATABASE ${other}`
      );
      await adapter.disconnect();
      await world.dispose();
    }, 60_000);

    /** One row in every table, each key column pointing at row 1. */
    async function fill(): Promise<void> {
      for (const table of [posts, guest, middle, acct, users]) {
        await run(`DELETE FROM ${table}`);
      }
      await run(`DELETE FROM ${other}.${users}`);
      for (const table of [acct, users, `${other}.${users}`]) {
        await run(`INSERT INTO ${table} (id) VALUES (1)`);
      }
      await run(`INSERT INTO ${middle} (id, acct_id) VALUES (1, 1)`);
      await run(`INSERT INTO ${guest} (id, ref) VALUES (1, 1)`);
      await run(`INSERT INTO ${posts} (id, ref) VALUES (1, 1)`);
    }

    /** Takes back the keys a list added and the name it gave `middle`. */
    async function restore(): Promise<void> {
      const drop = (table: string, key: string) =>
        postgres
          ? run(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${key}`)
          : run(`ALTER TABLE ${table} DROP FOREIGN KEY ${key}`).catch(
              () => undefined
            );
      await drop(posts, `${P}_k`);
      await drop(guest, `${P}_g`);
      await run(
        postgres
          ? `ALTER TABLE IF EXISTS ${other}.moved RENAME TO middle`
          : `RENAME TABLE ${other}.moved TO ${middle}`
      ).catch(() => undefined);
    }

    async function outcome(): Promise<Outcome> {
      const [post] = (await run(`SELECT ref FROM ${posts}`)) as {
        ref: number | null;
      }[];
      const kept = async (table: string) =>
        (await count(table)) > 0 ? ("kept" as const) : ("lost" as const);
      const at = await kept(middle).catch(() => kept(`${other}.moved`));
      return {
        posts:
          post === undefined ? "lost" : post.ref === null ? "blanked" : "kept",
        middle: at,
        guest: await kept(guest),
      };
    }

    /** What `list` is judged to delete, and what it really did when run. */
    async function judgeAndRun(list: string[]) {
      await fill();
      try {
        const facts: DeletionFacts = await readDeletionFacts(
          adapter.getDrizzle(),
          dialect,
          list
        );
        const named = fileDeletions(list, dialect, facts).map(deletion =>
          deletion.kind === "unnamed"
            ? "unnamed"
            : deletion.kind === "column"
              ? `column ${deletion.table}.${deletion.column}`
              : `${deletion.kind} ${deletion.table}`
        );
        for (const statement of list) await run(statement);
        return { named, really: await outcome() };
      } finally {
        await restore();
      }
    }

    const key = (references: string, action = "") =>
      `ALTER TABLE ${posts} ADD CONSTRAINT ${P}_k FOREIGN KEY (ref) REFERENCES ${references} (id)${action}`;

    it.runIf(postgres)(
      "names every table TRUNCATE CASCADE empties through a key the run added, whatever its action",
      async () => {
        const plain = await judgeAndRun([
          key(users),
          `TRUNCATE ${users} CASCADE`,
        ]);
        expect(plain.really).toEqual({ ...KEPT, posts: "lost" });
        expect(plain.named).toEqual([`rows ${users}`, `rows ${posts}`]);
        // A key added to a table written with its schema.
        const qualified = await judgeAndRun([
          `ALTER TABLE ${guest} ADD CONSTRAINT ${P}_g FOREIGN KEY (ref) REFERENCES ${users} (id)`,
          `TRUNCATE ${users} CASCADE`,
        ]);
        expect(qualified.really).toEqual({ ...KEPT, guest: "lost" });
        expect(qualified.named).toEqual([`rows ${users}`, `rows ${guest}`]);
        // Through a live key into the other schema, then back through the added one.
        const through = await judgeAndRun([
          key(middle),
          `TRUNCATE ${acct} CASCADE`,
        ]);
        expect(through.really).toEqual({
          ...KEPT,
          posts: "lost",
          middle: "lost",
        });
        expect([...through.named].sort()).toEqual(
          [`rows ${acct}`, `rows ${middle}`, `rows ${posts}`].sort()
        );
      },
      120_000
    );

    it("names the app's rows a removal reaches through the other schema or database and a key the run added", async () => {
      const cascade = await judgeAndRun([
        key(middle, " ON DELETE CASCADE"),
        `DELETE FROM ${acct}`,
      ]);
      expect(cascade.really).toEqual({
        ...KEPT,
        posts: "lost",
        middle: "lost",
      });
      expect(cascade.named).toContain(`rows ${posts}`);
      expect(cascade.named).toContain(`rows ${middle}`);
      const blanked = await judgeAndRun([
        key(middle, " ON DELETE SET NULL"),
        `DELETE FROM ${acct}`,
      ]);
      expect(blanked.really).toEqual({
        ...KEPT,
        posts: "blanked",
        middle: "lost",
      });
      expect(blanked.named).toContain(`column ${posts}.ref`);
      // Under a name the same run gave the other table.
      const moved = await judgeAndRun([
        postgres
          ? `ALTER TABLE ${middle} RENAME TO moved`
          : `RENAME TABLE ${middle} TO ${other}.moved`,
        key(`${other}.moved`, " ON DELETE CASCADE"),
        `DELETE FROM ${acct}`,
      ]);
      expect(moved.really).toEqual({ ...KEPT, posts: "lost", middle: "lost" });
      expect(moved.named).toContain(`rows ${posts}`);
    }, 120_000);

    it("names the rows a key to the app's own table, written with its schema or database, loses", async () => {
      const { really, named } = await judgeAndRun([
        key(`${own}.${users}`, " ON DELETE CASCADE"),
        `DELETE FROM ${users}`,
      ]);
      expect(really).toEqual({ ...KEPT, posts: "lost" });
      expect(named).toEqual([`rows ${users}`, `rows ${posts}`]);
    }, 120_000);

    it("stands for a removal written with a schema or database by consent without targets", async () => {
      const { really, named } = await judgeAndRun([
        key(`${other}.${users}`, " ON DELETE CASCADE"),
        `DELETE FROM ${other}.${users}`,
      ]);
      expect(really).toEqual({ ...KEPT, posts: "lost" });
      expect(named).toContain("unnamed");
    }, 120_000);

    it("asks nothing for a key into another schema or database when the run removes nothing", async () => {
      const target = `${other}.${users}`;
      const asked: string[] = [];
      for (const action of ["", " ON DELETE RESTRICT", " ON DELETE CASCADE"]) {
        const { really, named } = await judgeAndRun([key(target, action)]);
        expect(really, action).toEqual(KEPT);
        asked.push(...named.map(name => `${action}: ${name}`));
      }
      expect(asked).toEqual([]);
    }, 120_000);
  }
);
