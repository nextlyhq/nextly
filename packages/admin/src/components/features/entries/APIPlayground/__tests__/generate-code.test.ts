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
  action: "list",
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

// Every action used to produce `find()`. The snippet under "Create Entry" ran
// a query, and nothing failed — it just did the wrong thing, authoritatively.
// These pin each action to the call that performs it, against the direct API's
// real signatures.
describe("sdk — the call matches the action", () => {
  const req = (over: Partial<CodeRequest>): CodeRequest => ({
    ...base,
    ...over,
  });

  it("list reads with find", () => {
    expect(toSdk(req({ action: "list" }))).toContain("nextly.find({");
  });

  it("get reads one entry by id", () => {
    const out = toSdk(req({ action: "get", entryId: "abc123" }));
    expect(out).toContain("nextly.findByID({");
    expect(out).toContain('id: "abc123"');
    expect(out).not.toContain("nextly.find({");
  });

  it("create writes, and carries the body as data", () => {
    const out = toSdk(
      req({ action: "create", body: '{"title":"Hello"}', method: "POST" })
    );
    expect(out).toContain("nextly.create({");
    expect(out).toContain('"title": "Hello"');
    expect(out).not.toContain("nextly.find(");
  });

  it("update addresses the entry it edits", () => {
    const out = toSdk(
      req({ action: "update", entryId: "abc123", body: '{"title":"New"}' })
    );
    expect(out).toContain("nextly.update({");
    expect(out).toContain('id: "abc123"');
  });

  it("delete deletes", () => {
    const out = toSdk(req({ action: "delete", entryId: "abc123" }));
    expect(out).toContain("nextly.delete({");
    expect(out).toContain('id: "abc123"');
  });

  it("duplicate duplicates", () => {
    expect(toSdk(req({ action: "duplicate", entryId: "abc123" }))).toContain(
      "nextly.duplicate({"
    );
  });

  it("count counts, and keeps the filter", () => {
    const out = toSdk(
      req({
        action: "count",
        params: { where: '{"status":{"equals":"draft"}}' },
      })
    );
    expect(out).toContain("nextly.count({");
    expect(out).toContain("where:");
  });

  it("bulk delete passes the ids from the body", () => {
    const out = toSdk(
      req({ action: "bulk-delete", body: '{"ids":["a","b"]}' })
    );
    expect(out).toContain("nextly.bulkDelete({");
    expect(out).toContain('["a","b"]');
  });

  // The SDK has no bulkUpdate: `update` with a `where` is the bulk form, so
  // the REST body's ids have to become one.
  it("bulk update becomes an update with a where on id", () => {
    const out = toSdk(
      req({
        action: "bulk-update",
        body: '{"ids":["a","b"],"data":{"status":"published"}}',
      })
    );
    expect(out).toContain("nextly.update({");
    expect(out).toContain('where: { id: { in: ["a","b"] } }');
    expect(out).toContain('"status": "published"');
  });

  it("a single reads with findSingle and a single update writes with updateSingle", () => {
    expect(toSdk(req({ isSingle: true, action: "get" }))).toContain(
      "nextly.findSingle({"
    );
    const upd = toSdk(
      req({ isSingle: true, action: "update", body: '{"title":"Home"}' })
    );
    expect(upd).toContain("nextly.updateSingle({");
    expect(upd).toContain('"title": "Home"');
  });

  // findSingle takes slug/select/populate. Its own JSDoc example passes
  // `depth: 1`, which is not on the interface and does not compile — the
  // snippet must not copy the documentation's mistake.
  it("does not pass depth to findSingle", () => {
    const out = toSdk(
      req({ isSingle: true, action: "get", params: { depth: "2" } })
    );
    expect(out).not.toContain("depth");
  });
});

describe("sdk — numeric arguments", () => {
  const req = (params: Record<string, string>): CodeRequest => ({
    ...base,
    action: "list",
    params,
  });

  it("keeps numbers", () => {
    expect(toSdk(req({ limit: "25" }))).toContain("limit: 25,");
  });

  // `Number("abc")` is NaN, and `limit: NaN` reads as code while being none.
  it("drops values that are not numbers rather than emitting NaN", () => {
    const out = toSdk(req({ limit: "abc", page: "", depth: "x" }));
    expect(out).not.toContain("NaN");
    expect(out).not.toContain("limit:");
    expect(out).not.toContain("page:");
    expect(out).not.toContain("depth:");
  });
});
