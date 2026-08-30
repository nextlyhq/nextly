import { beforeEach, describe, expect, it, vi } from "vitest";

const find = vi.fn();
const count = vi.fn();

vi.mock("../../../direct-api/nextly", () => ({
  getNextly: () => ({ find, count }),
}));

import { executeWidgetQuery } from "../execute";
import { validateWidgetQuery } from "../query";
import { clearSources, registerSource } from "../sources";

const caller = {
  user: { id: "user-1", roles: ["editor"] },
};

beforeEach(() => {
  vi.clearAllMocks();
  find.mockResolvedValue({ items: [{ id: "1", title: "Hello" }] });
  count.mockResolvedValue({ total: 7 });
  clearSources();
  registerSource({
    id: "collection:posts",
    label: "Posts",
    kind: "collection",
    supports: ["count", "list"],
    fields: [
      { name: "title", type: "string" },
      { name: "status", type: "string" },
    ],
  });
});

describe("executeWidgetQuery", () => {
  it("counts through the access-controlled path", async () => {
    const q = validateWidgetQuery({
      source: "collection:posts",
      op: "count",
      where: { status: { equals: "draft" } },
    });

    const result = await executeWidgetQuery(q, caller);

    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: "posts",
        where: { status: { equals: "draft" } },
        overrideAccess: false,
        user: { id: "user-1", roles: ["editor"] },
        frameworkFilter: true,
      })
    );
    expect(result).toEqual({ op: "count", total: 7 });
  });

  it("lists through the access-controlled path", async () => {
    const q = validateWidgetQuery({
      source: "collection:posts",
      op: "list",
      select: ["title"],
      limit: 3,
    });

    const result = await executeWidgetQuery(q, caller);

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: "posts",
        limit: 3,
        select: { title: true },
        overrideAccess: false,
        user: { id: "user-1", roles: ["editor"] },
      })
    );
    expect(result).toEqual({
      op: "list",
      items: [{ id: "1", title: "Hello" }],
    });
  });

  it("NEVER issues a trusted read", async () => {
    // This is the assertion that matters. A read that omitted `user` or set
    // overrideAccess true would return rows the viewer may not see -- the bug
    // Strapi shipped in its homepage widgets and patched as a security fix.
    const q = validateWidgetQuery({ source: "collection:posts", op: "list" });
    await executeWidgetQuery(q, caller);

    const args = find.mock.calls[0][0] as Record<string, unknown>;
    expect(args.overrideAccess).toBe(false);
    expect(args.user).toEqual({ id: "user-1", roles: ["editor"] });
  });

  it("refuses to execute a query whose source vanished", async () => {
    const q = validateWidgetQuery({ source: "collection:posts", op: "count" });
    clearSources();
    await expect(executeWidgetQuery(q, caller)).rejects.toThrow(
      /collection:posts/
    );
  });
});
