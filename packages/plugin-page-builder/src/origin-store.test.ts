/**
 * Where a duplicate came from: one row per copy, written once, read back.
 */
import { describe, expect, it, vi } from "vitest";

import {
  DUPLICATED_FROM,
  originStore,
  type OriginDirectApi,
} from "./origin-store";

function directApi() {
  const rows: Record<string, unknown>[] = [];
  const nextly = {
    find: vi.fn((args: { where: { componentId: { equals: string } } }) =>
      Promise.resolve({
        items: rows.filter(
          row =>
            row.componentId === args.where.componentId.equals &&
            row.kind === DUPLICATED_FROM
        ),
        meta: { hasNext: false },
      })
    ),
    create: vi.fn((args: { data: Record<string, unknown> }) => {
      rows.push(args.data);
      return Promise.resolve({ item: args.data });
    }),
  } as unknown as OriginDirectApi;
  return { nextly, rows };
}

describe("a duplicate's origin", () => {
  it("is recorded in the bookkeeping table and read back", async () => {
    const { nextly, rows } = directApi();
    const store = originStore({
      nextly: () => Promise.resolve(nextly),
      collection: "nx_pb_component_retired",
    });

    await store.record("copy-1", "card");

    expect(rows).toEqual([
      expect.objectContaining({
        componentId: "copy-1",
        kind: DUPLICATED_FROM,
        exposureId: "card",
      }),
    ]);
    expect(await store.sourceOf("copy-1")).toBe("card");
    expect(await store.sourceOf("card")).toBeNull();
  });

  it("adds no second row when recorded again", async () => {
    const { nextly, rows } = directApi();
    const store = originStore({
      nextly: () => Promise.resolve(nextly),
      collection: "nx_pb_component_retired",
    });

    await store.record("copy-1", "card");
    await store.record("copy-1", "card");

    expect(rows).toHaveLength(1);
  });
});
