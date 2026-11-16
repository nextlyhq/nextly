/**
 * The live facts a file's deletions are judged against (`readDeletionFacts`),
 * on a real database of each dialect: the tables a removal of rows cascades
 * to through ON DELETE CASCADE keys, followed to a grandchild and never
 * through a key without the action; on PostgreSQL every table TRUNCATE ...
 * CASCADE empties; nothing on SQLite while foreign keys are not enforced; no
 * answer for a table the database does not have yet; and a rebuilt table's
 * live columns and types. Then one `fileDeletions` call on those facts.
 *
 * A fake cannot show any of this: the unit matrix proves the rules, and only
 * the catalogs can prove the facts the rules are fed.
 */
import { randomBytes } from "node:crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  LOCK_DIALECTS,
  lockWorld,
  type LockWorld,
} from "../../pipeline/__tests__/helpers/schema-lock-world";
import { readDdlEventTriggers } from "../../pipeline/live-table-facts";
import { fileDeletions, readDeletionFacts } from "../file-deletions";

describe.each(LOCK_DIALECTS)("the deletion facts read on %s", dialect => {
  const P = `fdl_${randomBytes(3).toString("hex")}`;
  const parent = `${P}_parent`;
  const child = `${P}_child`;
  const grand = `${P}_grand`;
  const keeper = `${P}_keeper`;
  const posts = `${P}_posts`;
  const missing = `${P}_missing`;
  let world: LockWorld;
  let adapter: DrizzleAdapter;

  /** A SQLite rebuild of posts that leaves `body` out. */
  const rebuild = [
    `CREATE TABLE __new_${posts} (id integer PRIMARY KEY, title text)`,
    `INSERT INTO __new_${posts} (id, title) SELECT id, title FROM ${posts}`,
    `DROP TABLE ${posts}`,
    `ALTER TABLE __new_${posts} RENAME TO ${posts}`,
  ];
  const statements = [
    `DELETE FROM ${parent} WHERE id = 1`,
    `DELETE FROM ${missing}`,
    ...(dialect === "postgresql" ? [`TRUNCATE ${parent} CASCADE`] : []),
    ...(dialect === "sqlite" ? rebuild : []),
  ];

  beforeAll(async () => {
    world = await lockWorld(dialect, { fresh: true });
    adapter = await world.connect();
    // parent <- child (cascade) <- grand (cascade), and parent <- keeper
    // through a key with no ON DELETE action.
    for (const statement of [
      `CREATE TABLE ${parent} (id integer PRIMARY KEY)`,
      `CREATE TABLE ${child} (id integer PRIMARY KEY, parent_id integer, FOREIGN KEY (parent_id) REFERENCES ${parent} (id) ON DELETE CASCADE)`,
      `CREATE TABLE ${grand} (id integer PRIMARY KEY, child_id integer, FOREIGN KEY (child_id) REFERENCES ${child} (id) ON DELETE CASCADE)`,
      `CREATE TABLE ${keeper} (id integer PRIMARY KEY, parent_id integer, FOREIGN KEY (parent_id) REFERENCES ${parent} (id))`,
      `CREATE TABLE ${posts} (id integer PRIMARY KEY, title text, body varchar(64))`,
    ]) {
      await adapter.executeQuery(statement);
    }
    // Enforcement on, so the SQLite case shows the connection setting is not
    // what the reader goes by.
    if (dialect === "sqlite") {
      await adapter.executeQuery("PRAGMA foreign_keys = ON");
    }
  }, 120_000);

  afterAll(async () => {
    await adapter.disconnect();
    await world.dispose();
  }, 60_000);

  /** Whether PostgreSQL has `name` installed already, so a test that needs it leaves it as it found it. */
  async function extensionInstalled(name: string): Promise<boolean> {
    const rows = await adapter.executeQuery(
      "SELECT 1 FROM pg_extension WHERE extname = $1",
      [name]
    );
    return rows.length > 0;
  }

  it.runIf(dialect !== "sqlite")(
    "follows ON DELETE CASCADE keys to a grandchild, never through a key without it, and answers nothing for a table not there yet",
    async () => {
      const facts = await readDeletionFacts(
        adapter.getDrizzle(),
        dialect,
        statements
      );
      expect(facts.cascadeFrom(parent)).toEqual([child, grand]);
      // A table an earlier pending file creates has keys nobody can read yet.
      expect(facts.cascadeFrom(missing)).toBeUndefined();
      // A question the statements never ask has no answer either.
      expect(facts.cascadeFrom(keeper)).toBeUndefined();
    },
    120_000
  );

  it.runIf(dialect !== "sqlite")(
    "reads the columns a SET NULL key blanks, and the user-defined functions a SELECT may call",
    async () => {
      const author = `${P}_author`;
      const byline = `${P}_byline`;
      const purge = `${P}_purge`;
      await adapter.executeQuery(
        `CREATE TABLE ${author} (id integer PRIMARY KEY)`
      );
      await adapter.executeQuery(
        `CREATE TABLE ${byline} (id integer PRIMARY KEY, author_id integer, FOREIGN KEY (author_id) REFERENCES ${author} (id) ON DELETE SET NULL)`
      );
      await adapter.executeQuery(
        dialect === "postgresql"
          ? `CREATE FUNCTION ${purge}() RETURNS integer AS 'SELECT 1' LANGUAGE sql`
          : `CREATE FUNCTION ${purge}() RETURNS integer DETERMINISTIC NO SQL RETURN 1`
      );
      const facts = await readDeletionFacts(adapter.getDrizzle(), dialect, [
        `DELETE FROM ${author}`,
        `SELECT ${purge}()`,
      ]);
      expect(facts.nulledBy(author)).toEqual([
        { table: byline, column: "author_id" },
      ]);
      // Rows of the referencing table stay: SET NULL is not a cascade.
      expect(facts.cascadeFrom(author)).toEqual([]);
      expect(facts.userFunctions?.has(purge)).toBe(true);
      expect(facts.userFunctions?.has("count")).toBe(false);
    },
    120_000
  );

  it.runIf(dialect === "postgresql")(
    "reads what TRUNCATE ... CASCADE empties: every referencing table, the key's action aside",
    async () => {
      const facts = await readDeletionFacts(
        adapter.getDrizzle(),
        dialect,
        statements
      );
      expect(facts.truncateCascadeFrom(parent)).toEqual([child, grand, keeper]);
    },
    120_000
  );

  it.runIf(dialect === "sqlite")(
    "reads no cascade for any table, even while the connection enforces foreign keys, since the runner applies a file with them off",
    async () => {
      const facts = await readDeletionFacts(
        adapter.getDrizzle(),
        dialect,
        statements
      );
      expect(facts.cascadeFrom(parent)).toEqual([]);
      expect(facts.cascadeFrom(missing)).toEqual([]);
    },
    120_000
  );

  it.runIf(dialect === "sqlite")(
    "reads the live columns and declared types of a table a rebuild rebuilds",
    async () => {
      const facts = await readDeletionFacts(
        adapter.getDrizzle(),
        dialect,
        statements
      );
      expect([...(facts.liveColumns.get(posts) ?? [])].sort()).toEqual([
        "body",
        "id",
        "title",
      ]);
      expect(
        Object.fromEntries(facts.liveColumnTypes?.get(posts) ?? new Map())
      ).toEqual({ id: "integer", title: "text", body: "varchar(64)" });
    },
    120_000
  );

  it.runIf(dialect === "postgresql")(
    "follows a cascade to a child in another schema by its identity, never to a same-named table the search path shows",
    async () => {
      const parentOf = `${P}_sp`;
      const schema = `${P}_s`;
      const dup = `${P}_dup`;
      for (const statement of [
        `CREATE TABLE ${parentOf} (id integer PRIMARY KEY)`,
        `CREATE SCHEMA ${schema}`,
        // The real child, in a schema the search path does not show.
        `CREATE TABLE ${schema}.${dup} (id integer PRIMARY KEY, sp_id integer REFERENCES ${parentOf} (id) ON DELETE CASCADE)`,
        // A same-named table the search path shows, which references nothing.
        `CREATE TABLE ${dup} (id integer PRIMARY KEY)`,
      ]) {
        await adapter.executeQuery(statement);
      }
      const facts = await readDeletionFacts(adapter.getDrizzle(), dialect, [
        `DELETE FROM ${parentOf}`,
      ]);
      expect(facts.cascadeFrom(parentOf)).toEqual([`${schema}.${dup}`]);
    },
    120_000
  );

  it("reads a trigger on a table as code a row change runs, never one a DDL deletion runs", async () => {
    const triggered = `${P}_tr`;
    const plain = `${P}_plain`;
    await adapter.executeQuery(
      `CREATE TABLE ${triggered} (id integer PRIMARY KEY)`
    );
    await adapter.executeQuery(
      `CREATE TABLE ${plain} (id integer PRIMARY KEY)`
    );
    const trigger = {
      postgresql: [
        `CREATE FUNCTION ${P}_keep() RETURNS trigger AS 'BEGIN RETURN OLD; END' LANGUAGE plpgsql`,
        `CREATE TRIGGER ${P}_trg BEFORE DELETE ON ${triggered} FOR EACH ROW EXECUTE FUNCTION ${P}_keep()`,
      ],
      mysql: [
        `CREATE TRIGGER ${P}_trg BEFORE DELETE ON ${triggered} FOR EACH ROW SET @${P}_seen = 1`,
      ],
      sqlite: [
        `CREATE TRIGGER ${P}_trg AFTER DELETE ON ${triggered} BEGIN SELECT 1; END`,
      ],
    }[dialect];
    for (const statement of trigger) await adapter.executeQuery(statement);
    const facts = await readDeletionFacts(adapter.getDrizzle(), dialect, [
      `DELETE FROM ${triggered}`,
      `DELETE FROM ${plain}`,
    ]);
    expect(facts.hiddenCode(triggered, "rows")).toBe(true);
    expect(facts.hiddenCode(plain, "rows")).toBe(false);
    // An updated_at-style trigger asks blanket consent for a removal of the
    // table's rows, and none for dropping one of its columns.
    const dropColumn = [`ALTER TABLE ${triggered} DROP COLUMN ${P}_gone`];
    const remove = [`DELETE FROM ${triggered}`];
    if (dialect !== "sqlite") {
      await adapter.executeQuery(
        `ALTER TABLE ${triggered} ADD COLUMN ${P}_gone integer`
      );
      const ddlFacts = await readDeletionFacts(
        adapter.getDrizzle(),
        dialect,
        dropColumn
      );
      expect(fileDeletions(dropColumn, dialect, ddlFacts)).toEqual([
        { kind: "column", table: triggered, column: `${P}_gone` },
      ]);
    }
    const rowFacts = await readDeletionFacts(
      adapter.getDrizzle(),
      dialect,
      remove
    );
    expect(fileDeletions(remove, dialect, rowFacts)).toContainEqual({
      kind: "unnamed",
      description: `rows removed from ${triggered} run code the table carries (a trigger, a rule, or a default or check calling a function), which may delete other data`,
    });
  }, 120_000);

  it.runIf(dialect === "postgresql")(
    "reads a default or CHECK calling a user function as hidden code, and an extension's function as none",
    async () => {
      const stamped = `${P}_stamped`;
      const keyed = `${P}_keyed`;
      const checked = `${P}_checked`;
      const fn = `${P}_next`;
      await adapter.executeQuery(
        `CREATE FUNCTION ${fn}() RETURNS integer AS 'SELECT 1' LANGUAGE sql`
      );
      const hadExtension = await extensionInstalled("uuid-ossp");
      if (!hadExtension) {
        await adapter.executeQuery('CREATE EXTENSION "uuid-ossp"');
      }
      try {
        for (const statement of [
          `CREATE TABLE ${stamped} (id integer DEFAULT ${fn}())`,
          `CREATE TABLE ${keyed} (id uuid DEFAULT uuid_generate_v4())`,
          `CREATE TABLE ${checked} (id integer, body text CHECK (${fn}() > 0))`,
        ]) {
          await adapter.executeQuery(statement);
        }
        const facts = await readDeletionFacts(adapter.getDrizzle(), dialect, [
          `INSERT INTO ${stamped} DEFAULT VALUES`,
          `INSERT INTO ${keyed} DEFAULT VALUES`,
          `ALTER TABLE ${checked} ALTER COLUMN body TYPE varchar(20)`,
        ]);
        expect(facts.hiddenCode(stamped, "rows")).toBe(true);
        expect(facts.hiddenCode(stamped, "rewrite")).toBe(false);
        expect(facts.hiddenCode(keyed, "rows")).toBe(false);
        expect(facts.hiddenCode(checked, "rewrite")).toBe(true);
        // A CHECK calling a function asks blanket consent for a conversion,
        // and names a dropped column.
        const convert = [
          `ALTER TABLE ${checked} ALTER COLUMN body TYPE varchar(20)`,
        ];
        expect(fileDeletions(convert, dialect, facts)).toContainEqual({
          kind: "unnamed",
          description: `converting a column of ${checked} re-checks its CHECK constraints, which call a function and may delete other data`,
        });
        const drop = [`ALTER TABLE ${checked} DROP COLUMN id`];
        expect(
          fileDeletions(
            drop,
            dialect,
            await readDeletionFacts(adapter.getDrizzle(), dialect, drop)
          )
        ).toEqual([{ kind: "column", table: checked, column: "id" }]);
        // An extension's function is the database's own, never a user's.
        const calls = await readDeletionFacts(adapter.getDrizzle(), dialect, [
          "SELECT uuid_generate_v4()",
        ]);
        expect(calls.userFunctions?.has("uuid_generate_v4")).toBe(false);
      } finally {
        if (!hadExtension) {
          await adapter.executeQuery(`DROP TABLE IF EXISTS ${keyed}`);
          await adapter.executeQuery('DROP EXTENSION IF EXISTS "uuid-ossp"');
        }
      }
    },
    120_000
  );

  it.runIf(dialect === "postgresql")(
    "reads the inheritance children and partitions a DELETE without ONLY also empties",
    async () => {
      const events = `${P}_ev`;
      const child = `${P}_ev_child`;
      const parted = `${P}_pt`;
      const part = `${P}_pt_1`;
      for (const statement of [
        `CREATE TABLE ${events} (id integer)`,
        `CREATE TABLE ${child} () INHERITS (${events})`,
        `CREATE TABLE ${parted} (id integer) PARTITION BY RANGE (id)`,
        `CREATE TABLE ${part} PARTITION OF ${parted} FOR VALUES FROM (0) TO (100)`,
      ]) {
        await adapter.executeQuery(statement);
      }
      const facts = await readDeletionFacts(adapter.getDrizzle(), dialect, [
        `DELETE FROM ${events}`,
        `DELETE FROM ${parted}`,
      ]);
      expect(facts.descendantsOf(events)).toEqual([child]);
      expect(facts.descendantsOf(parted)).toEqual([part]);
    },
    120_000
  );

  it.runIf(dialect !== "sqlite")(
    "reads nothing for a name two live tables share but for case, so a deletion there needs blanket consent",
    async () => {
      // PostgreSQL keeps a quoted name's case, and MySQL on Linux compares
      // table names by case, so both hold the two tables side by side.
      const twin = `${P}_twin`;
      const cased = dialect === "postgresql" ? `"${P}_Twin"` : `\`${P}_Twin\``;
      for (const statement of [
        `CREATE TABLE ${twin} (id integer PRIMARY KEY)`,
        `CREATE TABLE ${cased} (id integer PRIMARY KEY)`,
        `CREATE TABLE ${P}_twin_child (id integer PRIMARY KEY, twin_id integer, FOREIGN KEY (twin_id) REFERENCES ${cased} (id) ON DELETE CASCADE)`,
      ]) {
        await adapter.executeQuery(statement);
      }
      const facts = await readDeletionFacts(adapter.getDrizzle(), dialect, [
        `DELETE FROM ${twin}`,
      ]);
      // Which of the two the lower-cased name means cannot be told.
      expect(facts.cascadeFrom(twin)).toBeUndefined();
      expect(facts.hiddenCode(twin, "rows")).toBeUndefined();
    },
    120_000
  );

  it("reads the enabled DDL event triggers, none disabled, and none outside PostgreSQL", async () => {
    if (dialect !== "postgresql") {
      expect(await readDdlEventTriggers(adapter.getDrizzle(), dialect)).toEqual(
        []
      );
      return;
    }
    const on = `${P}_ddl_on`;
    const off = `${P}_ddl_off`;
    await adapter.executeQuery(
      `CREATE FUNCTION ${P}_ddl() RETURNS event_trigger AS 'BEGIN PERFORM 1; END' LANGUAGE plpgsql`
    );
    try {
      await adapter.executeQuery(
        `CREATE EVENT TRIGGER ${on} ON ddl_command_end EXECUTE FUNCTION ${P}_ddl()`
      );
      await adapter.executeQuery(
        `CREATE EVENT TRIGGER ${off} ON ddl_command_start EXECUTE FUNCTION ${P}_ddl()`
      );
      await adapter.executeQuery(`ALTER EVENT TRIGGER ${off} DISABLE`);
      const names = await readDdlEventTriggers(adapter.getDrizzle(), dialect);
      expect(names).toContain(on);
      expect(names).not.toContain(off);
    } finally {
      // An event trigger fires on every DDL in the database: never left behind.
      await adapter.executeQuery(`DROP EVENT TRIGGER IF EXISTS ${on}`);
      await adapter.executeQuery(`DROP EVENT TRIGGER IF EXISTS ${off}`);
    }
  }, 120_000);

  it("judges a file against the facts the database gives", async () => {
    const facts = await readDeletionFacts(
      adapter.getDrizzle(),
      dialect,
      statements
    );
    const missingCascade = {
      kind: "unnamed",
      description: `rows removed from tables ${missing}'s foreign keys cascade to, which could not be read`,
    };
    // A table the database lacks has no code or descendants to read
    // either, and each fails closed as its keys do.
    const missingTriggers = {
      kind: "unnamed",
      description: `rows removed from ${missing} may run code the table carries, which could not be read`,
    };
    const missingDescendants = {
      kind: "unnamed",
      description: `rows removed from tables that inherit from ${missing} or partition it, which could not be read`,
    };
    expect(fileDeletions(statements, dialect, facts)).toEqual([
      { kind: "rows", table: parent },
      // No cascade fires on SQLite: the runner applies a file with foreign
      // keys off, so neither the children nor an unread table are named.
      ...(dialect === "sqlite"
        ? [{ kind: "rows", table: missing }]
        : [
            { kind: "rows", table: child },
            { kind: "rows", table: grand },
            { kind: "rows", table: missing },
            ...(dialect === "postgresql" ? [missingDescendants] : []),
            missingCascade,
          ]),
      missingTriggers,
      ...(dialect === "postgresql" ? [{ kind: "rows", table: keeper }] : []),
      ...(dialect === "sqlite"
        ? [{ kind: "column", table: posts, column: "body" }]
        : []),
    ]);
  }, 120_000);
});
