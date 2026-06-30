import { describe, expect, it } from "vitest";

import { resolveServiceOpts } from "./service-opts";

describe("resolveServiceOpts", () => {
  it("defaults to system when no as and no user", () => {
    expect(resolveServiceOpts({})).toEqual({ overrideAccess: true });
  });

  it("as:'system' → overrideAccess, no user", () => {
    expect(resolveServiceOpts({ as: "system" })).toEqual({
      overrideAccess: true,
    });
  });

  it("as:'user' with a user → enforce, RequestContext.user shape", () => {
    expect(
      resolveServiceOpts({
        as: "user",
        user: { id: "u1", email: "u@e.com", name: "U" },
      })
    ).toEqual({
      overrideAccess: false,
      user: { id: "u1", email: "u@e.com", role: "", permissions: [] },
    });
  });

  it("a user without explicit as is treated as as:'user'", () => {
    expect(
      resolveServiceOpts({ user: { id: "u1", email: "u@e.com" } })
    ).toMatchObject({
      overrideAccess: false,
      user: { id: "u1" },
    });
  });

  it("as:'user' without a user throws", () => {
    expect(() => resolveServiceOpts({ as: "user" })).toThrow();
  });
});
