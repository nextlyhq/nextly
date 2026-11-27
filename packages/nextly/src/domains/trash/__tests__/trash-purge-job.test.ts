/**
 * The trash's clean-up job removes what is past its purge date as of the
 * job's clock, and nothing else: a unit test with a fixed clock and a
 * database that keeps its rows in memory, so the date the job removes by is
 * the one decided, not an inference from timing.
 *
 * @module domains/trash/__tests__/trash-purge-job.test
 */
import { describe, expect, it } from "vitest";

import { TRASH_TABLE } from "../../../schemas/trash";
import { createTrashPurgeJob } from "../trash-purge-job";

const DAY_MS = 24 * 60 * 60 * 1000;
const TRASHED = new Date("2026-11-01T12:00:00.000Z");

interface Row {
  id: string;
  kind: string;
  scopeSlug: string;
  itemId: string;
  purgeAt: Date;
  trashedAt: Date;
}

type Where = { and: { column: string; op: string; value?: unknown }[] };

/** Whether `row` meets every condition the job asks with. */
function matches(row: Row, where: Where | undefined): boolean {
  return (where?.and ?? []).every(condition => {
    const value = (row as unknown as Record<string, unknown>)[condition.column];
    if (condition.op === "<=")
      return (value as Date) <= (condition.value as Date);
    if (condition.op === "=") return value === condition.value;
    throw new Error(`the fake does not answer ${condition.op}`);
  });
}

/** A database holding trash rows in memory, answering the job's reads. */
function memoryDb(rows: Row[]) {
  return {
    rows,
    tableExists: async (table: string) => table === TRASH_TABLE,
    select: async (
      _table: string,
      options: { where?: Where; limit?: number }
    ) =>
      rows.filter(row => matches(row, options.where)).slice(0, options.limit),
    transaction: async <T>(
      work: (tx: {
        delete: (t: string, w: Where) => Promise<number>;
      }) => Promise<T>
    ) =>
      work({
        delete: async (_table: string, where: Where) => {
          const before = rows.length;
          for (let i = rows.length - 1; i >= 0; i -= 1) {
            if (matches(rows[i], where)) rows.splice(i, 1);
          }
          return before - rows.length;
        },
      }),
  };
}

function row(id: string, trashedAt: Date): Row {
  return {
    id,
    kind: "entry",
    scopeSlug: "posts",
    itemId: `entry-${id}`,
    trashedAt,
    purgeAt: new Date(trashedAt.getTime() + 30 * DAY_MS),
  };
}

async function runAt(db: ReturnType<typeof memoryDb>, now: Date) {
  const job = createTrashPurgeJob({
    adapter: () => db as never,
    now: () => now,
  });
  await job.handler({} as never, {} as never);
}

describe("the trash's clean-up job", () => {
  it("removes an item 30 days after it was trashed, and not a moment before", async () => {
    const db = memoryDb([row("a", TRASHED)]);

    await runAt(db, new Date(TRASHED.getTime() + 30 * DAY_MS - 1));
    expect(db.rows.map(r => r.id)).toEqual(["a"]);

    await runAt(db, new Date(TRASHED.getTime() + 30 * DAY_MS));
    expect(db.rows).toEqual([]);
  });

  it("removes only the items past their date", async () => {
    const db = memoryDb([
      row("old", new Date(TRASHED.getTime() - 40 * DAY_MS)),
      row("new", TRASHED),
    ]);

    await runAt(db, new Date(TRASHED.getTime() + DAY_MS));

    expect(db.rows.map(r => r.id)).toEqual(["new"]);
  });
});
