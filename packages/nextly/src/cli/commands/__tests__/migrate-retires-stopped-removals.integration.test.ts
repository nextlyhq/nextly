/**
 * Every document of a collection removed from code ends with exactly one `deleted` event, however
 * the run that applies the removal stopped, on PostgreSQL, MySQL and SQLite. The migrations are the
 * ones `nextly migrate:create` writes; an edited one is said to be.
 *
 * Inside the file, PostgreSQL and SQLite roll a stopped run back whole and the next applies it. On
 * MySQL, and for a file run outside a transaction, what ran stays, and an outcome is recorded by
 * `migrate:resolve`. Once the file is recorded applied, the next run finishes, with nothing pending.
 * `migrate:down` ends the documents of what its DOWN drops the same way.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { expect, it, vi } from "vitest";

import { createAdapter } from "../../../database/factory";
import { retirementCheckpoint } from "../../../domains/schema/migrate/retired-documents";
import { tableHold } from "../../../domains/schema/migrate/retirement-hold";
import { splitSqlStatements } from "../../../domains/schema/migrate/split-sql";
import { parseSqlSections } from "../../../domains/schema/migrate/sql-sections";
import {
  KILL_AT_VARIABLE,
  KILLED_AT,
  withStopPoints,
} from "../../../domains/schema/migrate/stop-points";
import { _resetEnvCache } from "../../../shared/lib/env";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import type { TestDialect } from "../../../plugins/test-nextly";
import {
  NEXTLY_RUN_TIMEOUT,
  runNextly,
} from "../../__tests__/helpers/run-nextly";
import { runMigrateDown } from "../migrate-down";
import { runMigrateResolve } from "../migrate-resolve";

import {
  appConfig,
  boot,
  captures,
  deletions,
  DROP,
  edited,
  forgetUnrecordableCapture,
  insertingPosts,
  insertPost,
  migrate,
  migrateCreate,
  orphanedPermissions,
  pathOf,
  POSTS,
  postDeleted,
  project,
  removalWritten,
  runs,
  stands,
  started,
  storeUnrecordableCapture,
  useGeneratedMigrations,
  WITH_POSTS,
} from "./helpers/generated-migrations";

/** The config the commands load, set by each step before it runs them. */
const loaded = vi.hoisted(() => ({ config: undefined as unknown }));

/** Whether the run's next check of the schema lock finds it lost, as a run whose lease lapsed. */
const lock = vi.hoisted(() => ({ lost: false }));
vi.mock(
  "../../../domains/schema/pipeline/schema-lock",
  async importOriginal => {
    const original =
      await importOriginal<
        typeof import("../../../domains/schema/pipeline/schema-lock")
      >();
    return {
      ...original,
      assertSchemaLockHeld: async () => {
        if (lock.lost) {
          lock.lost = false;
          throw original.lostLockError("nextly migrate");
        }
        await original.assertSchemaLockHeld();
      },
    };
  }
);
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

useGeneratedMigrations(loaded);

const EACH_ONCE = { p1: 1, p2: 1 };
const GONE = { posts: "removed", pagesNamePosts: false } as const;

/** The statements of one section of the file that removes `posts`. */
const statementsOf = (dialect: TestDialect, section: "upSql" | "downSql") =>
  splitSqlStatements(
    parseSqlSections(readFileSync(pathOf("remove"), "utf8"))[section],
    dialect
  );

/** `nextly migrate` over `config`, stopped where `at` holds of a point it reaches. */
const stoppedAt = (config: unknown, at: (point: string) => boolean) =>
  withStopPoints(
    point => {
      if (at(point)) throw new Error(`stopped at ${point}`);
    },
    () => migrate(config)
  );

/** The name a run's points give the file that removes `posts`. */
const removal = () => basename(pathOf("remove"));

/** The file's marker for a run outside a transaction, as `--no-transaction` writes it. */
const outsideTransaction = (sql: string) => `-- nextly:no-transaction\n${sql}`;

const resolved = (config: unknown, outcome: object) =>
  runs(config, context =>
    runMigrateResolve(
      { cwd: project.dir, ...outcome } as Parameters<
        typeof runMigrateResolve
      >[0],
      context
    )
  );

/** Another instance's connection to the test's database. */
const otherInstance = (dialect: TestDialect) =>
  createAdapter({
    type: dialect,
    url: process.env.DATABASE_URL,
  } as Parameters<typeof createAdapter>[0]);

const rolledBack = (config: unknown, step = 1) =>
  runs(config, context =>
    runMigrateDown(
      {
        cwd: project.dir,
        step,
        acceptDataLoss: true,
        yes: true,
      } as Parameters<typeof runMigrateDown>[0],
      context
    )
  );

