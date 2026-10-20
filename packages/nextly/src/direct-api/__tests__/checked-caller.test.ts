/**
 * The caller a checked Direct API call is judged as is the caller REST would
 * judge: for an API key, its whole scope, never its owner's.
 *
 * Asserted by round trip through `apiKeyScopeFrom`, the conversion REST uses
 * from an authenticated caller to its scope: the scope a call names must come
 * back unchanged, grants and the key's own roles included. A caller built from
 * the key's permissions alone, or from its owner's roles, would not.
 */
import { describe, expect, it } from "vitest";

import { apiKeyScope, apiKeyScopeFrom } from "../../auth/authenticated-scope";
import { checkedCaller } from "../namespaces/helpers";

const KEY = apiKeyScope(
  [
    { slug: "read-posts", action: "read", resource: "posts" },
    { slug: "update-roles", action: "update", resource: "roles" },
  ],
  ["key-role"]
);

describe("checkedCaller", () => {
  it("judges an API key by its whole scope, as REST does", () => {
    const caller = checkedCaller(
      {},
      {
        overrideAccess: false,
        user: { id: "owner", roles: ["owner-role"] },
        actor: KEY,
      }
    );
    expect(caller?.authMethod).toBe("api-key");
    expect(caller?.userId).toBe("owner");
    // The key's own roles, not its owner's.
    expect(caller?.roles).toEqual(["key-role"]);
    expect(apiKeyScopeFrom(caller!)).toEqual(KEY);
  });

  it("judges a person as a signed-in session", () => {
    const caller = checkedCaller(
      { overrideAccess: false, user: { id: "person", roles: ["editor"] } },
      {}
    );
    expect(caller).toEqual({
      userId: "person",
      authMethod: "session",
      permissions: [],
      roles: ["editor"],
    });
  });

  it("is null for a trusted call, the instance's default", () => {
    expect(checkedCaller({}, {})).toBeNull();
    expect(
      checkedCaller({ overrideAccess: false }, { overrideAccess: true })
    ).toBeNull();
  });

  it("keeps the instance's request to be checked when a call passes undefined", () => {
    expect(
      checkedCaller(
        { overrideAccess: false, user: { id: "person" } },
        { overrideAccess: undefined }
      )?.userId
    ).toBe("person");
  });

  it("refuses a checked call that names nobody", () => {
    expect(() => checkedCaller({ overrideAccess: false }, {})).toThrow(
      expect.objectContaining({ code: "AUTH_REQUIRED" })
    );
  });

  it("drops the instance's key when a call names a person without one", () => {
    const caller = checkedCaller(
      { overrideAccess: false, user: { id: "owner" }, actor: KEY },
      { user: { id: "someone-else" } }
    );
    expect(caller?.authMethod).toBe("session");
    expect(caller?.userId).toBe("someone-else");
  });
});
