/**
 * Whether a Direct API call carries an acting identity.
 *
 * `DirectAPIConfig.user` is how a caller says who an operation is for — it is
 * required whenever `overrideAccess` is false. Forwarding it is what lets a
 * write through this API be attributed like one through the admin, instead of
 * the audit trail silently covering one supported surface and not the other.
 */

import { describe, expect, it } from "vitest";

import { directApiActor } from "../helpers";

describe("the actor a Direct API call carries", () => {
  it("is the user named on the operation", () => {
    expect(directApiActor({}, { user: { id: "user-1" } })).toEqual({
      type: "user",
      id: "user-1",
    });
  });

  it("falls back to the instance default", () => {
    expect(directApiActor({ user: { id: "default-user" } }, {})).toEqual({
      type: "user",
      id: "default-user",
    });
  });

  it("lets one call act as someone else without reconfiguring the instance", () => {
    // Matches `mergeConfig`: per-operation config wins over the default.
    expect(
      directApiActor(
        { user: { id: "default-user" } },
        { user: { id: "other" } }
      )
    ).toEqual({ type: "user", id: "other" });
  });

  it("is absent when nobody is named", () => {
    // Absent means absent. A call naming nobody records nothing, rather than
    // attributing a credential change to a placeholder identity.
    expect(directApiActor({}, {})).toBeUndefined();
  });

  it("is absent when the user carries no id", () => {
    // The control for the guard: a `user` present but unidentifiable is still
    // nobody, and an entry keyed on an empty id would be worse than none.
    expect(directApiActor({}, { user: { id: "" } })).toBeUndefined();
  });
});
