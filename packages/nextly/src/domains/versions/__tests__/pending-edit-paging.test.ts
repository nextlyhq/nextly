/**
 * The ordering a paged pending-edit read emits.
 *
 * 🔴 Asserted on the emitted ORDER rather than on rows returned, deliberately.
 * The failure is that OFFSET paging over a non-total order may return one row
 * twice and skip another — but whether a database actually does that depends on
 * the engine and the plan it chooses, and it could not be reproduced on SQLite,
 * which orders these tied rows stably. A behavioural test therefore passes with
 * and without the tiebreaker, which is worse than no test: it reads as coverage
 * for a property it never exercised. The cause is what is checkable here, so the
 * cause is what this pins.
 */
import { describe, expect, it, vi } from "vitest";

import type { VersionsDbApi, VersionsSelectOptions } from "../db-api";
import { VersionsRepository } from "../versions-repository";

function stubDb() {
  const selects: VersionsSelectOptions[] = [];
  const db = {
    insert: vi.fn(),
    select: vi.fn(async (_t: string, options: VersionsSelectOptions) => {
      selects.push(options);
      return [] as never;
    }),
    update: vi.fn(),
    delete: vi.fn(),
  } as unknown as VersionsDbApi;
  return { db, selects };
}

describe("paged pending-edit reads", () => {
  it("orders by a UNIQUE key as well as the instant", async () => {
    // `updatedAt` alone is not total — SQLite stores whole seconds, so drafts
    // saved together tie — and a cursor over a non-unique key cannot say WHICH
    // of the tied rows a page ended on.
    const { db, selects } = stubDb();

    await new VersionsRepository(db).findPendingEditRows({
      slugs: ["posts"],
      limit: 10,
    });

    expect(selects).toHaveLength(1);
    expect(selects[0]?.orderBy).toEqual([
      { column: "updatedAt", direction: "desc", nulls: "last" },
      { column: "id", direction: "desc" },
    ]);
  });

  it("pages by CURSOR, never by offset", async () => {
    // 🔴 These rows are the most mutable in the system: a working draft's
    // `updatedAt` advances every time somebody types. Under OFFSET a row
    // updated between two pages moves ahead of the offset, so the next page
    // repeats a row already read and SKIPS one that never was — and the skipped
    // document is lost, because de-duplicating what arrived cannot reveal what
    // did not. Anchoring to the last row read keeps the pages disjoint whatever
    // moves behind them.
    const { db, selects } = stubDb();
    const cursor = { updatedAt: new Date("2026-01-01T00:00:00Z"), id: "v-9" };

    await new VersionsRepository(db).findPendingEditRows({
      slugs: ["posts"],
      limit: 10,
      after: cursor,
    });

    expect(selects[0]?.offset).toBeUndefined();
    // Two branches, not a row constructor: `(a, b) < (x, y)` is not portable
    // across the three dialects this has to run on.
    expect(JSON.stringify(selects[0]?.where)).toContain('"or"');
    expect(JSON.stringify(selects[0]?.where)).toContain('"v-9"');
  });

  it("asks WITHOUT a cursor clause for the first page", async () => {
    // The control: a cursor assertion means nothing if the same clause is
    // emitted when no cursor was given, which would drop the first page's rows.
    const { db, selects } = stubDb();

    await new VersionsRepository(db).findPendingEditRows({
      slugs: ["posts"],
      limit: 10,
    });

    expect(JSON.stringify(selects[0]?.where)).not.toContain('"or"');
  });

  it("passes the caller's page size through untouched", async () => {
    const { db, selects } = stubDb();

    await new VersionsRepository(db).findPendingEditRows({
      slugs: ["posts"],
      limit: 10,
    });

    expect(selects[0]?.limit).toBe(10);
  });
});
