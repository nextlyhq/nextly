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

import { ownerSafetyNetApplies } from "../owner-safety-net";

/** An owner-only rule and an ordinary signed-in caller: the net applies. */
const BASE = {
  ruleIsOwnerOnly: true,
  hasUser: true,
  overrideAccess: false,
  isSuperAdmin: false,
  isScopedApiKey: false,
} as const;

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
        isScopedApiKey: true,
      })
    ).toBe(true);
  });

  it("applies to a scoped key whose owner is NOT a super-admin", () => {
    expect(ownerSafetyNetApplies({ ...BASE, isScopedApiKey: true })).toBe(true);
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
        isScopedApiKey: true,
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

  it("leaves no inline copy of the super-admin bypass behind", () => {
    // The shape both paths used to carry. Its absence is only evidence because
    // the assertion above proves the replacement is present at both sites.
    expect(source).not.toMatch(/isSuperAdmin\([^)]*\)\s*&&\s*!isScopedApiKey/);
  });
});
