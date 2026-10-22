/**
 * A refusal that opens nothing is a Save button that does nothing.
 *
 * The Details sheet opens on demand, so the message for a field it owns does
 * not exist in the DOM while it is closed. `handleSubmit` still refuses, and the author
 * sees no error and no reason.
 */
import { describe, expect, it } from "vitest";

import { regionsForRefusal } from "../refusal-routing";

describe("regionsForRefusal", () => {
  it("opens Details for a field whose message only renders there", () => {
    // A declared variable left without a name: rejected by the schema, and
    // its message renders only inside the Details panel.
    expect(regionsForRefusal(["variables"]).details).toBe(true);
  });

  it("leaves it closed for a field the envelope already shows", () => {
    // The control. Without it, a router that opened Details on ANY refusal
    // would pass the test above just as well, and would then take the place of
    // the subject the author actually has to fix on a tablet.
    expect(regionsForRefusal(["subject"]).details).toBe(false);
    expect(regionsForRefusal(["htmlContent"]).details).toBe(false);
  });

  it("opens it when a refusal names both, since only one of them is visible", () => {
    expect(regionsForRefusal(["subject", "variables"]).details).toBe(true);
  });

  it("opens Details for the copies and the description", () => {
    expect(regionsForRefusal(["cc"]).details).toBe(true);
    expect(regionsForRefusal(["bcc"]).details).toBe(true);
    expect(regionsForRefusal(["description"]).details).toBe(true);
  });

  it("names the editor for the envelope and body fields", () => {
    for (const field of ["subject", "preheader", "htmlContent", "replyTo"]) {
      expect(regionsForRefusal([field]).content).toBe(true);
    }
    // The control: a Details field isn't the editor's.
    expect(regionsForRefusal(["cc"]).content).toBe(false);
  });

  it("opens nothing when nothing was rejected", () => {
    expect(regionsForRefusal([]).details).toBe(false);
  });
});
