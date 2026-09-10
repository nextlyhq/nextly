/**
 * The owner safety net answers one question, in one place.
 *
 * Update and delete both fall back to comparing a fetched row's owner against
 * the caller when the SQL owner predicate is absent. Each used to decide that
 * inline, and the two copies drifted: update learned that a scoped API key does
 * not inherit its owner's super-admin bypass, delete did not, and a key owned by
 * a super-admin could delete a row it could not update.
 *
 * @module domains/collections/services/__tests__/owner-safety-net.test
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { apiKeyScope } from "../../../../auth/authenticated-scope";
import { runWithCallerScope } from "../../../../auth/caller-scope";
import { ownerSafetyNetApplies } from "../owner-safety-net";

/** An owner-only rule and an ordinary signed-in caller: the net applies. */
const BASE = {
  ruleIsOwnerOnly: true,
  hasUser: true,
  overrideAccess: false,
  isSuperAdmin: false,
  scope: undefined,
} as const;

/** A request arriving on a scoped API key. */
const KEY = apiKeyScope([
  { slug: "read-notes", action: "read", resource: "notes" },
]);

describe("ownerSafetyNetApplies", () => {
  it("applies to an ordinary caller under an owner-only rule", () => {
    // The control the rest are read against. Without it, every `false` below is
    // equally consistent with a predicate that answers `false` to everything.
    expect(ownerSafetyNetApplies(BASE)).toBe(true);
  });

  it("does not apply to a super-admin SESSION", () => {
    expect(ownerSafetyNetApplies({ ...BASE, isSuperAdmin: true })).toBe(false);
  });

  it("APPLIES to a super-admin's scoped API key", () => {
    // The defect this exists for. A key is judged on its own stamped grants, so
    // it does not inherit the bypass its owner holds — otherwise minting a
    // read-only key as a super-admin would hand it every bypass the owner has.
    expect(
      ownerSafetyNetApplies({
        ...BASE,
        isSuperAdmin: true,
        scope: KEY,
      })
    ).toBe(true);
  });

  it("applies to a scoped key whose owner is NOT a super-admin", () => {
    expect(ownerSafetyNetApplies({ ...BASE, scope: KEY })).toBe(true);
  });

  it("treats a session scope as a session, not a key", () => {
    // The negative half of reading `actorType`. A predicate that answered
    // "scoped key" for any scope at all would satisfy the case above while
    // taking the bypass away from every super-admin session.
    expect(
      ownerSafetyNetApplies({
        ...BASE,
        isSuperAdmin: true,
        // `permissions` is required on the scope and empty is what a session
        // carries: grants are an API key's, and this case exists to assert a
        // session is not read as one. Spelled as the other session fixtures in
        // this package spell it.
        scope: { actorType: "user", permissions: [] },
      })
    ).toBe(false);
  });

  it("reads the scope the REQUEST pinned when the caller named none", () => {
    // Every API key arriving through the route handler reaches these paths with
    // its scope in the store rather than in an argument. Reading the argument
    // alone made such a request look like a session here while the SQL owner
    // predicate — which resolves the same store — saw a key, so the two
    // disagreed precisely where this check is the only one left.
    const applies = runWithCallerScope(KEY, () =>
      ownerSafetyNetApplies({ ...BASE, isSuperAdmin: true, scope: undefined })
    );
    expect(applies).toBe(true);
  });

  it("is a session again outside that request", () => {
    // The control for the case above. Without it, an implementation that
    // ignored the store and always reported a key would pass it — and would
    // take the bypass away from every super-admin session.
    expect(
      ownerSafetyNetApplies({ ...BASE, isSuperAdmin: true, scope: undefined })
    ).toBe(false);
  });

  it("does not apply under a trusted override", () => {
    // An override must not have owner-only re-imposed on it, or it would be
    // refused rows it is entitled to write.
    expect(ownerSafetyNetApplies({ ...BASE, overrideAccess: true })).toBe(
      false
    );
    // Including for a scoped key, which the clause above must not resurrect.
    expect(
      ownerSafetyNetApplies({
        ...BASE,
        overrideAccess: true,
        scope: KEY,
      })
    ).toBe(false);
  });

  it("does not apply when the rule is not owner-only", () => {
    expect(ownerSafetyNetApplies({ ...BASE, ruleIsOwnerOnly: false })).toBe(
      false
    );
  });

  it("does not apply without a caller to compare against", () => {
    expect(ownerSafetyNetApplies({ ...BASE, hasUser: false })).toBe(false);
  });
});

describe("both write paths ask this function", () => {
  const source = readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "collection-mutation-service.ts"
    ),
    "utf8"
  );

  it("decides the net in one place, not two", () => {
    // The two paths agreed once and drifted. A count rather than a presence
    // check: one call site satisfies "the function is used" while the other
    // path goes on deciding inline, which is the state this replaced.
    const calls = source.match(/ownerSafetyNetApplies\(/g) ?? [];
    expect(calls).toHaveLength(2);
  });

  it("resolves the effective scope rather than reading one argument", () => {
    // The resolution is `effectiveCallerScope`, published once because six
    // places wrote `explicit ?? currentCallerScope()` by hand and a seventh —
    // this safety net — forgot to. A copy here would be the eighth.
    const source2 = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        "..",
        "owner-safety-net.ts"
      ),
      "utf8"
    );
    expect(source2).toContain("effectiveCallerScope(input.scope)");
    expect(source2).not.toMatch(/input\.scope\?\.actorType/);
  });

  it("hands both of them the caller's real scope", () => {
    // Calling the shared rule is not the same as calling it with the right
    // argument: a site passing `undefined` compiles, reads as wired up, and
    // restores the exact bypass this replaced. Both sites, so one correct call
    // does not vouch for the other.
    const wired = source.match(/scope: params\.authenticatedScope,/g) ?? [];
    expect(wired).toHaveLength(2);
  });

  it("leaves no inline copy of the super-admin bypass behind", () => {
    // The shape both paths used to carry. Its absence is only evidence because
    // the assertion above proves the replacement is present at both sites.
    expect(source).not.toMatch(/isSuperAdmin\([^)]*\)\s*&&\s*!isScopedApiKey/);
  });
});
