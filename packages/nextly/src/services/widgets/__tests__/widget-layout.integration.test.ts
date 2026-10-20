/**
 * The layout row against a real database, on every dialect.
 *
 * The unit tests around this service mock it away entirely, so two things in it
 * have no coverage anywhere else, and both are exactly the kind that pass on
 * one dialect and fail on another after merge:
 *
 * - **The version guard reads a driver-specific field.** `affectedRowCount`
 *   reads `changes` on SQLite, `rowCount` on PostgreSQL and
 *   `ResultSetHeader.affectedRows` on MySQL. A missing field yields `undefined`
 *   and `?? 0` turns that into a plausible zero -- so a guard reading the wrong
 *   one reports EVERY write as a conflict, or, with the branches the other way
 *   round, never reports one and lets two tabs overwrite each other silently.
 * - **`id` is `varchar(191)`**, which only MySQL enforces. A scope id that fits
 *   on two dialects and truncates on the third is a reader whose layout lands
 *   on somebody else's row.
 *
 * SQLite runs with no URL; PostgreSQL and MySQL self-skip locally and run in
 * CI's dialect matrix.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAdapter } from "../../../database/factory";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import {
  layoutIsArranged,
  type WidgetPlacement,
} from "../../../domains/widgets/layout";
import { NextlyError } from "../../../errors/nextly-error";
import { layoutRowId } from "../../../schemas/widget-layout";
import { WidgetLayoutService } from "../widget-layout-service";

/**
 * This run's own suffix for every scope id below.
 *
 * PostgreSQL and MySQL keep a slot's test database between runs, and the cases save at version 0,
 * which a row an earlier run left behind refuses. A suffix fresh for each run gives every run rows
 * of its own, so the suite can run again on the same database with each case asserting exactly
 * what it did before. SQLite boots a fresh in-memory database, where the suffix changes nothing.
 * The whole UUID rather than a prefix of it, because the teardown deletes by it on databases that
 * other runs and other lanes share.
 */
const RUN = randomUUID();

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function placement(patch: Partial<WidgetPlacement> = {}): WidgetPlacement {
  return {
    id: "p1",
    widgetId: "core/team",
    width: "full",
    removed: false,
    ...patch,
  };
}

/**
 * The suite body, run once per dialect that is reachable.
 *
 * A factory rather than three copies, so a case added for one dialect cannot
 * quietly go unrun on the other two -- which is how a cross-dialect guarantee
 * ends up proven on the fastest dialect only.
 */
