import { describe, it, expect } from "vitest";

import { buildEnvelope, type BuildEnvelopeInput } from "../envelope";

// A fixed Date fixture so every timestamp assertion is deterministic.
const base: BuildEnvelopeInput = {
  id: "evt_1",
  type: "entry.updated",
  timestamp: new Date("2026-07-18T00:00:00.000Z"),
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

  // The envelope boundary owns time formatting: a Date in, an ISO string out.
  it("normalizes the Date timestamp to an ISO-8601 string", () => {
    const env = buildEnvelope({
      ...base,
      timestamp: new Date("2026-07-18T12:34:56.000Z"),
    });
    expect(env.timestamp).toBe("2026-07-18T12:34:56.000Z");
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

  // Secrets can live inside groups/repeaters, so stripping must remove the
  // named fields recursively before the payload is ever exposed.
  it("strips sensitive fields nested inside groups and arrays, at any depth", () => {
    const env = buildEnvelope({
      ...base,
      previous: null,
      data: {
        id: "p1",
        profile: { name: "A", apiSecret: "s1" },
        items: [{ label: "x", token: "t1" }],
      },
      sensitiveFields: ["apiSecret", "token"],
    });
    expect(env.data).toEqual({
      id: "p1",
      profile: { name: "A" },
      items: [{ label: "x" }],
    });
  });

  // Date instances have no enumerable keys, so the diff must compare them by
  // value; otherwise a date-only change would be missed.
  it("detects a Date-only change and treats equal Dates as unchanged", () => {
    const changed = buildEnvelope({
      ...base,
      previous: { publishedAt: new Date("2026-01-01T00:00:00.000Z") },
      data: { publishedAt: new Date("2026-02-01T00:00:00.000Z") },
    });
    expect(changed.changedFields).toEqual(["publishedAt"]);

    const same = buildEnvelope({
      ...base,
      previous: { publishedAt: new Date("2026-01-01T00:00:00.000Z") },
      data: { publishedAt: new Date("2026-01-01T00:00:00.000Z") },
    });
    expect(same.changedFields).toEqual([]);
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
