/**
 * Version route handlers: path and query validation runs before the access
 * check, so malformed input is rejected without an auth round-trip (and without
 * needing a booted container).
 */
import { describe, expect, it } from "vitest";

import { GET as getDetail } from "../versions-detail";
import { GET as getList } from "../versions";

/**
 * Next.js 15 hands route handlers their params as a Promise. Each handler
 * declares its own context shape, so the helper is generic over the param map
 * rather than cast at the call site.
 */
function ctx<T extends Record<string, string>>(
  params: T
): { params: Promise<T> } {
  return { params: Promise.resolve(params) };
}

describe("version routes (integration)", () => {
  it("rejects an unknown scope kind on the list route", async () => {
    const res = await getList(
      new Request("http://localhost/api/versions/bogus/posts/abc"),
      ctx({ kind: "bogus", slug: "posts", id: "abc" })
    );
    expect(res.status).toBe(400);
  });

  it("rejects a non-numeric limit on the list route", async () => {
    const res = await getList(
      new Request(
        "http://localhost/api/versions/collection/posts/abc?limit=nope"
      ),
      ctx({ kind: "collection", slug: "posts", id: "abc" })
    );
    expect(res.status).toBe(400);
  });

  it("rejects an unknown scope kind on the detail route", async () => {
    const res = await getDetail(
      new Request("http://localhost/api/versions/bogus/posts/abc/1"),
      ctx({ kind: "bogus", slug: "posts", id: "abc", versionNo: "1" })
    );
    expect(res.status).toBe(400);
  });

  it("rejects a non-numeric version number on the detail route", async () => {
    const res = await getDetail(
      new Request("http://localhost/api/versions/collection/posts/abc/nope"),
      ctx({ kind: "collection", slug: "posts", id: "abc", versionNo: "nope" })
    );
    expect(res.status).toBe(400);
  });
});
