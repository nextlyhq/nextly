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
import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { expect, it, vi } from "vitest";

import { createAdapter } from "../../../database/factory";
import { retirementCheckpoint } from "../../../domains/schema/migrate/retired-documents";
import { splitSqlStatements } from "../../../domains/schema/migrate/split-sql";
import { parseSqlSections } from "../../../domains/schema/migrate/sql-sections";
import { withStopPoints } from "../../../domains/schema/migrate/stop-points";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import type { TestDialect } from "../../../plugins/test-nextly";
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
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

useGeneratedMigrations(loaded);

const EACH_ONCE = { p1: 1, p2: 1 };
const GONE = { posts: "removed", pagesNamePosts: false } as const;

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

  it("on MySQL, ends each document once where the stopped file is resolved as applied", async () => {
    if (dialect !== "mysql") return;
    const gone = await removalWritten(dialect);
    expect(
      await stoppedAt(
        gone,
        point => point === `${removal()}: after statement 1`
      )
    ).toMatch(/stopped/);
    // The drop ran and its ids are stored; the next run refuses and forgets none of them.
    expect(await stands(POSTS)).toBe(false);
    const stored = await captures();
    expect(stored).toBeGreaterThan(0);
    expect(await migrate(gone)).toBeDefined();
    expect(await captures()).toBe(stored);
    expect(await deletions()).toEqual({});

    // Its other statements finished by hand, as the refusal asks.
    for (const statement of splitSqlStatements(
      parseSqlSections(readFileSync(pathOf("remove"), "utf8")).upSql,
      dialect
    ).slice(1)) {
      await project.adapter.executeQuery(statement);
    }
    expect(await resolved(gone, { applied: removal() })).toBeUndefined();
    expect(await migrate(gone)).toBeUndefined();

    expect(await deletions()).toEqual(EACH_ONCE);
    expect(await captures()).toBe(0);
  });

  it("on MySQL, ends nothing where the drop is undone and the file resolved as rolled back, until it applies", async () => {
    if (dialect !== "mysql") return;
    const gone = await removalWritten(dialect);
    await project.adapter.executeQuery(
      `CREATE TABLE gt_aside LIKE \`${POSTS}\``
    );
    await project.adapter.executeQuery(
      `INSERT INTO gt_aside SELECT * FROM \`${POSTS}\``
    );
    expect(
      await stoppedAt(
        gone,
        point => point === `${removal()}: after statement 1`
      )
    ).toMatch(/stopped/);
    await project.adapter.executeQuery(
      `ALTER TABLE gt_aside RENAME TO \`${POSTS}\``
    );
    expect(await resolved(gone, { failedCleanup: removal() })).toBeUndefined();
    expect(await stands(POSTS)).toBe(true);
    expect(await deletions()).toEqual({});

    expect(await migrate(gone)).toBeUndefined();

    expect(await stands(POSTS)).toBe(false);
    expect(await deletions()).toEqual(EACH_ONCE);
    expect(await captures()).toBe(0);
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
    "ends once a document another instance deletes as the drop starts, %s",
    async how => {
      // In a transaction PostgreSQL and SQLite hold the table from before the capture.
      if (how === "in a transaction" && dialect !== "mysql") return;
      const gone = await removalWritten(dialect);
      if (how === "outside a transaction") edited("remove", outsideTransaction);

      const failed = await withStopPoints(
        async point => {
          if (point !== "collection gt_posts: captured") return;
          await postDeleted("p1");
        },
        () => migrate(gone)
      );

      expect(failed).toBeUndefined();
      expect(await deletions()).toEqual(EACH_ONCE);
      expect(await captures()).toBe(0);
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
      false
    );
    const db = project.adapter.getDrizzle();

    await expect(checkpoint?.before(db, 0)).resolves.toBeUndefined();
    await expect(checkpoint?.done(db)).resolves.toBeUndefined();
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

  it("ends them where the project's first migration is rolled back", async () => {
    await started(dialect);

    const refused = await rolledBack(appConfig(WITH_POSTS));

    // Rolled back or refused as before this change; never half of it.
    expect(await deletions()).toEqual(refused === undefined ? EACH_ONCE : {});
    expect(await stands(POSTS)).toBe(refused !== undefined);
  });

  it("is refused by name, before any statement, where its file was edited to keep the table", async () => {
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
