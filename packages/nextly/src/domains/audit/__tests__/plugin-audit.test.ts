import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import { auditLog as postgresAuditLog } from "../../../schemas/audit/postgres";
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

  it("REFUSES a kind outside the prefix, naming the plugin and the kind", () => {
    // Dropping it booted the application with `ctx.audit` present and every
    // write of that kind discarded at runtime, so the operator was missing the
    // trail the manifest said would be kept and nothing said so until it was
    // needed. Refusing is what makes the declaration binding.
    let caught: unknown;
    try {
      collectPluginAuditKinds(
        SLUG,
        [{ kind: "other-plugin.thing" }],
        "@acme/auth"
      );
    } catch (err) {
      caught = err;
    }
    expect(NextlyError.is(caught)).toBe(true);
    const context = (caught as NextlyError).logContext as {
      reason?: string;
      plugin?: string;
      auditKind?: string;
    };
    expect(context.reason).toBe("plugin-audit-kind-outside-prefix");
    // Both, because a refusal naming neither leaves whoever reads it looking
    // through every manifest for the declaration that caused it.
    expect(context.plugin).toBe("@acme/auth");
    expect(context.auditKind).toBe("other-plugin.thing");
  });

  it("accepts a correctly prefixed kind", () => {
    // The control: a collector that threw on every declaration would satisfy
    // the refusal above while making any audit contribution unbootable.
    expect(() =>
      collectPluginAuditKinds(SLUG, [{ kind: `${SLUG}.thing` }])
    ).not.toThrow();
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

describe("metadata values are held to the declared contract", () => {
  const kindsWith = (...keys: string[]) =>
    collectPluginAuditKinds(SLUG, [
      { kind: `${SLUG}.thing`, metadataKeys: keys },
    ]);

  const project = (metadata: Record<string, unknown>) =>
    projectPluginAuditEvent(
      { kind: `${SLUG}.thing`, metadata: metadata as never },
      kindsWith("payload", "note"),
      "@acme/auth"
    );

  it("DROPS an object, which the string checks never saw", () => {
    // An allowlisted key holding an object passed every runtime check, because
    // they all read strings — so a nested access token was retained without
    // meeting `looksLikeSecret` or the length bound.
    const projected = project({
      payload: { token: "eyJhbGciOi.AAAAAAAA.BBBBBBBB" },
      note: "kept",
    });

    expect(projected?.metadata).toEqual({ note: "kept" });
  });

  it("drops an array for the same reason", () => {
    expect(project({ payload: ["a", "b"], note: "kept" })?.metadata).toEqual({
      note: "kept",
    });
  });

  it("drops a non-finite number rather than storing null", () => {
    // `NaN` has no JSON form: stored, it reads back as a fact nobody recorded.
    expect(project({ payload: Number.NaN, note: "kept" })?.metadata).toEqual({
      note: "kept",
    });
  });

  it("KEEPS the three declared kinds", () => {
    // The control: dropping everything non-string would satisfy the tests
    // above while making numbers and booleans unrecordable.
    const projected = projectPluginAuditEvent(
      {
        kind: `${SLUG}.thing`,
        metadata: { s: "text", n: 42, b: true } as never,
      },
      collectPluginAuditKinds(SLUG, [
        { kind: `${SLUG}.thing`, metadataKeys: ["s", "n", "b"] },
      ]),
      "@acme/auth"
    );
    expect(projected?.metadata).toEqual({ s: "text", n: 42, b: true });
  });
});

describe("collectPluginAuditKinds against the storage column", () => {
  /** The audit trail's own `kind` width, read from the table this test guards. */
  function kindColumnMax(): number {
    // Derived rather than restated: the refusal must track the column, so a
    // widened column loosens the check instead of silently disagreeing. The
    // column is read as a plain property — the column-collecting helper is
    // banned by the drizzle v1 legacy gate, and the columns are typed
    // properties either way.
    const length = (postgresAuditLog.kind as { length?: number }).length;
    return length ?? Number.MAX_SAFE_INTEGER;
  }

  it("REFUSES a kind longer than the kind column can hold", () => {
    // Postgres and MySQL store `kind` in a bounded varchar, and audit writes
    // are fail-safe: a too-long kind accepted here fails at the column for
    // every write, the failure becomes a log line, and the security event the
    // plugin declared it would record never exists.
    const max = kindColumnMax();
    const tooLong = `${SLUG}.${"x".repeat(max - SLUG.length)}`;
    expect(tooLong.length).toBe(max + 1);

    let caught: unknown;
    try {
      collectPluginAuditKinds(SLUG, [{ kind: tooLong }], "@acme/auth");
    } catch (err) {
      caught = err;
    }
    expect(NextlyError.is(caught)).toBe(true);
    const context = (caught as NextlyError).logContext as {
      reason?: string;
      maxLength?: number;
    };
    expect(context.reason).toBe("plugin-audit-kind-too-long");
    expect(context.maxLength).toBe(max);
  });

  it("accepts a kind of exactly the column width", () => {
    // The control: an off-by-one in the boundary check would refuse the last
    // legal kind, and a plugin using all 64 characters is legitimate.
    const max = kindColumnMax();
    const exactly = `${SLUG}.${"x".repeat(max - SLUG.length - 1)}`;
    expect(exactly.length).toBe(max);

    expect(() =>
      collectPluginAuditKinds(SLUG, [{ kind: exactly }], "@acme/auth")
    ).not.toThrow();
  });
});

describe("collectPluginAuditKinds: one kind declared once", () => {
  it("REFUSES the same kind declared twice, naming it", () => {
    // Keeping the last entry silently replaced the first one's allowlist: a
    // metadata key only the first entry declared was dropped from every row,
    // and the manifest promised a trail it did not keep.
    let caught: unknown;
    try {
      collectPluginAuditKinds(
        SLUG,
        [
          { kind: `${SLUG}.login`, metadataKeys: ["provider"] },
          { kind: `${SLUG}.login`, metadataKeys: ["subject"] },
        ],
        "@acme/auth"
      );
    } catch (err) {
      caught = err;
    }
    expect(NextlyError.is(caught)).toBe(true);
    const context = (caught as NextlyError).logContext as {
      reason?: string;
      auditKind?: string;
    };
    expect(context.reason).toBe("plugin-audit-kind-declared-twice");
    expect(context.auditKind).toBe(`${SLUG}.login`);
  });

  it("accepts the same METADATA KEY on two different kinds", () => {
    // The control: the refusal is about one kind declared twice, not about
    // shared vocabulary between a plugin's events.
    expect(() =>
      collectPluginAuditKinds(
        SLUG,
        [
          { kind: `${SLUG}.login`, metadataKeys: ["provider"] },
          { kind: `${SLUG}.logout`, metadataKeys: ["provider"] },
        ],
        "@acme/auth"
      )
    ).not.toThrow();
  });
});
