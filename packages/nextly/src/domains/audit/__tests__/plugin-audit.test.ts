import { describe, expect, it, vi } from "vitest";

import {
  collectPluginAuditKinds,
  looksLikeSecret,
  projectPluginAuditEvent,
} from "../plugin-audit";

vi.mock("../../../observability/logger", () => ({
  getNextlyLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

const SLUG = "acme-auth";

function kinds() {
  return collectPluginAuditKinds(SLUG, [
    { kind: `${SLUG}.identity-linked`, metadataKeys: ["provider", "reason"] },
    { kind: `${SLUG}.identity-unlinked` },
  ]);
}

describe("collectPluginAuditKinds", () => {
  it("keeps a kind under the plugin's own prefix", () => {
    expect(kinds().has(`${SLUG}.identity-linked`)).toBe(true);
  });

  it("drops a kind outside the prefix, so one plugin cannot impersonate another", () => {
    const collected = collectPluginAuditKinds(SLUG, [
      { kind: "login-succeeded" },
      { kind: "other-plugin.thing" },
    ]);
    expect(collected.size).toBe(0);
  });

  it("gives a kind with no declared keys an empty allowlist rather than an open one", () => {
    expect(kinds().get(`${SLUG}.identity-unlinked`)?.size).toBe(0);
  });
});

describe("projectPluginAuditEvent", () => {
  it("keeps a declared kind and its declared keys", () => {
    const projected = projectPluginAuditEvent(
      {
        kind: `${SLUG}.identity-linked`,
        actorUserId: "u1",
        targetUserId: "u2",
        metadata: { provider: "google", reason: "first-login" },
      },
      kinds(),
      "@acme/auth"
    );
    expect(projected).toMatchObject({
      kind: `${SLUG}.identity-linked`,
      actorUserId: "u1",
      targetUserId: "u2",
      metadata: { provider: "google", reason: "first-login" },
    });
  });

  it("drops an undeclared kind entirely", () => {
    expect(
      projectPluginAuditEvent(
        { kind: `${SLUG}.never-declared` },
        kinds(),
        "@acme/auth"
      )
    ).toBeNull();
  });

  it("drops an undeclared metadata key while keeping the row", () => {
    const projected = projectPluginAuditEvent(
      {
        kind: `${SLUG}.identity-linked`,
        metadata: { provider: "google", email: "someone@example.com" },
      },
      kinds(),
      "@acme/auth"
    );
    expect(projected?.metadata).toEqual({ provider: "google" });
  });

  it("drops a value that looks like a credential", () => {
    // A retained row is the wrong place for a token, and it is not what the
    // event is about either.
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2lnbmF0dXJlLXZhbHVl";
    const projected = projectPluginAuditEvent(
      { kind: `${SLUG}.identity-linked`, metadata: { reason: jwt } },
      kinds(),
      "@acme/auth"
    );
    expect(projected?.metadata).toEqual({});
  });

  it("drops a value too long to be a fact about what happened", () => {
    const projected = projectPluginAuditEvent(
      {
        kind: `${SLUG}.identity-linked`,
        metadata: { reason: "x".repeat(257) },
      },
      kinds(),
      "@acme/auth"
    );
    expect(projected?.metadata).toEqual({});
  });

  it("keeps numbers and booleans, which cannot carry a credential", () => {
    const collected = collectPluginAuditKinds(SLUG, [
      { kind: `${SLUG}.x`, metadataKeys: ["count", "ok"] },
    ]);
    const projected = projectPluginAuditEvent(
      { kind: `${SLUG}.x`, metadata: { count: 3, ok: true } },
      collected,
      "@acme/auth"
    );
    expect(projected?.metadata).toEqual({ count: 3, ok: true });
  });
});

describe("looksLikeSecret", () => {
  it.each([
    ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2lnbmF0dXJlLXZhbHVl"],
    ["whsec_abcdef123456"],
  ])("recognises %s", value => {
    expect(looksLikeSecret(value)).toBe(true);
  });

  it.each([["google"], ["first-login"], ["a.b.c"], [""]])(
    "does not flag the ordinary value %s",
    value => {
      // The positive control: a matcher that flagged everything would pass
      // every case above while dropping all real metadata.
      expect(looksLikeSecret(value)).toBe(false);
    }
  );
});
