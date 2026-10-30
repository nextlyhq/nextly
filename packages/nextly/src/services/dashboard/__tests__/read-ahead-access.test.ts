/**
 * The access a digest read ahead for a dashboard load is kept under, and a batch must ask under
 * to be handed it: the whole caller and the authority the access gate reads for it, so two
 * requests that may see different things never compare equal, and two that may see the same do.
 */
import { describe, expect, it } from "vitest";

import {
  apiKeyScopeFrom,
  type GrantedPermission,
} from "../../../auth/authenticated-scope";
import { readAheadAccess } from "../read-ahead-access";
import type { ReadCaller } from "../readable-resources";

const READ_NOTES: GrantedPermission = {
  slug: "read-notes",
  action: "read",
  resource: "notes",
};

/** A person signed in with a session, carrying `claims` as verified claims. */
function person(claims: Record<string, unknown> = {}): ReadCaller {
  return {
    user: {
      ...claims,
      id: "user-1",
      name: undefined,
      email: undefined,
      roles: ["editor"],
      role: "editor",
    },
  };
}

/** The same person's API key, granted `grants`, with its maker's authority or not. */
function key(
  grants: readonly GrantedPermission[],
  options: { superAdmin?: boolean; lapsed?: boolean } = {}
): ReadCaller {
  return {
    ...person(),
    authenticatedScope: apiKeyScopeFrom({
      grants,
      ...(options.superAdmin === true ? { keyHoldsSuperAdmin: true } : {}),
      // An authority whose bound passed before the scope was made carries none.
      ...(options.lapsed === true
        ? { keyHoldsSuperAdminUntil: Date.now() - 1 }
        : {}),
    }),
  };
}

describe("the access a read-ahead digest is kept under", () => {
  it("is the same for the same caller built twice, so a batch on it takes the digest", () => {
    const access = readAheadAccess(person({ tenant: "a" }), "session");
    expect(access).toEqual(expect.any(String));
    expect(readAheadAccess(person({ tenant: "a" }), "session")).toBe(access);
    // The authority is compared by what the gate reads, not by which object carries it.
    expect(
      readAheadAccess(key([READ_NOTES], { superAdmin: true }), "api-key:k1")
    ).toBe(
      readAheadAccess(key([READ_NOTES], { superAdmin: true }), "api-key:k1")
    );
  });

  it("differs for a caller whose verified claims differ, the id and roles alike", () => {
    const base = readAheadAccess(person({ tenant: "a" }), "session");
    expect(readAheadAccess(person({ tenant: "b" }), "session")).not.toBe(base);
    // A claim added, nested ones included.
    expect(
      readAheadAccess(person({ tenant: "a", plan: { tier: "pro" } }), "session")
    ).not.toBe(base);
  });

  it("differs for an API key whose grants differ, by slug or by the row behind it", () => {
    const base = readAheadAccess(key([READ_NOTES]), "api-key:k1");
    expect(readAheadAccess(key([]), "api-key:k1")).not.toBe(base);
    expect(
      readAheadAccess(
        key([{ ...READ_NOTES, resource: "notes-archive" }]),
        "api-key:k1"
      )
    ).not.toBe(base);
  });

  it("differs for an API key whose maker's super-admin authority lapsed, its grants the same", () => {
    const holding = readAheadAccess(
      key([READ_NOTES], { superAdmin: true }),
      "api-key:k1"
    );
    expect(
      readAheadAccess(
        key([READ_NOTES], { superAdmin: true, lapsed: true }),
        "api-key:k1"
      )
    ).not.toBe(holding);
    expect(readAheadAccess(key([READ_NOTES]), "api-key:k1")).not.toBe(holding);
  });

  it("differs for another credential, the caller the same", () => {
    expect(readAheadAccess(key([READ_NOTES]), "api-key:k2")).not.toBe(
      readAheadAccess(key([READ_NOTES]), "api-key:k1")
    );
  });

  it("is none, so nothing is reused, for a credential that could not be named or a caller that cannot be written out", () => {
    expect(readAheadAccess(person(), undefined)).toBeUndefined();
    for (const claim of [
      () => "a function",
      new Date(0),
      new Map([["tenant", "a"]]),
      BigInt(1),
      Number.NaN,
      { [Symbol("hidden")]: true },
    ]) {
      expect(
        readAheadAccess(person({ claim }), "session"),
        String(claim)
      ).toBeUndefined();
    }
    const looped: Record<string, unknown> = {};
    looped.self = looped;
    expect(readAheadAccess(person({ looped }), "session")).toBeUndefined();
  });
});
