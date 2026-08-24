/**
 * Reading an app-supplied draft decision as runtime input.
 *
 * `SingleDraftGrant` is what the hook is DECLARED to return, and a declared
 * type is not a runtime guarantee — the hook is application code. Every case
 * below is a value the type says cannot arrive, which is exactly why they are
 * worth pinning: the cost of getting one wrong is a non-identity forwarded into
 * a trusted read and judged as an identity.
 */
import { describe, expect, it } from "vitest";

import { normalizeSingleDraftGrant } from "../single-route";

describe("normalizeSingleDraftGrant", () => {
  it("refuses on the falsy answers, including the ones the type forbids", () => {
    expect(normalizeSingleDraftGrant(false)).toBeNull();
    // A JavaScript hook that falls off the end, or returns null to mean "no".
    expect(normalizeSingleDraftGrant(undefined)).toBeNull();
    expect(normalizeSingleDraftGrant(null)).toBeNull();
  });

  it("grants without an identity on a bare true", () => {
    // The route mounted behind the application's own auth: every visitor is
    // already entitled to the draft, so it names nobody and judges by nobody.
    expect(normalizeSingleDraftGrant(true)).toEqual({});
  });

  it("carries an identity when the grant names one", () => {
    const readAs = { id: "u1", roles: ["editor"] };

    expect(normalizeSingleDraftGrant({ readAs })).toEqual({ readAs });
  });

  // An OBJECT grant is a hook trying to name someone. One that failed to name
  // anyone must REFUSE, not fall back to the empty grant: an empty grant means
  // "trusted read, judged by nobody", which hands back the working draft with
  // every field — the disclosure this path exists to close. The empty grant is
  // reserved for a literal `true`, where the application has said so.
  //
  // `typeof null === "object"`, so the obvious check is the wrong one.
  it("refuses an object grant whose readAs is null", () => {
    expect(normalizeSingleDraftGrant({ readAs: null })).toBeNull();
  });

  it("refuses an object grant naming nobody", () => {
    expect(normalizeSingleDraftGrant({})).toBeNull();
  });

  it("refuses an object grant whose readAs is not an object", () => {
    // A hook returning the sharer's ID rather than their context. Forwarded, a
    // string would be judged as a user object whose every property is absent —
    // and absence can ALLOW, not merely strip.
    expect(normalizeSingleDraftGrant({ readAs: "user-1" })).toBeNull();
    expect(normalizeSingleDraftGrant({ readAs: 42 })).toBeNull();
  });

  it("refuses a non-object, non-boolean answer outright", () => {
    // Neither a grant nor a refusal in the declared type. Treated as a refusal
    // rather than as an empty grant: a hook answering nonsense has not
    // authorized anything, and a draft is the expensive direction to guess in.
    expect(normalizeSingleDraftGrant("yes")).toBeNull();
    expect(normalizeSingleDraftGrant(1)).toBeNull();
  });
});
