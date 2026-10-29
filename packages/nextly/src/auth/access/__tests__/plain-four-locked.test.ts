/**
 * The plain four a retired `manage-` permission is added or taken off as are
 * read again once their rows are locked, inside the writer's transaction: a
 * row edited into another permission between the read and the lock is not
 * taken for what it was.
 */
import { describe, expect, it } from "vitest";

import { plainFourOnLocked } from "../manage-bridge";

type Row = { id: string; action: string; resource: string };

const FOUR: Row[] = ["read", "create", "update", "delete"].map(action => ({
  id: `${action}-media-id`,
  action,
  resource: "media",
}));

describe("plainFourOnLocked", () => {
  it("locks the rows it chose and reads them again, so one edited before the lock is not taken", async () => {
    const locked: string[] = [];
    let reads = 0;
    const tx = {
      select: (): Promise<never[]> => {
        reads++;
        // The first read finds all four; by the time they are locked,
        // another writer has made `read-media` a publish permission.
        const rows = reads === 1 ? FOUR : FOUR.slice(1);
        return Promise.resolve(rows as never[]);
      },
      lockRow: (_table: string, id: string): Promise<void> => {
        locked.push(id);
        return Promise.resolve();
      },
    };

    const four = await plainFourOnLocked(
      tx as unknown as Parameters<typeof plainFourOnLocked>[0],
      "media"
    );

    expect(locked.sort()).toEqual(FOUR.map(row => row.id).sort());
    expect(four).toEqual([]);
  });
});
