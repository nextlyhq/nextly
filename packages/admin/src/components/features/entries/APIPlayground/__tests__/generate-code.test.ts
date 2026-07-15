/**
 * The playground's generated code.
 *
 * These snippets are meant to be pasted into a real project, so a wrong one is
 * worse than none: it looks authoritative and fails somewhere else. The
 * assertions pin the parts that would break silently — shell quoting, cookie
 * auth, and the SDK's real signature.
 */

import { describe, expect, it } from "vitest";

import type { CodeRequest } from "../generate-code";
import { generateCode, toCurl, toFetch, toSdk } from "../generate-code";

const base: CodeRequest = {
  method: "GET",
  url: "http://localhost:3000/admin/api/collections/posts/entries?limit=10",
  collection: "posts",
  isSingle: false,
  params: { limit: "10" },
};

describe("curl", () => {
  it("sends the method and URL it was given", () => {
    const out = toCurl(base);
    expect(out).toContain("curl -X GET");
    expect(out).toContain(
      "'http://localhost:3000/admin/api/collections/posts/entries?limit=10'"
    );
  });

  it("says the session cookie is needed", () => {
    // The admin authenticates by cookie, and a copied curl has no cookie jar;
    // without this the command 401s with nothing to explain why.
    expect(toCurl(base)).toContain("Cookie:");
  });

  it("escapes a quote in the body instead of ending the string", () => {
    const out = toCurl({
      ...base,
      method: "POST",
      body: `{"title":"it's here"}`,
    });
    // A bare ' would close the shell string and the rest would be parsed as
    // shell words — the classic way a copied command mangles itself.
    expect(out).toContain(`'\\''`);
    expect(out).not.toMatch(/-d '\{"title":"it's here"\}'/);
  });

  it("omits the body when there is none", () => {
    expect(toCurl(base)).not.toContain("-d ");
  });
});

describe("fetch", () => {
  it("keeps the session cookie on the request", () => {
    expect(toFetch(base)).toContain('credentials: "include"');
  });

  it("carries the body for a write", () => {
    const out = toFetch({
      ...base,
      method: "POST",
      body: '{"title":"Hello"}',
    });
    expect(out).toContain('method: "POST"');
    expect(out).toContain("body: JSON.stringify(");
  });

  it("sends no body for a read", () => {
    expect(toFetch(base)).not.toContain("body:");
  });
});

describe("sdk", () => {
  it("awaits getNextly and passes the config", () => {
    // The package's own examples show `getNextly()` — no await, no config —
    // which hands back a Promise and does not compile. This is the real one.
    const out = toSdk(base);
    expect(out).toContain("await getNextly({ config })");
    expect(out).not.toMatch(/const nextly = getNextly\(\)/);
  });

  it("queries the collection it was built for", () => {
    const out = toSdk(base);
    expect(out).toContain("await nextly.find({");
    expect(out).toContain('collection: "posts"');
  });

  it("passes the parameters that were set", () => {
    const out = toSdk({
      ...base,
      params: { limit: "5", page: "2", sort: "-createdAt", depth: "1" },
    });
    expect(out).toContain("limit: 5");
    expect(out).toContain("page: 2");
    expect(out).toContain('sort: "-createdAt"');
    expect(out).toContain("depth: 1");
  });

  it("passes numbers as numbers, not strings", () => {
    // They arrive from text inputs; `limit: "5"` would not type-check.
    const out = toSdk({ ...base, params: { limit: "5" } });
    expect(out).toContain("limit: 5");
    expect(out).not.toContain('limit: "5"');
  });

  it("leaves out parameters that were not set", () => {
    const out = toSdk({ ...base, params: {} });
    expect(out).not.toContain("limit:");
    expect(out).not.toContain("sort:");
  });

  it("includes a where clause as an object", () => {
    const out = toSdk({
      ...base,
      params: { where: '{"status":{"equals":"published"}}' },
    });
    expect(out).toContain("where: {");
    expect(out).toContain('"status"');
  });

  it("skips a where clause that is not valid JSON", () => {
    // Half-typed filters are normal; emitting them would produce a snippet
    // that does not parse.
    const out = toSdk({ ...base, params: { where: '{"status":' } });
    expect(out).not.toContain("where:");
    expect(out).toContain("await nextly.find({");
  });

  it("addresses a single by slug rather than querying it", () => {
    const out = toSdk({ ...base, collection: "homepage", isSingle: true });
    expect(out).toContain("await nextly.findSingle({");
    expect(out).toContain('slug: "homepage"');
    expect(out).not.toContain("nextly.find({");
  });

  it("reads the documented result shape", () => {
    const out = toSdk(base);
    expect(out).toContain("result.items");
    expect(out).toContain("result.meta.total");
  });
});

describe("generateCode", () => {
  it("returns all three flavours", () => {
    const out = generateCode(base);
    expect(Object.keys(out).sort()).toEqual(["curl", "fetch", "sdk"]);
    expect(out.curl).toContain("curl");
    expect(out.fetch).toContain("fetch(");
    expect(out.sdk).toContain("nextly");
  });
});
