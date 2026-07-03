import { describe, it, expect, vi, beforeEach } from "vitest";

import type { BlockDocument } from "../../core/types";
import { makeNode } from "../../core/tree";
import { savePage, deletePage } from "./adminFetch";

const doc: BlockDocument = {
  version: 1,
  root: makeNode("core/container", {}, undefined, { default: [] }),
};

function mockFetch(response: unknown, ok = true) {
  const fn = vi.fn(
    async () => ({ ok, json: async () => response }) as unknown as Response
  );
  (globalThis as unknown as { fetch: typeof fetch }).fetch =
    fn as unknown as typeof fetch;
  return fn;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("savePage", () => {
  it("POSTs to the admin entries endpoint when creating (no id) and returns the item", async () => {
    const fn = mockFetch({ message: "created", item: { id: "1", title: "T" } });
    const result = await savePage({
      title: "T",
      slug: "t",
      content: doc,
      customCss: "",
      status: "draft",
    });
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/admin/api/collections/pages/entries");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    const body = JSON.parse(init.body as string);
    expect(body.title).toBe("T");
    expect(body.status).toBe("draft");
    expect(result).toEqual({ id: "1", title: "T" });
  });

  it("PATCHes the by-id endpoint when updating", async () => {
    const fn = mockFetch({ message: "updated", item: { id: "5" } });
    await savePage({
      id: "5",
      title: "T",
      slug: "t",
      content: doc,
      customCss: ".a{}",
      status: "published",
    });
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/admin/api/collections/pages/entries/5");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string).status).toBe("published");
  });

  it("throws the server error message on a non-ok response", async () => {
    mockFetch({ error: "slug must be unique" }, false);
    await expect(
      savePage({
        title: "T",
        slug: "t",
        content: doc,
        customCss: "",
        status: "draft",
      })
    ).rejects.toThrow(/slug must be unique/);
  });
});

describe("deletePage", () => {
  it("DELETEs the by-id endpoint", async () => {
    const fn = mockFetch({ message: "deleted" });
    await deletePage("9");
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/admin/api/collections/pages/entries/9");
    expect(init.method).toBe("DELETE");
  });
});
