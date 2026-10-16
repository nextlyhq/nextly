/**
 * The access a release target is read with: the caller's own, whole, and
 * nothing the Direct API instance's defaults could fill back in.
 */
import { describe, expect, it } from "vitest";

import { contentReadAccess } from "../registrations/register-releases";

describe("reading a release target as its caller", () => {
  it("states `actor` even when the caller has no key, so no default key fills it", () => {
    // The content API spreads the call over the instance's defaults; an
    // absent `actor` would take the default key's, a present `undefined`
    // does not.
    const access = contentReadAccess({ userId: "u1", trusted: false });
    expect(Object.hasOwn(access, "actor")).toBe(true);
    expect(access.actor).toBeUndefined();
    expect(access).toMatchObject({ overrideAccess: false, user: { id: "u1" } });
  });

  it("carries the caller's key and roles", () => {
    const scope = { actorType: "apiKey" as const, permissions: ["read-posts"] };
    expect(
      contentReadAccess({
        userId: "u1",
        trusted: false,
        authenticatedScope: scope,
        userRoles: ["editor"],
      })
    ).toMatchObject({
      overrideAccess: false,
      user: { id: "u1", roles: ["editor"] },
      actor: scope,
    });
  });
});