describeEachDialect("a removal in code, however its run stops", dialect => {
  it.each(["files recorded", "collection gt_posts: recorded deletion events"])(
    "finishes, with nothing pending, a run stopped at %s, with no event twice",
    async at => {
      const gone = await removalWritten(dialect);

      expect(await stoppedAt(gone, point => point === at)).toMatch(/stopped/);
      expect(await stands(POSTS)).toBe(false);
      expect(await deletions()).toEqual({});

      expect(await migrate(gone)).toBeUndefined();
      expect(await deletions()).toEqual(EACH_ONCE);
      expect(await migrate(gone)).toBeUndefined();
      expect(await deletions()).toEqual(EACH_ONCE);
      expect(await captures()).toBe(0);
    }
  );

  it("removes nothing when it stops inside the file, and records each event once when it applies", async () => {
    // MySQL keeps each drop as it runs: resolved below.
    if (dialect === "mysql") return;
    const gone = await removalWritten(dialect);
    const at = [
      `${removal()}: before statement 1`,
      "collection gt_posts: captured",
      `${removal()}: after statement 1`,
    ];

    for (const point of at) {
      expect(await stoppedAt(gone, each => each === point), point).toMatch(
        /stopped/
      );
      expect(await stands(POSTS), point).toBe(true);
      expect(await deletions(), point).toEqual({});
      expect(await captures(), point).toBe(0);
    }

    expect(await migrate(gone)).toBeUndefined();
    expect(await deletions()).toEqual(EACH_ONCE);
    expect(await captures()).toBe(0);
  });

  /** Where a stopped file's statements stay: MySQL's always, others' outside a transaction. */
  const STAYING =
    dialect === "mysql"
      ? ["in a transaction", "outside a transaction"]
      : ["outside a transaction"];

  /** The removal written, its file run `how`, stopped once its drop has run; what the run then holds. */
  async function stoppedAfterItsDrop(how: string): Promise<{
    gone: unknown;
    stored: number;
  }> {
    const gone = await removalWritten(dialect);
    if (how === "outside a transaction") edited("remove", outsideTransaction);
    expect(
      await stoppedAt(
        gone,
        point => point === `${removal()}: after statement 1`
      )
    ).toMatch(/stopped/);
    expect(await stands(POSTS)).toBe(false);
    const stored = await captures();
    expect(stored).toBeGreaterThan(0);
    return { gone, stored };
  }

  it.each(STAYING)(
    "ends each document once where a file stopped after its drop, run %s, is resolved as applied",
    async how => {
      const { gone, stored } = await stoppedAfterItsDrop(how);
      // The next run refuses, naming the file, runs nothing again, and forgets none of the ids.
      const refused = await migrate(gone);
      expect(refused, "applied").toBeDefined();
      expect(refused).toContain(removal());
      // Each statement of it, as done or not done.
      expect(refused).toMatch(
        /statement 1 \(DROP TABLE [`"]dc_gt_posts[`"]( CASCADE)?\) is done; statement 2 \(.*?\) is not done/
      );
      expect(await captures()).toBe(stored);
      expect(await deletions()).toEqual({});

      // Its other statements finished by hand, as the refusal asks.
      for (const statement of statementsOf(dialect, "upSql").slice(1)) {
        await project.adapter.executeQuery(statement);
      }
      expect(await resolved(gone, { applied: removal() })).toBeUndefined();
      expect(await migrate(gone)).toBeUndefined();

      expect(await deletions()).toEqual(EACH_ONCE);
      expect(await captures()).toBe(0);
    }
  );

  it.each(STAYING)(
    "ends nothing where a file stopped after its drop, run %s, is undone by hand and resolved as rolled back, until it applies",
    async how => {
      const { gone } = await stoppedAfterItsDrop(how);
      // The drop undone: the table as the file's own DOWN makes it, with the rows it had.
      for (const statement of statementsOf(dialect, "downSql").filter(each =>
        each.includes(POSTS)
      )) {
        await project.adapter.executeQuery(statement);
      }
      await insertPost(dialect, "p1");
      await insertPost(dialect, "p2");
      expect(
        await resolved(gone, { failedCleanup: removal() })
      ).toBeUndefined();
      expect(await stands(POSTS)).toBe(true);
      expect(await deletions()).toEqual({});

      expect(await migrate(gone)).toBeUndefined();

      expect(await stands(POSTS)).toBe(false);
      expect(await deletions()).toEqual(EACH_ONCE);
      expect(await captures()).toBe(0);
    }
  );

  it("is refused where it was edited to keep a table that is already gone, until it is recorded applied", async () => {
    const gone = await removalWritten(dialect);
    await project.adapter.executeQuery(
      `DROP TABLE ${POSTS}${dialect === "postgresql" ? " CASCADE" : ""}`
    );
    const others = statementsOf(dialect, "upSql").slice(1);
    edited("remove", sql => sql.replace(DROP, ""));

    // The table's absence is refused first, by its name, as any applied migration's is.
    const refused = await migrate(gone);
    expect(refused, "applied").toMatch(/DATABASE_BEHIND_MIGRATIONS/);
    expect(refused).toContain(POSTS);

    for (const statement of others) {
      await project.adapter.executeQuery(statement);
    }
    expect(await resolved(gone, { applied: removal() })).toBeUndefined();
    expect(await migrate(gone)).toBeUndefined();
    // Nothing named its documents before they went.
    expect(await deletions()).toEqual({});
  });

  it("ends each document once where the file runs outside a transaction", async () => {
    const gone = await removalWritten(dialect);
    edited("remove", outsideTransaction);

    expect(await migrate(gone)).toBeUndefined();

    expect(await stands(POSTS)).toBe(false);
    expect(await deletions()).toEqual(EACH_ONCE);
    expect(await captures()).toBe(0);
  });

  it("ends every document where they take several rows of ids, and finishes a run stopped between rows", async () => {
    const gone = await removalWritten(dialect);
    const ids = Array.from(
      { length: 1_001 },
      (_, n) => `q${String(n).padStart(4, "0")}`
    );
    for (let n = 0; n < ids.length; n += 200) {
      await project.adapter.executeQuery(
        await insertingPosts(dialect, ids.slice(n, n + 200))
      );
    }
    let rows = 0;

    expect(
      await stoppedAt(gone, point => {
        if (point !== "collection gt_posts: recorded deletion events") {
          return false;
        }
        rows += 1;
        return rows === 2;
      })
    ).toMatch(/stopped/);
    expect(Object.keys(await deletions())).toHaveLength(500);

    expect(await migrate(gone)).toBeUndefined();

    const counts = await deletions();
    expect(Object.keys(counts).sort()).toEqual([...ids, "p1", "p2"].sort());
    expect(new Set(Object.values(counts))).toEqual(new Set([1]));
    expect(await captures()).toBe(0);
  });

  it("ends a document the file itself stores, or gives another id, before it drops the table", async () => {
    const gone = await removalWritten(dialect);
    const insert = await insertingPosts(dialect, ["p3"]);
    const table = dialect === "mysql" ? `\`${POSTS}\`` : `"${POSTS}"`;
    edited("remove", sql =>
      sql.replace(
        DROP,
        drop =>
          `${insert};\nUPDATE ${table} SET id = 'p9' WHERE id = 'p2';\n${drop}`
      )
    );

    expect(await migrate(gone)).toBeUndefined();

    expect(await deletions()).toEqual({ p1: 1, p3: 1, p9: 1 });
  });

  it.each(["in a transaction", "outside a transaction"])(
    "ends a document's own life where one made later under its id is deleted before the run finishes, the file run %s",
    async how => {
      const gone = await removalWritten(dialect);
      if (how === "outside a transaction") edited("remove", outsideTransaction);
      expect(
        await stoppedAt(gone, point => point === "files recorded")
      ).toMatch(/stopped/);
      // As where the entity is made again, its id used again, and that document deleted.
      await postDeleted("p1");

      expect(await migrate(gone)).toBeUndefined();

      expect(await deletions()).toEqual({ p1: 2, p2: 1 });
    }
  );

  it.each(["in a transaction", "outside a transaction"])(
    "lets no other instance store or delete a document between the capture and the drop, %s",
    async how => {
      const gone = await removalWritten(dialect);
      if (how === "outside a transaction") edited("remove", outsideTransaction);
      const insert = await insertingPosts(dialect, ["p3"]);
      const others = [
        await otherInstance(dialect),
        await otherInstance(dialect),
      ];
      const writes: Promise<string>[] = [];

      try {
        const said: string[] = [];
        const failed = await withStopPoints(
          async point => {
            if (point !== "collection gt_posts: captured") return;
            for (const [n, statement] of [
              insert,
              `DELETE FROM ${POSTS} WHERE id = 'p1'`,
            ].entries()) {
              writes.push(
                others[n].executeQuery(statement).then(
                  () => "went",
                  () => "refused"
                )
              );
            }
            // Long enough for both to have reached the database.
            await new Promise(resolve => setTimeout(resolve, 500));
          },
          () => migrate(gone, said)
        );
        expect(failed).toBeUndefined();
        expect(await Promise.all(writes)).toEqual(["refused", "refused"]);
        expect(said.filter(line => line.includes("can be missing"))).toEqual(
          []
        );
      } finally {
        for (const other of others) await other.disconnect();
      }

      expect(await deletions()).toEqual(EACH_ONCE);
      expect(await captures()).toBe(0);
    }
  );

  /** `run`, as a MySQL account that may do everything a migration does and lock no table. */
  async function withoutLockTables<T>(run: () => Promise<T>): Promise<T> {
    const own = process.env.DATABASE_URL!;
    const url = new URL(own);
    const database = url.pathname.replace(/^\//, "");
    const user = `${database.slice(-20)}_nolock`;
    url.username = user;
    url.password = "nolock";
    await project.adapter.executeQuery(`DROP USER IF EXISTS '${user}'@'%'`);
    await project.adapter.executeQuery(
      `CREATE USER '${user}'@'%' IDENTIFIED BY 'nolock'`
    );
    try {
      await project.adapter.executeQuery(
        `GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, REFERENCES, INDEX, ALTER, TRIGGER, CREATE VIEW, SHOW VIEW, CREATE TEMPORARY TABLES ON \`${database}\`.* TO '${user}'@'%'`
      );
      process.env.DATABASE_URL = url.toString();
      _resetEnvCache();
      return await run();
    } finally {
      process.env.DATABASE_URL = own;
      _resetEnvCache();
      await project.adapter.executeQuery(`DROP USER '${user}'@'%'`);
    }
  }

  it.each(dialect === "mysql" ? STAYING : [])(
    "sends no drop where the lock was lost while its documents were read, %s",
    async how => {
      const gone = await removalWritten(dialect);
      if (how === "outside a transaction") edited("remove", outsideTransaction);

      const failed = await withStopPoints(
        point => {
          if (point === "collection gt_posts: captured") lock.lost = true;
        },
        () => migrate(gone)
      );

      expect(failed, "applied").toMatch(/lock/i);
      expect(await stands(POSTS)).toBe(true);
    }
  );

  it.each(dialect === "mysql" ? STAYING : [])(
    "says so once where the account may not lock tables, and ends each document once, %s",
    async how => {
      const gone = await removalWritten(dialect);
      if (how === "outside a transaction") edited("remove", outsideTransaction);
      const said: string[] = [];

      const failed = await withoutLockTables(() =>
        withStopPoints(
          async point => {
            // Nothing holds the table: an ordinary delete of p1, its row and its event.
            if (point !== "collection gt_posts: captured") return;
            await postDeleted("p1");
          },
          () => migrate(gone, said)
        )
      );

      expect(failed).toBeUndefined();
      expect(
        said.filter(line => /can be missing.*LOCK TABLES/.test(line))
      ).toHaveLength(1);
      expect(await deletions()).toEqual(EACH_ONCE);
      expect(await captures()).toBe(0);
    }
  );

  it.each(dialect === "mysql" ? STAYING : [])(
    "runs the file's own statements once where the account may not lock tables and the capture waits, %s",
    async how => {
      const gone = await removalWritten(dialect);
      const insert = await insertingPosts(dialect, ["p3"]);
      edited("remove", sql => sql.replace(DROP, drop => `${insert};\n${drop}`));
      if (how === "outside a transaction") edited("remove", outsideTransaction);
      const said: string[] = [];

      const { failed, waited } = await whileHeld(
        tx => tx.execute("LOCK TABLES nextly_meta WRITE"),
        `${removal()}: before statement 2`,
        () => withoutLockTables(() => migrate(gone, said))
      );

      expect(failed, said.join("\n")).toBeUndefined();
      expect(waited).toBeGreaterThan(3_900);
      expect(await deletions()).toEqual({ ...EACH_ONCE, p3: 1 });
      expect(await captures()).toBe(0);
    },
    90_000
  );

  it.each(["in a transaction", "outside a transaction"])(
    "ends each document once where the run has one connection, %s",
    async how => {
      const gone = await removalWritten(dialect);
      if (how === "outside a transaction") edited("remove", outsideTransaction);
      process.env.DB_POOL_MAX = "1";
      process.env.DB_POOL_MIN = "0";
      _resetEnvCache();
      try {
        const said: string[] = [];
        expect(await migrate(gone, said)).toBeUndefined();
        expect(said.filter(line => line.includes("can be missing"))).toEqual(
          []
        );
      } finally {
        delete process.env.DB_POOL_MAX;
        delete process.env.DB_POOL_MIN;
        _resetEnvCache();
      }

      expect(await deletions()).toEqual(EACH_ONCE);
      expect(await captures()).toBe(0);
    },
    60_000
  );

  /** Holds `table` in another session, by `holding`, from when the run reaches `at` for four seconds. */
  async function whileHeld(
    holding: (tx: {
      execute(statement: string): Promise<unknown>;
    }) => Promise<unknown>,
    at: string,
    run: () => Promise<string | undefined>
  ): Promise<{ failed: string | undefined; waited: number }> {
    process.env.NEXTLY_LOCK_TIMEOUT = "1";
    process.env.NEXTLY_LOCK_TIMEOUT_TOTAL = "40";
    const other = await otherInstance(dialect);
    let holder: Promise<unknown> | undefined;
    let from = 0;
    try {
      const failed = await withStopPoints(async point => {
        if (point !== at || holder !== undefined) return;
        await new Promise<void>((held, refused) => {
          holder = other
            .transaction(async tx => {
              await holding(tx);
              from = performance.now();
              held();
              await new Promise(resolve => setTimeout(resolve, 4_000));
              if (dialect === "mysql") await tx.execute("UNLOCK TABLES");
            })
            .catch(refused);
        });
      }, run);
      return { failed, waited: performance.now() - from };
    } finally {
      await holder;
      await other.disconnect();
      delete process.env.NEXTLY_LOCK_TIMEOUT;
      delete process.env.NEXTLY_LOCK_TIMEOUT_TOTAL;
    }
  }

  // SQLite's one writer is waited for before the file starts, and a transaction on PostgreSQL holds
  // the table from before its first statement.
  it.each(dialect === "sqlite" ? [] : STAYING)(
    "waits for a table in use in tries, runs the file's own statements once, and ends each document once, %s",
    async how => {
      const gone = await removalWritten(dialect);
      const insert = await insertingPosts(dialect, ["p3"]);
      edited("remove", sql => sql.replace(DROP, drop => `${insert};\n${drop}`));
      if (how === "outside a transaction") edited("remove", outsideTransaction);
      const said: string[] = [];

      const { failed, waited } = await whileHeld(
        tx => tx.execute(`SELECT COUNT(*) FROM ${POSTS}`),
        `${removal()}: before statement 1`,
        () => migrate(gone, said)
      );

      expect(failed, said.join("\n")).toBeUndefined();
      // The premise: the run waited several tries long, one lasting a second.
      expect(waited).toBeGreaterThan(3_900);
      expect(await deletions()).toEqual({ ...EACH_ONCE, p3: 1 });
      expect(await captures()).toBe(0);
    },
    90_000
  );

  it.each(["in a transaction", "outside a transaction"])(
    "ends each document once where one statement drops several tables, %s",
    async how => {
      // SQLite drops one table a statement.
      if (dialect === "sqlite") return;
      const gone = await removalWritten(dialect);
      await project.adapter.executeQuery("CREATE TABLE gt_extra (id INT)");
      edited("remove", sql =>
        sql.replace(DROP, drop =>
          drop.replace(/(dc_gt_posts[`"])/, "$1, gt_extra")
        )
      );
      if (how === "outside a transaction") edited("remove", outsideTransaction);

      const said: string[] = [];
      expect(await migrate(gone, said), said.join("\n")).toBeUndefined();

      expect(await stands("gt_extra")).toBe(false);
      expect(said.filter(line => line.includes("can be missing"))).toEqual([]);
      expect(await deletions()).toEqual(EACH_ONCE);
      expect(await captures()).toBe(0);
    }
  );

  it.each(dialect === "mysql" ? STAYING : [])(
    "says so once where one statement drops a table that is not there too, %s",
    async how => {
      const gone = await removalWritten(dialect);
      edited("remove", sql =>
        sql.replace(DROP, "DROP TABLE IF EXISTS `dc_gt_posts`, `gt_not_there`;")
      );
      if (how === "outside a transaction") edited("remove", outsideTransaction);

      const said: string[] = [];
      expect(await migrate(gone, said), said.join("\n")).toBeUndefined();

      expect(
        said.filter(line => /can be missing.*not there/.test(line))
      ).toHaveLength(1);
      expect(await deletions()).toEqual(EACH_ONCE);
    }
  );

  it("ends a document another instance stores after the run starts and before the drop", async () => {
    await started(dialect);
    const insert = await insertingPosts(dialect, ["p3"]);
    const changed = appConfig({ posts: "optional", pagesNamePosts: false });
    expect((await migrateCreate(changed, "change")).refused).toBeUndefined();
    const gone = appConfig(GONE);
    expect((await migrateCreate(gone, "remove")).refused).toBeUndefined();
    const other = await otherInstance(dialect);
    let stored = 0;

    try {
      const failed = await withStopPoints(
        async point => {
          // Between the two files: the run has written, and nothing holds the table.
          if (!point.endsWith("_change.sql: recorded applied")) return;
          await other.executeQuery(insert);
          stored += 1;
        },
        () => migrate(gone)
      );
      expect(failed).toBeUndefined();
    } finally {
      await other.disconnect();
    }

    expect(stored).toBe(1);
    expect(await deletions()).toEqual({ ...EACH_ONCE, p3: 1 });
  });

  it("on PostgreSQL, refuses a document another instance stores once its table is held", async () => {
    if (dialect !== "postgresql") return;
    const gone = await removalWritten(dialect);
    const insert = await insertingPosts(dialect, ["p3"]);
    const other = await otherInstance(dialect);
    let write: Promise<string> | undefined;

    try {
      const failed = await withStopPoints(
        point => {
          if (point !== "collection gt_posts: captured") return;
          write = other.executeQuery(insert).then(
            () => "stored",
            () => "refused"
          );
        },
        () => migrate(gone)
      );
      expect(failed).toBeUndefined();
      expect(await write).toBe("refused");
    } finally {
      await other.disconnect();
    }

    expect(await deletions()).toEqual(EACH_ONCE);
  });

  it("ends each life once where one run removes it, makes it again under an id it reuses, and removes it", async () => {
    const gone = await removalWritten(dialect);
    const insert = await insertingPosts(dialect, ["p1"]);
    expect(
      (
        await migrateCreate(
          appConfig({ posts: "required", pagesNamePosts: false }),
          "again"
        )
      ).refused
    ).toBeUndefined();
    edited("again", sql => sql.replace("-- DOWN", `${insert};\n\n-- DOWN`));
    expect((await migrateCreate(gone, "final")).refused).toBeUndefined();

    expect(await migrate(gone)).toBeUndefined();

    expect(await deletions()).toEqual({ p1: 2, p2: 1 });
    expect(await captures()).toBe(0);
  });

  it("finishes before a configuration that declares it again is refused, and keeps none of it for the new one", async () => {
    const gone = await removalWritten(dialect);
    expect(await stoppedAt(gone, point => point === "files recorded")).toMatch(
      /stopped/
    );
    const again = appConfig({ posts: "required", pagesNamePosts: false });

    // Refused: no migration records it declared again. The retirement is finished first.
    expect(await migrate(again)).toBeDefined();
    expect(await deletions()).toEqual(EACH_ONCE);
    expect(await orphanedPermissions()).not.toContain(false);

    expect((await migrateCreate(again, "again")).refused).toBeUndefined();
    expect(await migrate(again)).toBeUndefined();
    expect(
      await project.adapter.executeQuery(
        dialect === "mysql"
          ? `SELECT id FROM \`${POSTS}\``
          : `SELECT id FROM "${POSTS}"`
      )
    ).toEqual([]);
    expect(await deletions()).toEqual(EACH_ONCE);
    // Declared again, its permissions are live again.
    expect(await orphanedPermissions()).not.toContain(true);
  });

  it("writes nothing before it refuses a configuration with nothing left to finish", async () => {
    await started(dialect);
    // A registry value no migration records, which a registry pass would put back.
    await project.adapter.update(
      "dynamic_collections",
      { description: "kept by hand" },
      { and: [{ column: "slug", op: "=", value: "gt_pages" }] }
    );

    const refused = await migrate(
      appConfig({ posts: "optional", pagesNamePosts: true })
    );

    expect(refused, "applied").toBeDefined();
    const rows = await project.adapter.select<{ description: unknown }>(
      "dynamic_collections",
      { where: { and: [{ column: "slug", op: "=", value: "gt_pages" }] } }
    );
    expect(rows.map(row => row.description)).toEqual(["kept by hand"]);
  });

  it("records nothing, and says so, where the file makes a table of that name again", async () => {
    const gone = await removalWritten(dialect);
    edited("remove", sql =>
      sql.replace(
        DROP,
        drop => `${drop}\nCREATE TABLE ${POSTS} (id varchar(36) PRIMARY KEY);`
      )
    );
    const said: string[] = [];

    await migrate(gone, said);

    expect(await stands(POSTS)).toBe(true);
    expect(await deletions()).toEqual({});
    expect(await captures()).toBe(0);
    expect(said.filter(line => /still there/.test(line))).toHaveLength(1);
  });

  it("captures nothing where nextly_meta is not there", async () => {
    await started(dialect);
    await project.adapter.executeQuery("DROP TABLE nextly_meta");
    const checkpoint = retirementCheckpoint(
      [`DROP TABLE ${POSTS}`],
      dialect,
      {
        source: "x.sql",
        transaction: false,
        retirements: {
          entities: [{ kind: "collection", slug: "gt_posts", table: POSTS }],
        },
      },
      false,
      // The hold a migration run makes for the unit, so this case reads what the run reads.
      tableHold(project.adapter, dialect)
    );
    const db = project.adapter.getDrizzle();

    await expect(checkpoint.before(db, 0)).resolves.toBeUndefined();
    await expect(checkpoint.done(db)).resolves.toBeUndefined();
  });
});

describeEachDialect("a collection migrate:down drops", dialect => {
  /** `posts` added by a migration of its own over `pages`, two posts stored. */
  async function added(): Promise<unknown> {
    await boot(dialect);
    const before = appConfig(GONE);
    expect((await migrateCreate(before, "start")).refused).toBeUndefined();
    expect(await migrate(before)).toBeUndefined();
    const config = appConfig({ posts: "required", pagesNamePosts: false });
    expect((await migrateCreate(config, "add")).refused).toBeUndefined();
    expect(await migrate(config)).toBeUndefined();
    await insertPost(dialect, "p1");
    await insertPost(dialect, "p2");
    return config;
  }

  it("ends each of its documents once", async () => {
    const config = await added();

    expect(await rolledBack(config)).toBeUndefined();

    expect(await stands(POSTS)).toBe(false);
    expect(await deletions()).toEqual(EACH_ONCE);
    expect(await captures()).toBe(0);
  });

  it("ends each once where a later change of it is rolled back with it", async () => {
    await added();
    const changed = appConfig({ posts: "optional", pagesNamePosts: false });
    expect((await migrateCreate(changed, "change")).refused).toBeUndefined();
    expect(await migrate(changed)).toBeUndefined();
    expect(await deletions()).toEqual({});

    expect(await rolledBack(changed, 2)).toBeUndefined();

    expect(await stands(POSTS)).toBe(false);
    expect(await deletions()).toEqual(EACH_ONCE);
    expect(await captures()).toBe(0);
  });

  it("ends them where the project's first migration is rolled back", async () => {
    await started(dialect);

    const refused = await rolledBack(appConfig(WITH_POSTS));

    // Rolled back or refused as before this change; never half of it.
    expect(await deletions()).toEqual(refused === undefined ? EACH_ONCE : {});
    expect(await stands(POSTS)).toBe(refused !== undefined);
  });

  it("is refused, as it was, where its applied file was edited to keep the table", async () => {
    const config = await added();
    edited("add", sql => sql.replace(DROP, ""));

    const refused = await rolledBack(config);

    expect(refused, "rolled back").toBeDefined();
    expect(await stands(POSTS)).toBe(true);
    expect(await deletions()).toEqual({});
  });

  it("ends an UP's documents before its file is rolled back and the table made again", async () => {
    const gone = await removalWritten(dialect);
    expect(await stoppedAt(gone, point => point === "files recorded")).toMatch(
      /stopped/
    );
    expect(await captures()).toBeGreaterThan(0);

    expect(await rolledBack(gone)).toBeUndefined();

    expect(await stands(POSTS)).toBe(true);
    expect(await deletions()).toEqual(EACH_ONCE);
    expect(await captures()).toBe(0);
  });

  it("stays rolled back where its events fail after the DOWN commits, and the next run records them", async () => {
    const config = await added();

    const failed = await withStopPoints(
      point => {
        if (point === "collection gt_posts: recorded deletion events") {
          throw new Error("stopped");
        }
      },
      () => rolledBack(config)
    );

    expect(failed).toBeUndefined();
    expect(await stands(POSTS)).toBe(false);
    expect(await deletions()).toEqual({});
    expect(await captures()).toBeGreaterThan(0);

    // Recorded before the file is applied again.
    expect(await migrate(config)).toBeUndefined();
    expect(await stands(POSTS)).toBe(true);
    expect(await deletions()).toEqual(EACH_ONCE);
    expect(await captures()).toBe(0);
  });
});

describeEachDialect("captures that cannot be recorded", dialect => {
  it("refuse a run where a DOWN's waits behind an UP's of the same entity", async () => {
    await started(dialect);
    // A file recorded applied, so its UP capture is recorded, and fails, before the DOWN one.
    const applied = basename(pathOf("start"));
    await storeUnrecordableCapture(applied, "up", ["u1"]);
    // Taken after the UP's, so it waits behind it rather than failing first on its own.
    await storeUnrecordableCapture(applied, "down", ["d1"], 1);
    const gone = appConfig({ posts: "removed", pagesNamePosts: false });
    expect((await migrateCreate(gone, "remove")).refused).toBeUndefined();

    const refused = await migrate(gone);

    expect(refused, "applied").toMatch(/could not be recorded/);
    expect(await stands(POSTS)).toBe(true);
    expect(await captures()).toBe(4);
    await forgetUnrecordableCapture();
  });

  it("refuse a rollback of the file they wait on, and are kept", async () => {
    const gone = await removalWritten(dialect);
    expect(await stoppedAt(gone, point => point === "files recorded")).toMatch(
      /stopped/
    );
    await storeUnrecordableCapture(removal(), "up", ["z1"]);

    const refused = await rolledBack(gone);

    expect(refused, "rolled back").toMatch(/could not be recorded/);
    expect(await stands(POSTS)).toBe(false);
    // The others were recorded; the one that can't be waits.
    expect(await deletions()).toEqual(EACH_ONCE);
    expect(await captures()).toBe(2);
  });

  it("refuse a run that would apply a rolled-back file again, and are kept", async () => {
    await boot(dialect);
    const before = appConfig(GONE);
    expect((await migrateCreate(before, "start")).refused).toBeUndefined();
    expect(await migrate(before)).toBeUndefined();
    const config = appConfig({ posts: "required", pagesNamePosts: false });
    expect((await migrateCreate(config, "add")).refused).toBeUndefined();
    expect(await migrate(config)).toBeUndefined();
    await insertPost(dialect, "p1");
    await withStopPoints(
      point => {
        if (point === "collection gt_posts: recorded deletion events") {
          throw new Error("stopped");
        }
      },
      () => rolledBack(config)
    );
    expect(await captures()).toBeGreaterThan(0);
    await storeUnrecordableCapture(basename(pathOf("add")), "down", ["z1"]);

    const refused = await migrate(config);

    expect(refused, "applied").toMatch(/could not be recorded/);
    expect(await stands(POSTS)).toBe(false);
    expect(await captures()).toBe(2);
    await forgetUnrecordableCapture();
    expect(await migrate(config)).toBeUndefined();
    expect(await stands(POSTS)).toBe(true);
    expect(await deletions()).toEqual({ p1: 1 });
  });
});

describeEachDialect(
  "a collection kept in a table spelled in capitals",
  dialect => {
    const UPPER = "dc_Gt_Upper";
    // On PostgreSQL the check that a change removes no other owner's element cannot read a table
    // spelled so, and refuses to write or to apply its removal, failing closed: these wait for it.
    const refusedFirst = dialect === "postgresql";
    const quoted = dialect === "mysql" ? `\`${UPPER}\`` : `"${UPPER}"`;

    /** Its removal written, two posts stored. */
    async function removalOfUpper(): Promise<unknown> {
      await boot(dialect);
      const config = appConfig({
        posts: "required",
        pagesNamePosts: false,
        dbName: UPPER,
      });
      expect((await migrateCreate(config, "start")).refused).toBeUndefined();
      expect(await migrate(config)).toBeUndefined();
      await project.adapter.executeQuery(
        await insertingPosts(dialect, ["p1", "p2"], UPPER)
      );
      const gone = appConfig(GONE);
      const { sql, refused } = await migrateCreate(gone, "remove");
      expect(refused).toBeUndefined();
      expect(sql).toContain(quoted);
      return gone;
    }

    it.skipIf(refusedFirst)("ends each of its documents once", async () => {
      const gone = await removalOfUpper();

      expect(await migrate(gone)).toBeUndefined();

      expect(await deletions()).toEqual(EACH_ONCE);
      expect(await captures()).toBe(0);
    });

    it.skipIf(refusedFirst)(
      "on PostgreSQL, is not taken for a table of the same name in lower case",
      async () => {
        if (dialect !== "postgresql") return;
        const gone = await removalOfUpper();
        await project.adapter.executeQuery(
          `CREATE TABLE ${UPPER.toLowerCase()} (id varchar(36) PRIMARY KEY)`
        );
        await project.adapter.executeQuery(
          `INSERT INTO ${UPPER.toLowerCase()} VALUES ('other')`
        );

        expect(await migrate(gone)).toBeUndefined();

        expect(await deletions()).toEqual(EACH_ONCE);
        expect(await stands(UPPER.toLowerCase())).toBe(true);
        expect(await captures()).toBe(0);
      }
    );

    it.skipIf(refusedFirst)(
      "on PostgreSQL, ends nothing, and says so, where the file was edited to drop the lower-case one",
      async () => {
        if (dialect !== "postgresql") return;
        const gone = await removalOfUpper();
        await project.adapter.executeQuery(
          `CREATE TABLE ${UPPER.toLowerCase()} (id varchar(36) PRIMARY KEY)`
        );
        edited("remove", sql =>
          sql.replace(`DROP TABLE ${quoted} CASCADE`, `DROP TABLE ${UPPER}`)
        );
        const said: string[] = [];

        await migrate(gone, said);

        expect(await stands(UPPER)).toBe(true);
        expect(await deletions()).toEqual({});
        expect(await captures()).toBe(0);
        expect(said.filter(line => /still there/.test(line))).toHaveLength(1);
      }
    );
  }
);

describeEachDialect("a removal in code, its process killed", dialect => {
  /** How long one process may take: each compiles the CLI, on a machine other runs share. */
  const PROCESS_TIMEOUT = 2.5 * NEXTLY_RUN_TIMEOUT;

  /** `nextly migrate` as a real process, killing itself at `killAt` where one is named. */
  async function migrateProcess(killAt?: string) {
    const { collections } = appConfig(GONE) as { collections: unknown };
    writeFileSync(
      join(project.dir, "nextly.config.ts"),
      `export default ${JSON.stringify({ collections, db: { migrationsDir: "./migrations" } })};\n`
    );
    const ran = await runNextly(
      [
        "migrate",
        "--accept-data-loss",
        "--non-interactive",
        // A killed run leaves its lock until it lapses; with nothing else running, the next clears it.
        "--force-unlock",
      ],
      project.dir,
      {
        DATABASE_URL: process.env.DATABASE_URL,
        DB_DIALECT: dialect,
        NODE_ENV: "test",
        [KILL_AT_VARIABLE]: killAt,
      },
      PROCESS_TIMEOUT
    );
    return { status: ran.status, said: `${ran.stdout}\n${ran.stderr}` };
  }

  it.each([
    "permissions not marked yet",
    "recorded applied",
    "files recorded",
    "registry written",
    "collection gt_posts: recorded deletion events",
  ])(
    "is finished by the next process where one was killed at: %s",
    async point => {
      await removalWritten(dialect);
      const at = /applied|marked/.test(point)
        ? `${removal()}: ${point}`
        : point;

      const killed = await migrateProcess(at);

      expect(killed.status, killed.said).not.toBe(0);
      expect(killed.said).toContain(`${KILLED_AT}${at}`);
      expect(await stands(POSTS)).toBe(false);
      expect(await deletions()).toEqual({});
      expect(await captures()).toBeGreaterThan(0);

      const finished = await migrateProcess();

      expect(finished.status, finished.said).toBe(0);
      expect(await deletions(), finished.said).toEqual(EACH_ONCE);
      expect(await captures(), finished.said).toBe(0);
      expect(await orphanedPermissions(), finished.said).not.toContain(false);
    },
    3 * PROCESS_TIMEOUT
  );

  it(
    "on MySQL, ends a document's own life where one was killed between the drop and the comparison, and one made later under its id is deleted",
    async () => {
      if (dialect !== "mysql") return;
      const gone = await removalWritten(dialect);

      const killed = await migrateProcess("collection gt_posts: dropped");

      expect(killed.said).toContain(`${KILLED_AT}collection gt_posts: dropped`);
      expect(await stands(POSTS)).toBe(false);
      for (const statement of statementsOf(dialect, "upSql").slice(1)) {
        await project.adapter.executeQuery(statement);
      }
      // As where the entity is made again, its id used again, and that document deleted.
      await postDeleted("p1", "created");
      await postDeleted("p1");
      expect(await resolved(gone, { applied: removal() })).toBeUndefined();

      const finished = await migrateProcess();

      expect(finished.status, finished.said).toBe(0);
      expect(await deletions(), finished.said).toEqual({ p1: 2, p2: 1 });
      expect(await captures(), finished.said).toBe(0);
    },
    3 * PROCESS_TIMEOUT
  );

  it(
    "removes nothing when killed inside the file, and ends each document once when it applies",
    async () => {
      // MySQL keeps each drop as it runs: resolved in the suite above.
      if (dialect === "mysql") return;
      await removalWritten(dialect);
      for (const at of [
        `${removal()}: before statement 1`,
        "collection gt_posts: captured",
        `${removal()}: after statement 1`,
      ]) {
        const killed = await migrateProcess(at);
        expect(killed.said).toContain(`${KILLED_AT}${at}`);
        expect(await stands(POSTS), at).toBe(true);
        expect(await deletions(), at).toEqual({});
        expect(await captures(), at).toBe(0);
      }

      const finished = await migrateProcess();

      expect(finished.status, finished.said).toBe(0);
      expect(await stands(POSTS), finished.said).toBe(false);
      expect(await deletions(), finished.said).toEqual(EACH_ONCE);
    },
    5 * PROCESS_TIMEOUT
  );
});
