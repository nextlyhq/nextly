/**
 * `expansionAccess` builds the context an upload expansion runs under, from the
 * options its caller already holds.
 *
 * Every field it forwards is optional, and each decides something different:
 * `overrideAccess` and `trusted` together decide whether a media row is
 * narrowed at all, while `user` and `authenticatedScope` decide whether an
 * authorized caller keeps the row a bound would otherwise strip. An object
 * missing any of them is still a VALID context — it simply describes a
 * different caller — so the forwarding cannot be checked by reading the shape
 * of the call and is measured here on what the helper produces.
 */
import { describe, expect, it } from "vitest";

import { applyMediaTrustBound, expansionAccess } from "../trust-bound";

const CALLER = {
  user: { id: "u1" },
  overrideAccess: true,
  trusted: (name: string) => name === "posts",
  authenticatedScope: {
    actorType: "apiKey" as const,
    permissions: ["read-posts"],
  },
};

describe("the access an expansion runs under", () => {
  it("forwards every field that decides whether media is narrowed", () => {
    const access = expansionAccess(CALLER);

    expect(access.user).toBe(CALLER.user);
    expect(access.overrideAccess).toBe(true);
    expect(access.trusted).toBe(CALLER.trusted);
    expect(access.authenticatedScope).toBe(CALLER.authenticatedScope);
  });

  it("narrows a media row for the caller it was built from", () => {
    // The property the field-by-field check above stands for, measured on the
    // real decision rather than on the shape of its input: this caller holds a
    // bypass bounded to `posts`, so media is refused and its ownership and
    // filing come off.
    //
    // This covers the helper, NOT the seam between a Single read or write and
    // it. A call site substituting a different context of its own would keep
    // this green; only exercising the production read/write path can separate
    // those.
    const rows = [
      { id: "m1", url: "/u.png", uploadedBy: "u9", folderId: "f1" },
    ];

    return applyMediaTrustBound(rows, expansionAccess(CALLER)).then(([row]) => {
      expect(row).not.toHaveProperty("uploadedBy");
      expect(row).not.toHaveProperty("folderId");
      expect(row).toHaveProperty("url");
    });
  });

  it("leaves the row whole for a caller that bounded nothing", () => {
    // The positive control. Without it, a function returning an empty context
    // would satisfy the test above — an empty context refuses nothing, but it
    // also narrows nothing, and only one of those is visible in the result.
    const rows = [{ id: "m1", url: "/u.png", uploadedBy: "u9" }];

    return applyMediaTrustBound(
      rows,
      expansionAccess({ overrideAccess: true, trusted: undefined })
    ).then(([row]) => {
      expect(row).toHaveProperty("uploadedBy");
    });
  });
});
