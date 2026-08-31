/**
 * A refusal that opens nothing is a Save button that does nothing.
 *
 * The inspector is summoned, so the message for a field it owns does not exist
 * in the DOM while it is closed. `handleSubmit` still refuses, and the author
 * sees no error and no reason.
 */
import { describe, expect, it } from "vitest";

import { regionsForRefusal } from "../refusal-routing";

describe("regionsForRefusal", () => {
  it("opens the inspector for a field whose message only renders there", () => {
    // The reported case: a declared variable left without a name.
    expect(regionsForRefusal(["variables"]).inspector).toBe(true);
  });

  it("leaves it closed for a field the envelope already shows", () => {
    // The control. Without it, a router that opened the inspector on ANY
    // refusal would pass the test above just as well — and would then open a
    // settings panel over the subject the author actually has to fix.
    expect(regionsForRefusal(["subject"]).inspector).toBe(false);
    expect(regionsForRefusal(["htmlContent"]).inspector).toBe(false);
  });

  it("opens it when a refusal names both, since only one of them is visible", () => {
    expect(regionsForRefusal(["subject", "variables"]).inspector).toBe(true);
  });

  it("opens nothing when nothing was rejected", () => {
    expect(regionsForRefusal([]).inspector).toBe(false);
  });
});
