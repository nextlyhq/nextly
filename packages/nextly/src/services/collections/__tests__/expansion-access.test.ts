/**
 * The upload expansion decides whether to narrow a media row from four fields,
 * and every one of them is optional. An incomplete context is therefore a VALID
 * context describing a DIFFERENT caller, which is why getting it wrong is
 * silent: `overrideAccess` missing, or `trusted` bound to undefined, and the
 * bound stops applying while the code still reads as though it carries one.
 *
 * Two earlier attempts checked the call SOURCE for those field names. Neither
 * could separate a correct binding from `trusted: undefined`, because both
 * spell the same text. So the assembly is a function now, and this measures
 * what it produces.
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
