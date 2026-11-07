/**
 * Emptying a deleted template's copies' link, against stand-in services, so
 * each case is about which write each copy gets: a published copy's live row
 * written with its status, since a write naming none would land in a working
 * draft and leave the live row naming the deleted template; a copy never
 * published written without one; and a published copy with a draft waiting
 * written in the draft alone, so the delete publishes nobody's unfinished
 * edits. That the written row reads back as intended on a real instance is
 * proved by `__tests__/entry-designs.integration.test.ts`.
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import { unlinkCopies, type UnlinkServices } from "./unlink-copies";

const TX = { token: "the delete's transaction" };

/** Services over `rows`, with drafts waiting on `waiting`, recording each write. */
function standIn(
  rows: readonly Record<string, unknown>[],
  waiting: readonly string[]
) {
  const written: [string, Record<string, unknown>][] = [];
  const askedWaiting: unknown[] = [];
  const services: UnlinkServices<typeof TX> = {
    listForUpdate: async (tx, options) => {
      if (tx !== TX) throw NextlyError.internal();
      return { data: rows.slice(0, options.pagination.limit) };
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
      return {};
    },
  };
  return { services, written, askedWaiting };
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
      ["d3", { forkedFrom: null, _overwrite: true }],
      ["d2", { forkedFrom: null, _overwrite: true }],
    ]);
    // Asked of the published copies only, in one read.
    expect(askedWaiting).toEqual([
      { id: { in: ["d1", "d3"] }, _pendingChange: true },
    ]);
  });

  it("asks nothing of drafts when no copy is published, and stops on a page it has already written", async () => {
    // A full page that reads back the same, as a copy keeping its live link
    // would: written once, then the walk ends.
    const rows = Array.from({ length: 100 }, (_, at) => ({
      id: `d${String(at)}`,
      status: "draft",
    }));
    const { services, written, askedWaiting } = standIn(rows, []);

    await unlinkCopies(services, TX, "t1");

    expect(written).toHaveLength(100);
    expect(askedWaiting).toEqual([]);
  });
});
