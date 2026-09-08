/**
 * The shared construction site, and the one read inside it that could fail
 * silently.
 *
 * @module domains/jobs/__tests__/jobs-runner.test
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_RETENTION_MS,
  databaseRunAs,
  resolveRetentionMs,
} from "../jobs-runner";

describe("resolveRetentionMs", () => {
  it("takes the default when the option was not set", async () => {
    expect(resolveRetentionMs(undefined)).toBe(DEFAULT_RETENTION_MS);
  });

  it("keeps everything when a deployment explicitly passes null", async () => {
    // The documented opt-out: "retain the history, I prune it myself." A `??`
    // here cannot tell this from the unset case, so the default came back and
    // terminal rows older than the default window were deleted anyway — the
    // option validated, and did nothing.
    expect(resolveRetentionMs(null)).toBeNull();
  });

  it("distinguishes null from the default rather than agreeing by accident", async () => {
    // The control for the case above. If the default were ever null, the
    // assertion there would pass against an implementation that collapsed the
    // two states — which is precisely the implementation it exists to reject.
    expect(DEFAULT_RETENTION_MS).not.toBeNull();
    expect(resolveRetentionMs(null)).not.toBe(resolveRetentionMs(undefined));
  });

  it("honours an explicit window", async () => {
    expect(resolveRetentionMs(1_000)).toBe(1_000);
  });

  it("honours a zero window rather than reading it as unset", async () => {
    // Zero is falsy: an implementation reaching for `||` instead of a
    // three-state check would replace "prune everything terminal immediately"
    // with the seven-day default.
    expect(resolveRetentionMs(0)).toBe(0);
  });
});

describe("databaseRunAs", () => {
  it("reads an active SQLite user, whose flag is 1 rather than true", async () => {
    // SQLite has no boolean: `is_active` comes back as 0/1. A strict `=== true`
    // would make every SQLite user look deactivated, and every job queued by
    // one would fail with an identity error that is nothing to do with them.
    const deps = databaseRunAs({
      select: async () => [{ id: "u1", isActive: 1 }],
    });
    await expect(deps.findUser("u1")).resolves.toEqual({
      id: "u1",
      isActive: true,
    });
  });

  it("reads a deactivated user as deactivated, not merely falsy-and-ignored", async () => {
    // The control: an implementation that returned isActive: true for
    // everything would satisfy the case above.
    const deps = databaseRunAs({
      select: async () => [{ id: "u1", isActive: 0 }],
    });
    await expect(deps.findUser("u1")).resolves.toEqual({
      id: "u1",
      isActive: false,
    });
  });

  it("reports a missing user as null rather than inventing one", async () => {
    const deps = databaseRunAs({ select: async () => [] });
    await expect(deps.findUser("ghost")).resolves.toBeNull();
  });

  it("refuses a row that answered without an id, rather than building a context around undefined", async () => {
    // The row is read back as an open record. Without narrowing, a users table
    // that answered without an id would produce a UserContext whose id is
    // undefined — and an access rule matching on it would compare against
    // nothing, which fails open or closed depending on the rule and is
    // unpredictable either way.
    const deps = databaseRunAs({ select: async () => [{ isActive: 1 }] });
    await expect(deps.findUser("u1")).resolves.toBeNull();
  });

  it("PROPAGATES a roles-lookup failure instead of resolving to no roles", async () => {
    // The reason this uses listRoleSlugsForUserStrict and not
    // listRoleSlugsForUser: the non-strict one catches its own errors and
    // returns []. Here that is the worst available failure — the job would run
    // with an empty role set, every role-gated collection would match nothing,
    // and the job would report itself complete having done nothing. A thrown
    // error becomes an ordinary retryable failure instead: a job that did not
    // run, rather than one that silently did nothing and claimed success.
    const deps = databaseRunAs(
      { select: async () => [{ id: "u1", isActive: 1 }] },
      async () => {
        throw new Error("roles table unreachable");
      }
    );
    await expect(deps.listRoleSlugs("u1")).rejects.toThrow(/unreachable/);
  });

  it("returns the user's name and email, which the context needs to carry", async () => {
    // resolveRunAs puts these on the reconstructed context because access
    // predicates here inspect `user.email`. It can only carry what this lookup
    // returns, so stopping at id/isActive made that handling unable to do
    // anything at all.
    const deps = databaseRunAs({
      select: async () => [
        { id: "u1", isActive: 1, name: "Ada", email: "ada@example.com" },
      ],
    });
    await expect(deps.findUser("u1")).resolves.toEqual({
      id: "u1",
      isActive: true,
      name: "Ada",
      email: "ada@example.com",
    });
  });

  it("omits attributes the row does not carry rather than setting them undefined", async () => {
    // The control: spreading unconditionally would put `email: undefined` on
    // the user, which reads as "has an email, and it is nothing" to a predicate
    // testing presence.
    const deps = databaseRunAs({
      select: async () => [{ id: "u1", isActive: 1 }],
    });
    await expect(deps.findUser("u1")).resolves.toEqual({
      id: "u1",
      isActive: true,
    });
  });
});
