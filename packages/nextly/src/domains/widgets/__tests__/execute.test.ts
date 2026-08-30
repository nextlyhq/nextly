import { beforeEach, describe, expect, it, vi } from "vitest";

const find = vi.fn();
const count = vi.fn();

vi.mock("../../../direct-api/nextly", () => ({
  getNextly: () => ({ find, count }),
}));

import { NextlyError } from "../../../errors/nextly-error";
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
  it("cannot be reached with an empty selection, which would read every field", async () => {
    // The composition is the claim. `toSelect` turns `[]` into `undefined` and
    // the Direct API applies a selection only when it has keys, so an empty
    // `select` reaching `find` is a FULL-document read -- the widest answer to
    // the narrowest request. Asserted through `validateWidgetQuery` rather than
    // by handing `executeWidgetQuery` a literal, because the gate is what has
    // to hold: nothing composed this way can produce that read.
    expect(() =>
      validateWidgetQuery({
        source: "collection:posts",
        op: "list",
        select: [],
      })
    ).toThrow(/select is empty/);
    expect(find).not.toHaveBeenCalled();
  });

  it("passes a non-empty selection through as one the read path honours", async () => {
    // The control for the case above, at the seam: a selection with keys is
    // what `Object.keys(select).length > 0` requires downstream, so this is the
    // shape that actually narrows the read.
    const q = validateWidgetQuery({
      source: "collection:posts",
      op: "list",
      select: ["title"],
    });
    await executeWidgetQuery(q, caller);
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({ select: { title: true } })
    );
  });

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
      })
    );
    expect(result).toEqual({ op: "count", total: 7 });
  });

  it("never exempts the caller's where from the read-rule guard", async () => {
    // `frameworkFilter` short-circuits `assertFilterableFields` and
    // `assertSortableField`. A widget query arrives verbatim from the request
    // body, so setting it would hand any authenticated caller a field-value
    // oracle over every read-ruled column. Asserted on ABSENCE, at the seam
    // where it would be added, because `execute-access.integration.test.ts`
    // proves the consequence and this names the cause.
    const q = validateWidgetQuery({
      source: "collection:posts",
      op: "count",
      where: { status: { equals: "draft" } },
    });
    await executeWidgetQuery(q, caller);

    const args = count.mock.calls[0][0] as Record<string, unknown>;
    expect(args).not.toHaveProperty("frameworkFilter");
  });

  it("never exempts the caller's sort either", async () => {
    const q = validateWidgetQuery({
      source: "collection:posts",
      op: "list",
      sort: "-title",
    });
    await executeWidgetQuery(q, caller);

    const args = find.mock.calls[0][0] as Record<string, unknown>;
    expect(args).not.toHaveProperty("frameworkFilter");
    expect(args.sort).toBe("-title");
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

    // The public message is shared with every other source/op refusal on
    // purpose -- naming the source would confirm to a caller which sources
    // exist. The id survives in `logContext`, which is what this asserts, so
    // an executor that refused everything indiscriminately would not pass.
    let thrown: unknown;
    try {
      await executeWidgetQuery(q, caller);
    } catch (e) {
      thrown = e;
    }
    expect(NextlyError.is(thrown)).toBe(true);
    const err = thrown as NextlyError;
    expect(err.publicMessage).toBe(
      "Invalid widget query: unavailable source or unsupported op"
    );
    expect(err.logContext?.widgetQuery).toMatch(/collection:posts/);
  });
});
