import { describe, expect, it } from "vitest";

import {
  formAvailability,
  GENERIC_REFUSAL,
  NO_SUCH_FORM,
} from "../form-availability";

const live = { status: "published", wentLiveAt: "2026-01-01T00:00:00Z" };

describe("formAvailability - what a visitor is told", () => {
  it("opens a published form", () => {
    expect(formAvailability(live)).toEqual({ kind: "open" });
  });

  it("opens a form published before the stamp existed", () => {
    // Every form already live when this shipped has no `wentLiveAt`.
    // Requiring one to serve a PUBLISHED form would take all of them offline
    // at once — the stamp qualifies `closed`, and nothing else.
    expect(formAvailability({ status: "published" })).toEqual({ kind: "open" });
  });

  it("relays the author's message for a form that was live and is now closed", () => {
    expect(
      formAvailability({
        status: "closed",
        wentLiveAt: "2026-01-01T00:00:00Z",
        closedMessage: "Applications closed on 31 March.",
      })
    ).toEqual({ kind: "closed", message: "Applications closed on 31 March." });
  });

  it("falls back to the generic sentence when a closed form carries no message", () => {
    const answer = formAvailability({
      status: "closed",
      wentLiveAt: "2026-01-01T00:00:00Z",
    });
    expect(answer).toEqual({ kind: "closed", message: GENERIC_REFUSAL });
  });

  it("treats whitespace as no message", () => {
    expect(
      formAvailability({
        status: "closed",
        wentLiveAt: "2026-01-01T00:00:00Z",
        closedMessage: "   \n  ",
      })
    ).toEqual({ kind: "closed", message: GENERIC_REFUSAL });
  });
});

describe("formAvailability - forms that were never public", () => {
  it("hides a closed form that was never published", () => {
    // The reported hole: `closed` is accepted on creation, so it did not
    // establish that the form had ever been public. A guessed slug returned
    // the whole document.
    expect(
      formAvailability({
        status: "closed",
        closedMessage: "Applications closed on 31 March.",
      })
    ).toEqual({ kind: "absent", reason: "never-published" });
  });

  it("hides a draft", () => {
    expect(formAvailability({ status: "draft" })).toEqual({
      kind: "absent",
      reason: "never-published",
    });
  });

  it("hides a row written before the stamp existed", () => {
    expect(formAvailability({ status: "closed", wentLiveAt: null })).toEqual({
      kind: "absent",
      reason: "never-published",
    });
  });

  it("answers a missing form the same way, and says which for the log only", () => {
    expect(formAvailability(undefined)).toEqual({
      kind: "absent",
      reason: "no-such-form",
    });
    // Both are `absent`, so no caller can tell a visitor them apart.
    expect(formAvailability(null).kind).toBe(
      formAvailability({ status: "draft" }).kind
    );
  });
});

describe("the sentence a hidden form is answered with", () => {
  // Every path's assertion is bound to this constant rather than repeating it,
  // which is what makes the four provably equal — and leaves nothing pinning
  // the text itself. Emptying it would keep all of them green.
  it("says something", () => {
    expect(NO_SUCH_FORM.trim().length).toBeGreaterThan(0);
  });

  it("says nothing about why", () => {
    // The whole point of answering a draft, a never-released form and an unused
    // slug identically is that the answer cannot distinguish them. A sentence
    // naming any of those states would put the distinction back into the text
    // after the code had removed it.
    const leaks = ["draft", "closed", "publish", "unpublish", "not accepting"];
    for (const word of leaks) {
      expect(NO_SUCH_FORM.toLowerCase()).not.toContain(word);
    }
  });
});
