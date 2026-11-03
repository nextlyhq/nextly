/**
 * A field declared hidden never reaches a public read, and a list may not
 * filter or sort by one. The registry's answer is stood in for here; the
 * stripping and the refusals are the reader's own.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const hidden = vi.hoisted(() => ({ paths: new Set<string>() }));
vi.mock("../declared-fields", async importOriginal => ({
  ...(await importOriginal<typeof import("../declared-fields")>()),
  hiddenFieldPaths: vi.fn(async () => hidden.paths),
}));

import { createPublicReader, type PublicReaderSource } from "../public-reader";

function readerOver(rows: Record<string, unknown>[]) {
  const find = vi.fn(async () => ({
    items: rows,
    meta: { total: rows.length },
  }));
  const findSingle = vi.fn(async () => rows[0] ?? null);
  return {
    find,
    findSingle,
    reader: createPublicReader({
      find,
      findSingle,
    } as unknown as PublicReaderSource),
  };
}

const row = () => ({
  id: "1",
  title: "Hello",
  adminOnly: "staff",
  seo: { summary: "Short", adminKey: "k" },
  rows: [
    { label: "a", token: "t1" },
    { label: "b", token: "t2" },
  ],
});

beforeEach(() => {
  hidden.paths = new Set(["adminOnly", "seo.adminKey", "rows.token"]);
});

describe("hidden fields in public reads", () => {
  it("leaves every hidden field out of a list's rows, nested ones and each row's too", async () => {
    const { reader } = readerOver([row()]);
    const { items } = await reader.find({ collection: "posts" });
    expect(items).toEqual([
      {
        id: "1",
        title: "Hello",
        seo: { summary: "Short" },
        rows: [{ label: "a" }, { label: "b" }],
      },
    ]);
  });

  it("leaves a hidden field out of a Single, even when it is selected", async () => {
    const { reader } = readerOver([row()]);
    await expect(
      reader.findSingle({ slug: "banner", select: ["title", "adminOnly"] })
    ).resolves.toEqual({ id: "1", title: "Hello" });
    const whole = await reader.findSingle({ slug: "banner" });
    expect(whole).not.toHaveProperty("adminOnly");
    expect(whole?.seo).toEqual({ summary: "Short" });
  });

  it.each([
    [{ filters: [{ field: "adminOnly", op: "equals" as const, value: "x" }] }],
    [{ sort: ["title", "-adminOnly"] }],
    [{ sort: "adminOnly" }],
  ])(
    "refuses a list that filters or sorts by a hidden field, returning nothing it read (%j)",
    async asked => {
      const { reader, find } = readerOver([row()]);
      await expect(
        reader.find({ collection: "posts", ...asked })
      ).rejects.toThrow(/"adminOnly"/);
      // Read, since the schema is known only once the instance is booted,
      // and refused before any row is returned.
      expect(find).toHaveBeenCalledTimes(1);
    }
  );

  it("refuses a count filtered by a hidden field, returning nothing it read", async () => {
    const { reader, find } = readerOver([row()]);
    await expect(
      reader.count({
        collection: "posts",
        filters: [{ field: "adminOnly", op: "exists", value: true }],
      })
    ).rejects.toThrow(/"adminOnly"/);
    expect(find).toHaveBeenCalledTimes(1);
  });

  it("keeps a row whole when the source hides nothing", async () => {
    hidden.paths = new Set();
    const { reader } = readerOver([row()]);
    const { items } = await reader.find({
      collection: "posts",
      sort: ["adminOnly"],
    });
    expect(items).toEqual([row()]);
  });
});
