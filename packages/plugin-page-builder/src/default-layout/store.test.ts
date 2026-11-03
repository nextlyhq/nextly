/**
 * The store's Layout lookups ask only for ids.
 *
 * Each answers "which of these exist" or "which are published", and only the
 * id is read from the rows. A read that fetched whole rows would pass every
 * behavioural test while loading each Layout's areas, so the request itself is
 * what is asserted: a recording fake keeps every `find` it is asked.
 */
import { describe, expect, it } from "vitest";

import {
  layoutExists,
  publishedLayoutIds,
  type DefaultLayoutDirectApi,
} from "./store";

const SLUGS = { layouts: "layouts", settings: "page-builder-settings" };

/** A Direct API that answers every `find` with `rows` and records the asks. */
function recording(rows: { id: string }[]) {
  const asked: Record<string, unknown>[] = [];
  const nextly = {
    find: async (args: Record<string, unknown>) => {
      asked.push(args);
      return { items: rows, meta: { hasNext: false } };
    },
  } as unknown as Pick<DefaultLayoutDirectApi, "find">;
  return { nextly, asked };
}

describe("the store's Layout lookups", () => {
  it("asks only for ids when answering which Layouts are published", async () => {
    const { nextly, asked } = recording([{ id: "a" }]);

    const published = await publishedLayoutIds(nextly, SLUGS, ["a", "b"]);

    expect([...published]).toEqual(["a"]);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      status: "published",
      select: { id: true },
    });
  });

  it("asks only for ids when answering whether a Layout exists", async () => {
    const { nextly, asked } = recording([{ id: "a" }]);

    expect(await layoutExists(nextly, SLUGS, "a")).toBe(true);

    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ status: "all", select: { id: true } });
  });
});