function layoutSuite(
  label: string,
  makeService: () => Promise<WidgetLayoutService>
) {
  describe(`widget layout row (${label})`, () => {
    let service: WidgetLayoutService;

    beforeAll(async () => {
      service = await makeService();
    });

    // Server databases outlive the run, so the rows it wrote go with it rather than piling up.
    // A setup that never reached the database wrote nothing, and has no service to delete with.
    afterAll(async () => {
      if (service !== undefined) await deleteRunRows(service);
    });

    it("round-trips an arrangement", async () => {
      const scope = `u-roundtrip-${label}-${RUN}`;
      const placements = [
        placement({ id: "a", width: "third" }),
        placement({
          id: "b",
          widgetId: "core/other",
          width: "quarter",
          removed: true,
          // Settings are opaque to core and must survive a real write as they
          // were sent: nested values, arrays, and text outside ASCII.
          config: { range: 30, labels: ["Ünïcode", "日本"], nested: { a: 1 } },
        }),
      ];

      const version = await service.saveLayout("user", scope, placements, 0);
      expect(version).toBe(1);

      const read = await service.getLayout("user", scope);
      expect(read.unreadable).toBe(false);
      expect(read.version).toBe(1);
      expect(read.layout?.placements).toEqual(placements);
    });

    it("keeps whether a row was arranged through a real write", async () => {
      // The flag lives inside the JSON payload rather than in a column, so no
      // dialect has a migration to get wrong -- which is exactly why it needs a
      // real round trip: nothing else proves the key survives a driver's text
      // handling on all three.
      const scope = `u-arranged-${label}-${RUN}`;
      await service.saveLayout(
        "user",
        scope,
        [placement({ removed: true })],
        0,
        false
      );
      const dismissed = await service.getLayout("user", scope);
      // `&&` so an absent row fails the assertion rather than satisfying it.
      expect(dismissed.layout && layoutIsArranged(dismissed.layout)).toBe(
        false
      );

      // And an arranged write afterwards clears it: the way out of following
      // the defaults has to survive storage too.
      await service.saveLayout(
        "user",
        scope,
        [placement()],
        dismissed.version,
        true
      );
      const arranged = await service.getLayout("user", scope);
      expect(arranged.layout && layoutIsArranged(arranged.layout)).toBe(true);
    });

    it("reports no row before anything is written", async () => {
      const read = await service.getLayout("user", `u-absent-${label}-${RUN}`);
      expect(read.layout).toBeUndefined();
      expect(read.version).toBe(0);
      expect(read.unreadable).toBe(false);
    });

    it("accepts a write that names the current version", async () => {
      const scope = `u-bump-${label}-${RUN}`;
      await service.saveLayout("user", scope, [placement()], 0);

      const second = await service.saveLayout(
        "user",
        scope,
        [placement({ id: "moved", width: "half" })],
        1
      );

      expect(second).toBe(2);
      const read = await service.getLayout("user", scope);
      expect(read.version).toBe(2);
      expect(read.layout?.placements[0].id).toBe("moved");
    });

    it("refuses a write that names a stale version", async () => {
      // 🔴 The `affectedRowCount` case. Reading the wrong driver field makes
      // this pass -- the write lands and the second tab's arrangement replaces
      // the first with nothing anywhere to say so.
      const scope = `u-stale-${label}-${RUN}`;
      await service.saveLayout("user", scope, [placement()], 0);
      await service.saveLayout("user", scope, [placement({ id: "x" })], 1);

      await expect(
        service.saveLayout("user", scope, [placement({ id: "y" })], 1)
      ).rejects.toSatisfy((e: unknown) => NextlyError.isConflict(e));

      // And the losing write left nothing behind.
      const read = await service.getLayout("user", scope);
      expect(read.version).toBe(2);
      expect(read.layout?.placements[0].id).toBe("x");
    });

    it("refuses an insert when a row already exists", async () => {
      const scope = `u-dup-${label}-${RUN}`;
      await service.saveLayout("user", scope, [placement({ id: "first" })], 0);

      await expect(
        service.saveLayout("user", scope, [placement({ id: "z" })], 0)
      ).rejects.toSatisfy((e: unknown) => NextlyError.isConflict(e));

      // `isConflict` alone would be satisfied by ANY error the insert can
      // raise, including a fault that has nothing to do with a lost race -- so
      // the row is read back too. It must be untouched: a conflict that half
      // wrote is worse than one that did not fire.
      const read = await service.getLayout("user", scope);
      expect(read.version).toBe(1);
      expect(read.layout?.placements[0].id).toBe("first");
    });

    it("stores a scope id far longer than the key column", async () => {
      // A user id is `varchar(191)` on MySQL and unbounded `text` on
      // PostgreSQL. Spelled into the key as `user:${scopeId}` it overruns the
      // 191-character primary key past 186 characters, so those accounts read
      // fine -- an absent row is a legal answer -- and fail on every save with
      // a database length error. The key is a digest instead, so the scope's
      // own length cannot reach the column at all.
      // 191, which is the widest a real user id can be: MySQL's `users.id` is
      // `varchar(191)` and so is this table's `scope_id` there. A longer
      // fixture is not a stronger test, it is a value no caller can produce —
      // and MySQL 8's strict mode rejects the insert, so the leg fails on the
      // fixture rather than on the property. 191 still proves the point the
      // test exists for: spelled into the key as `user:${scopeId}` it would be
      // 196 characters against a `varchar(191)` primary key.
      // Prefixed with this run's suffix and still 191 characters, so a rerun writes its own row.
      const long = `${RUN}${"u".repeat(191 - RUN.length)}`;
      await service.saveLayout("user", long, [placement({ id: "long" })], 0);
      expect(
        (await service.getLayout("user", long)).layout?.placements[0].id
      ).toBe("long");
    });

    it("keeps two scopes apart past any truncation point", async () => {
      // Two ids that differ only past a truncation point must stay two rows: a
      // key that truncated would merge them and hand one reader the other's
      // dashboard.
      // Prefixed with this run's suffix and still 180 characters before the differing tail.
      const stem = `${RUN}${"u".repeat(180 - RUN.length)}`;
      const a = `${stem}-aaa`;
      const b = `${stem}-bbb`;

      await service.saveLayout("user", a, [placement({ id: "for-a" })], 0);
      await service.saveLayout("user", b, [placement({ id: "for-b" })], 0);

      expect(
        (await service.getLayout("user", a)).layout?.placements[0].id
      ).toBe("for-a");
      expect(
        (await service.getLayout("user", b)).layout?.placements[0].id
      ).toBe("for-b");
    });

    it("reports an undecodable row rather than throwing", async () => {
      const scope = `u-broken-${label}-${RUN}`;
      await service.saveLayout("user", scope, [placement()], 0);
      // Corrupt the stored payload the way a downgrade or a bad hand-edit
      // would, without going through the service that would refuse it.
      // Addressed through the SAME derivation the service writes with. Spelled
      // out as `user:${scope}` it targeted a row that does not exist, the
      // corruption landed nowhere, and the assertion below failed -- which is
      // the good direction, but only because the test asserts the corrupt
      // OUTCOME rather than the write having happened.
      await corruptLayout(service, layoutRowId("user", scope));

      const read = await service.getLayout("user", scope);
      expect(read.unreadable).toBe(true);
      expect(read.layout).toBeUndefined();
      // The TRUE version, so the reader's next write can repair the row
      // instead of colliding with it.
      expect(read.version).toBe(1);
    });

    it("converts a columns-format row on read, keeping every card", async () => {
      // Written as an earlier release wrote it, with every field that format
      // stored, so the conversion is proven against a real row's encoding.
      const scope = `u-convert-${label}-${RUN}`;
      await service.saveLayout("user", scope, [placement()], 0);
      await writeRawLayout(
        service,
        layoutRowId("user", scope),
        JSON.stringify({
          schemaVersion: 2,
          columnCount: 3,
          placements: [
            {
              id: "c1r1",
              widgetId: "w/a",
              column: 1,
              order: 10,
              hidden: false,
              size: "sm",
            },
            {
              id: "c0r0",
              widgetId: "w/b",
              column: 0,
              order: 0,
              hidden: true,
              size: "xl",
              height: "tall",
              config: { range: 7 },
            },
            { id: "c1r0", widgetId: "w/c", column: 1, order: 0, hidden: false },
            {
              id: "c0r1",
              widgetId: "w/d",
              column: 0,
              order: 10,
              hidden: false,
              size: "future-size",
            },
          ],
        })
      );

      const read = await service.getLayout("user", scope);
      expect(read.unreadable).toBe(false);
      expect(read.layout?.placements).toEqual([
        {
          id: "c0r0",
          widgetId: "w/b",
          width: "twoThirds",
          removed: true,
          config: { range: 7 },
        },
        { id: "c1r0", widgetId: "w/c", width: "full", removed: false },
        { id: "c0r1", widgetId: "w/d", width: "full", removed: false },
        { id: "c1r1", widgetId: "w/a", width: "quarter", removed: false },
      ]);
    });

    it("leaves the row's text and version exactly as they were when it reads", async () => {
      // 🔴 A read never writes: a converted row is stored at its owner's next
      // save. A read that wrote would race the version guard and a second tab.
      const scope = `u-noread-write-${label}-${RUN}`;
      await service.saveLayout("user", scope, [placement()], 0);
      const raw = JSON.stringify({
        schemaVersion: 2,
        columnCount: 2,
        placements: [
          {
            id: "a",
            widgetId: "w/a",
            column: 1,
            order: 0,
            hidden: false,
            size: "lg",
          },
        ],
      });
      await writeRawLayout(service, layoutRowId("user", scope), raw);

      await service.getLayout("user", scope);
      await service.getLayout("user", scope);

      const row = await readRawLayout(service, layoutRowId("user", scope));
      expect(row).toEqual({ layout: raw, version: 1 });
    });

    it("removes the row on a reset staged against its version", async () => {
      const scope = `u-reset-${label}-${RUN}`;
      await service.saveLayout("user", scope, [placement()], 0);

      await service.deleteLayout("user", scope, 1);

      const read = await service.getLayout("user", scope);
      expect(read.layout).toBeUndefined();
      expect(read.version).toBe(0);
    });

    it("refuses a reset staged against an older version, keeping the newer row", async () => {
      // 🔴 A stale tab resetting after another tab saved: the delete names the
      // version it was staged against, and the database refuses it.
      const scope = `u-stale-reset-${label}-${RUN}`;
      await service.saveLayout("user", scope, [placement()], 0);
      await service.saveLayout("user", scope, [placement({ id: "newer" })], 1);

      await expect(service.deleteLayout("user", scope, 1)).rejects.toSatisfy(
        (e: unknown) => NextlyError.isConflict(e)
      );

      const read = await service.getLayout("user", scope);
      expect(read.version).toBe(2);
      expect(read.layout?.placements[0].id).toBe("newer");
    });

    it("refuses a reset by a caller who saw no row, once one exists", async () => {
      const scope = `u-reset-norow-${label}-${RUN}`;
      await service.saveLayout("user", scope, [placement({ id: "kept" })], 0);

      await expect(service.deleteLayout("user", scope, 0)).rejects.toSatisfy(
        (e: unknown) => NextlyError.isConflict(e)
      );
      expect(
        (await service.getLayout("user", scope)).layout?.placements[0].id
      ).toBe("kept");
    });

    it("answers a reset of a row that is already gone as done", async () => {
      // The state the caller asked for already holds.
      const scope = `u-reset-gone-${label}-${RUN}`;
      await expect(
        service.deleteLayout("user", scope, 0)
      ).resolves.toBeUndefined();
      await service.saveLayout("user", scope, [placement()], 0);
      await service.deleteLayout("user", scope, 1);
      await expect(
        service.deleteLayout("user", scope, 1)
      ).resolves.toBeUndefined();
    });
  });
}

