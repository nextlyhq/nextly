/**
 * What the publisher of a first header is told, and that nobody else is:
 * the route answers only the caller's own fills, each named by its title.
 */
import { describe, expect, it, vi } from "vitest";

import { takeFillNotices } from "./fill-notice-route";

const ctx = (user: { id: string } | null) =>
  ({
    user,
    self: { collections: { layouts: "site_layouts" }, singles: {} },
  }) as never;

describe("the fills told to their publisher", () => {
  it("names each fill the caller is owed by its component's title, with where the sets are", async () => {
    const take = vi.fn(async () => [
      { area: "header" as const, component: "c1" },
    ]);
    const find = vi.fn(async () => ({
      items: [{ id: "c1", title: "Acme header" }],
    }));
    expect(
      await takeFillNotices(ctx({ id: "u1" }), { take }, { find } as never)
    ).toEqual({
      fills: [
        { area: "header", component: { id: "c1", title: "Acme header" } },
      ],
      setsAddress: "/admin/collections/site_layouts",
    });
    expect(take).toHaveBeenCalledWith("u1");
  });

  it("takes nothing for a caller with no user, and reads nothing when nothing is owed", async () => {
    const take = vi.fn(async () => []);
    const find = vi.fn();
    expect(
      (await takeFillNotices(ctx(null), { take }, { find } as never)).fills
    ).toEqual([]);
    expect(take).not.toHaveBeenCalled();
    await takeFillNotices(ctx({ id: "u1" }), { take }, { find } as never);
    expect(find).not.toHaveBeenCalled();
  });
});
