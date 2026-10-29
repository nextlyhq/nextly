/**
 * What a writer stores for a retired `manage-` permission is read, inside its
 * transaction, as locking reads: the rows are locked for the rest of it and
 * read as they are committed now, not as the transaction's snapshot saw them,
 * so a row edited into another permission since is not taken for what it was.
 * MySQL's repeatable-read snapshot would otherwise keep showing the old row.
 */
import { describe, expect, it } from "vitest";

import {
  plainFourOnLocked,
  storedAsPlain,
  storedAsPlainLocked,
} from "../retired-manage-permissions";

type Row = { id: string; action: string; resource: string };
type Query = {
  forUpdate?: boolean;
  where: { and: Array<{ column: string; value: unknown }> };
};

const FOUR: Row[] = ["read", "create", "update", "delete"].map(action => ({
  id: `${action}-media-id`,
  action,
  resource: "media",
}));
const MANAGE: Row = {
  id: "manage-media-id",
  action: "manage",
  resource: "media",
};

/** A transaction that answers from `FOUR` and `MANAGE`, keeping each query. */
function recording() {
  const queries: Query[] = [];
  const tx = {
    select: (_table: string, query: Query): Promise<never[]> => {
      queries.push(query);
      const byId = query.where.and.find(c => c.column === "id");
      // Ids matched without regard to case, as MySQL matches them.
      const asked = ((byId?.value ?? []) as string[]).map(id =>
        id.toLowerCase()
      );
      const rows = byId
        ? [MANAGE, ...FOUR].filter(row => asked.includes(row.id))
        : FOUR;
      return Promise.resolve(rows as never[]);
    },
  };
  return {
    queries,
    tx: tx as unknown as Parameters<typeof plainFourOnLocked>[0],
  };
}

describe("the writers' reads of a retired manage permission", () => {
  it("takes the plain four by a locking read", async () => {
    const { queries, tx } = recording();
    expect(await plainFourOnLocked(tx, "media")).toEqual(
      FOUR.map(row => row.id)
    );
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.every(query => query.forUpdate === true)).toBe(true);
  });

  it("reads what a role is stored as by locking reads, every one", async () => {
    const { queries, tx } = recording();
    expect(
      [...(await storedAsPlainLocked(tx, [MANAGE.id], 999))].sort()
    ).toEqual(FOUR.map(row => row.id).sort());
    expect(queries.length).toBe(2);
    expect(queries.every(query => query.forUpdate === true)).toBe(true);
  });

  it("replaces a retired permission asked for in another case than its row spells it", async () => {
    const { tx } = recording();
    const stored = await storedAsPlain(tx, [MANAGE.id.toUpperCase()], 999);
    expect(stored.sort()).toEqual(FOUR.map(row => row.id).sort());
  });
});