/** The service's own database handle and table, for writing what it never would. */
function internalsOf(service: WidgetLayoutService) {
  return service as unknown as {
    db: {
      update: (t: unknown) => {
        set: (v: unknown) => { where: (w: unknown) => Promise<unknown> };
      };
      select: (fields: unknown) => {
        from: (t: unknown) => {
          where: (w: unknown) => Promise<Array<Record<string, unknown>>>;
        };
      };
      delete: (t: unknown) => { where: (w: unknown) => Promise<unknown> };
    };
    table: { id: unknown; scopeId: unknown; layout: unknown; version: unknown };
  };
}

/** Writes a raw payload, bypassing the service's own encoder. */
async function writeRawLayout(
  service: WidgetLayoutService,
  id: string,
  layout: string
): Promise<void> {
  const internals = internalsOf(service);
  const { eq } = await import("drizzle-orm");
  await internals.db
    .update(internals.table)
    .set({ layout })
    .where(eq(internals.table.id as never, id));
}

/** The row's stored text and version, exactly as the database holds them. */
async function readRawLayout(
  service: WidgetLayoutService,
  id: string
): Promise<{ layout: unknown; version: unknown }> {
  const internals = internalsOf(service);
  const { eq } = await import("drizzle-orm");
  const rows = await internals.db
    .select({
      layout: internals.table.layout,
      version: internals.table.version,
    })
    .from(internals.table)
    .where(eq(internals.table.id as never, id));
  return { layout: rows[0]?.layout, version: rows[0]?.version };
}

