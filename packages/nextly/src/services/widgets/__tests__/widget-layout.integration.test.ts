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
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAdapter } from "../../../database/factory";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { WidgetPlacement } from "../../../domains/widgets/layout";
import { NextlyError } from "../../../errors/nextly-error";
import { layoutRowId } from "../../../schemas/widget-layout";
import { WidgetLayoutService } from "../widget-layout-service";

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
    order: 0,
    hidden: false,
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

    it("round-trips an arrangement", async () => {
      const scope = `u-roundtrip-${label}`;
      const placements = [
        placement({ id: "a", order: 0, size: "md" }),
        placement({ id: "b", widgetId: "core/other", order: 10, hidden: true }),
      ];

      const version = await service.saveLayout("user", scope, placements, 0);
      expect(version).toBe(1);

      const read = await service.getLayout("user", scope);
      expect(read.unreadable).toBe(false);
      expect(read.version).toBe(1);
      expect(read.layout?.placements).toEqual(placements);
    });

    it("reports no row before anything is written", async () => {
      const read = await service.getLayout("user", `u-absent-${label}`);
      expect(read.layout).toBeUndefined();
      expect(read.version).toBe(0);
      expect(read.unreadable).toBe(false);
    });

    it("accepts a write that names the current version", async () => {
      const scope = `u-bump-${label}`;
      await service.saveLayout("user", scope, [placement()], 0);

      const second = await service.saveLayout(
        "user",
        scope,
        [placement({ id: "moved", order: 5 })],
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
      const scope = `u-stale-${label}`;
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
      const scope = `u-dup-${label}`;
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
      const long = "u".repeat(400);
      await service.saveLayout("user", long, [placement({ id: "long" })], 0);
      expect(
        (await service.getLayout("user", long)).layout?.placements[0].id
      ).toBe("long");
    });

    it("keeps two scopes apart past any truncation point", async () => {
      // Two ids that differ only past a truncation point must stay two rows: a
      // key that truncated would merge them and hand one reader the other's
      // dashboard.
      const stem = "u".repeat(180);
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
      const scope = `u-broken-${label}`;
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
  });
}

/** Writes a payload the decoder must refuse, bypassing the service's own guard. */
async function corruptLayout(
  service: WidgetLayoutService,
  id: string
): Promise<void> {
  const internals = service as unknown as {
    db: {
      update: (t: unknown) => {
        set: (v: unknown) => { where: (w: unknown) => Promise<unknown> };
      };
    };
    table: { id: unknown };
  };
  const { eq } = await import("drizzle-orm");
  await internals.db
    .update(internals.table)
    .set({ layout: "{not json" })
    .where(eq(internals.table.id as never, id));
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
