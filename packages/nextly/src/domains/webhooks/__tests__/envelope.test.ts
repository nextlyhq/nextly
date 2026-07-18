import { describe, it, expect } from "vitest";

import { buildEnvelope, type BuildEnvelopeInput } from "../envelope";

const base: BuildEnvelopeInput = {
  id: "evt_1",
  type: "entry.updated",
  timestamp: "2026-07-18T00:00:00.000Z",
  resource: { kind: "entry", collection: "posts", id: "p1" },
  data: { id: "p1", title: "Hello", status: "published" },
};

describe("buildEnvelope", () => {
  it("stamps the fixed envelope shape", () => {
    const env = buildEnvelope(base);
    expect(env.specversion).toBe("1");
    expect(env.id).toBe("evt_1");
    expect(env.type).toBe("entry.updated");
    expect(env.resource).toEqual({
      kind: "entry",
      collection: "posts",
      id: "p1",
    });
  });

  it("normalizes a Date timestamp to ISO-8601 and passes a string through", () => {
    const fromDate = buildEnvelope({
      ...base,
      timestamp: new Date("2026-07-18T12:34:56.000Z"),
    });
    expect(fromDate.timestamp).toBe("2026-07-18T12:34:56.000Z");

    const fromString = buildEnvelope({ ...base, timestamp: "not-parsed" });
    expect(fromString.timestamp).toBe("not-parsed");
  });

  it("on create (no previous) reports previous=null and all keys changed", () => {
    const env = buildEnvelope({
      ...base,
      type: "entry.created",
      data: { id: "p1", title: "Hello", status: "draft" },
      previous: null,
    });
    expect(env.previous).toBeNull();
    expect(env.changedFields).toEqual(["id", "status", "title"]);
  });

  it("treats an undefined previous the same as create", () => {
    const env = buildEnvelope({ ...base, previous: undefined });
    expect(env.previous).toBeNull();
    expect(env.changedFields).toEqual(["id", "status", "title"]);
  });

  it("computes changedFields as only the top-level keys that differ", () => {
    const env = buildEnvelope({
      ...base,
      previous: { id: "p1", title: "Hello", status: "draft" },
      data: { id: "p1", title: "Hello", status: "published" },
    });
    expect(env.changedFields).toEqual(["status"]);
  });

  it("registers a top-level key when a nested value or array changes", () => {
    const env = buildEnvelope({
      ...base,
      previous: { seo: { title: "a" }, tags: ["x"] },
      data: { seo: { title: "b" }, tags: ["x", "y"] },
    });
    expect(env.changedFields).toEqual(["seo", "tags"]);
  });

  it("counts a key present on only one side as changed", () => {
    const env = buildEnvelope({
      ...base,
      previous: { id: "p1", removed: "gone" },
      data: { id: "p1", added: "new" },
    });
    expect(env.changedFields).toEqual(["added", "removed"]);
  });

  it("does NOT flag a key whose nested object differs only in key order", () => {
    const env = buildEnvelope({
      ...base,
      previous: { seo: { a: 1, b: 2 } },
      data: { seo: { b: 2, a: 1 } },
    });
    expect(env.changedFields).toEqual([]);
  });

  it("strips sensitive fields from both data and previous", () => {
    const env = buildEnvelope({
      ...base,
      previous: { id: "p1", password: "old-hash", title: "Hello" },
      data: { id: "p1", password: "new-hash", title: "World" },
      sensitiveFields: ["password"],
    });
    expect(env.data).not.toHaveProperty("password");
    expect(env.previous).not.toHaveProperty("password");
    expect(env.data).toEqual({ id: "p1", title: "World" });
  });

  it("strips before diffing, so a secret-only change never appears in changedFields", () => {
    const env = buildEnvelope({
      ...base,
      previous: { id: "p1", apiSecret: "s1", title: "Hello" },
      data: { id: "p1", apiSecret: "s2", title: "Hello" },
      sensitiveFields: ["apiSecret"],
    });
    expect(env.changedFields).toEqual([]);
  });

  it("attaches site only when provided", () => {
    expect(buildEnvelope(base).site).toBeUndefined();
    expect(buildEnvelope({ ...base, site: "https://acme.com" }).site).toBe(
      "https://acme.com"
    );
  });

  it("attaches actor only when non-null", () => {
    expect(buildEnvelope(base).actor).toBeUndefined();
    expect(buildEnvelope({ ...base, actor: null }).actor).toBeUndefined();
    expect(
      buildEnvelope({ ...base, actor: { type: "user", id: "u1" } }).actor
    ).toEqual({ type: "user", id: "u1" });
  });

  it("does not mutate the caller's data/previous objects", () => {
    const data = { id: "p1", password: "x" };
    const previous = { id: "p1", password: "y" };
    buildEnvelope({ ...base, data, previous, sensitiveFields: ["password"] });
    expect(data).toHaveProperty("password");
    expect(previous).toHaveProperty("password");
  });
});