/**
 * Deletes every row this run wrote. Each scope id carries `RUN`, while row ids are hashes of it,
 * so the match is on `scope_id`; `RUN` is hex and hyphens, so it holds no `LIKE` wildcard.
 */
async function deleteRunRows(service: WidgetLayoutService): Promise<void> {
  const internals = internalsOf(service);
  const { like } = await import("drizzle-orm");
  await internals.db
    .delete(internals.table)
    .where(like(internals.table.scopeId as never, `%${RUN}%`));
}

/** Writes a payload the decoder must refuse, bypassing the service's own guard. */
async function corruptLayout(
  service: WidgetLayoutService,
  id: string
): Promise<void> {
  await writeRawLayout(service, id, "{not json");
}

// ---------------------------------------------------------------------------
// SQLite — always available; `createTestNextly` boots a fresh in-memory
// database with the full core schema pushed, so the table under test is
// created by the same path a real install uses.
// ---------------------------------------------------------------------------
let sqliteHandle: TestNextly | undefined;
layoutSuite("sqlite", async () => {
  sqliteHandle = await createTestNextly();
  return new WidgetLayoutService(sqliteHandle.adapter, silentLogger);
});
afterAll(async () => {
  await sqliteHandle?.destroy();
});

// ---------------------------------------------------------------------------
// PostgreSQL and MySQL — self-skipping without their URLs, run by CI's matrix.
// ---------------------------------------------------------------------------
const PG_URL = process.env.TEST_POSTGRES_URL ?? "";
const MY_URL = process.env.TEST_MYSQL_URL ?? "";

let pgHandle: TestNextly | undefined;
describe.skipIf(!PG_URL)("postgres", () => {
  layoutSuite("postgres", async () => {
    process.env.DB_DIALECT = "postgresql";
    process.env.DATABASE_URL = PG_URL;
    const adapter = await createAdapter({
      type: "postgresql",
      url: PG_URL,
    } as Parameters<typeof createAdapter>[0]);
    pgHandle = await createTestNextly({ adapter });
    return new WidgetLayoutService(pgHandle.adapter, silentLogger);
  });
  afterAll(async () => {
    await pgHandle?.destroy();
  });
});

let myHandle: TestNextly | undefined;
describe.skipIf(!MY_URL)("mysql", () => {
  layoutSuite("mysql", async () => {
    process.env.DB_DIALECT = "mysql";
    process.env.DATABASE_URL = MY_URL;
    const adapter = await createAdapter({
      type: "mysql",
      url: MY_URL,
    } as Parameters<typeof createAdapter>[0]);
    myHandle = await createTestNextly({ adapter });
    return new WidgetLayoutService(myHandle.adapter, silentLogger);
  });
  afterAll(async () => {
    await myHandle?.destroy();
  });
});
