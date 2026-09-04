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
    // saved together tie — and a database may order tied rows differently
    // between two queries. Paging an unstable order loses a document silently:
    // the caller de-duplicates the row it saw twice and never learns of the one
    // it did not see.
    const { db, selects } = stubDb();

    await new VersionsRepository(db).findPendingEditRows({
      slugs: ["posts"],
      limit: 10,
      offset: 20,
    });

    expect(selects).toHaveLength(1);
    expect(selects[0]?.orderBy).toEqual([
      { column: "updatedAt", direction: "desc", nulls: "last" },
      { column: "id", direction: "desc" },
    ]);
  });

  it("passes the caller's window through untouched", async () => {
    // The control: an ordering assertion says nothing if the window it orders
    // is not the one the caller asked for.
    const { db, selects } = stubDb();

    await new VersionsRepository(db).findPendingEditRows({
      slugs: ["posts"],
      limit: 10,
      offset: 20,
    });

    expect(selects[0]?.limit).toBe(10);
    expect(selects[0]?.offset).toBe(20);
  });
});
