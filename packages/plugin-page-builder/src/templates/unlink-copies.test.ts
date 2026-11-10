/**
 * Emptying a deleted template's copies' link, against stand-in services, so
 * each case is about which write each copy gets: a published copy's live row
 * written with its status, since a write naming none would land in a working
 * draft and leave the live row naming the deleted template; a copy never
 * published written without one; and a published copy with a draft waiting
 * written in the draft alone, so the delete publishes nobody's unfinished
 * edits. The walk reads in id order past the last copy it reached, so a page
 * of copies whose live rows keep the link does not hide the copies after it.
 * That the written row reads back as intended on a real instance is proved
 * by `__tests__/entry-designs.integration.test.ts`.
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import { unlinkCopies, type UnlinkServices } from "./unlink-copies";

const TX = { token: "the delete's transaction" };

/**
 * Services over `rows`, each copied from `t1`, with drafts waiting on
 * `waiting`, recording each write. A list honours its filter, its order by id
 * and its limit, as the store's does, and a write lands where the store's
 * would: on the live row when it names the published status or the copy was
 * never published, in the working draft alone otherwise, which leaves the
 * live row matching.
 */
function standIn(
  rows: readonly Record<string, unknown>[],
  waiting: readonly string[]
) {
  const live = new Map<string, Record<string, unknown>>(
    rows.map(row => [String(row.id), { ...row, forkedFrom: "t1" }])
  );
  const written: [string, Record<string, unknown>][] = [];
  const askedWaiting: unknown[] = [];
  let reads = 0;
  const services: UnlinkServices<typeof TX> = {
    listForUpdate: async (tx, options) => {
      if (tx !== TX) throw NextlyError.internal();
      // A walk that never ends fails here rather than hanging the run.
      reads += 1;
      if (reads > 20) throw new Error("the walk did not end");
      expect(options.sort).toEqual({ field: "id", direction: "asc" });
      const where = options.where as {
        forkedFrom: { equals: string };
        id?: { greater_than: string };
      };
      const after = where.id?.greater_than;
      return {
        data: [...live.values()]
          .filter(row => row.forkedFrom === where.forkedFrom.equals)
          .filter(row => after === undefined || String(row.id) > after)
          .sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1))
          .slice(0, options.pagination.limit),
      };
    },
    list: async (tx, options) => {
      if (tx !== TX) throw NextlyError.internal();
      askedWaiting.push(options.where);
      const ids = (options.where.id as { in: string[] }).in;
      return {
        data: ids.filter(id => waiting.includes(id)).map(id => ({ id })),
      };
    },
    update: async (tx, id, data) => {
      if (tx !== TX) throw NextlyError.internal();
      written.push([id, data]);
      const row = live.get(id);
      if (row && (data.status === "published" || row.status !== "published")) {
        row.forkedFrom = null;
      }
      return {};
    },
  };
  return { services, written, askedWaiting, live };
}

/** `count` copies named d000 onwards, in id order, of `status`. */
function copies(count: number, from: number, status: string) {
  return Array.from({ length: count }, (_, at) => ({
    id: `d${String(from + at).padStart(3, "0")}`,
    status,
  }));
}

describe("a deleted template's copies", () => {
  it("lose the link on their live row when published, and on their row when never published", async () => {
    const { services, written } = standIn(
      [
        { id: "d1", status: "published" },
        { id: "d2", status: "draft" },
      ],
      []
    );

    await unlinkCopies(services, TX, "t1");

    expect(written).toEqual([
      ["d1", { forkedFrom: null, status: "published", _overwrite: true }],
      ["d2", { forkedFrom: null, _overwrite: true }],
    ]);
  });

  it("lose it in the waiting draft alone where a published copy has one, publishing nothing", async () => {
    const { services, written, askedWaiting } = standIn(
      [
        { id: "d1", status: "published" },
        { id: "d3", status: "published" },
        { id: "d2", status: "draft" },
      ],
      ["d3"]
    );

    await unlinkCopies(services, TX, "t1");

    expect(written).toEqual([
      ["d1", { forkedFrom: null, status: "published", _overwrite: true }],
      ["d2", { forkedFrom: null, _overwrite: true }],
      ["d3", { forkedFrom: null, _overwrite: true }],
    ]);
    // Asked of the published copies only, in one read.
    expect(askedWaiting).toEqual([
      { id: { in: ["d1", "d3"] }, _pendingChange: true },
    ]);
  });

  it("asks nothing of drafts when no copy is published, and ends after a full last page", async () => {
    const { services, written, askedWaiting, live } = standIn(
      copies(100, 0, "draft"),
      []
    );

    await unlinkCopies(services, TX, "t1");

    expect(written).toHaveLength(100);
    expect(askedWaiting).toEqual([]);
    expect([...live.values()].every(row => row.forkedFrom === null)).toBe(true);
  });

  it("reaches the copies after a full page whose live rows keep the link", async () => {
    // The first page is all published copies with a draft waiting: each is
    // written in its draft alone, so its live row still names the template
    // and matches every later read. Reading the first page again would find
    // only them, and the 150 after would keep naming a deleted template.
    const kept = copies(100, 0, "published");
    const rest = copies(150, 100, "draft");
    const { services, written, live } = standIn(
      [...rest, ...kept],
      kept.map(copy => copy.id)
    );

    await unlinkCopies(services, TX, "t1");

    // Every copy written once, in id order.
    expect(written.map(([id]) => id)).toEqual(
      [...kept, ...rest].map(copy => copy.id)
    );
    for (const copy of rest) {
      expect(live.get(copy.id)?.forkedFrom).toBeNull();
    }
    // Their live rows keep the link until their drafts are published.
    for (const copy of kept) {
      expect(live.get(copy.id)?.forkedFrom).toBe("t1");
    }
  });
});
