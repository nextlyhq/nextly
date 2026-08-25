import { describe, expect, it } from "vitest";

import { hasStoredRedirectPage, redirectOptionState } from "./FormSettingsTab";

/**
 * Which of four things the "Redirect to a page" option shows.
 *
 * Worth pinning because two of the four are indistinguishable on screen unless
 * this decision keeps them apart: a site that configures no redirect targets
 * and a configuration request that FAILED both arrive as an empty list, and
 * only one of them justifies telling an author "no collection is configured".
 */
describe("redirectOptionState", () => {
  const state = (
    hasStoredPage: boolean,
    collections: string[] | null,
    configFailed = false
  ) => redirectOptionState({ hasStoredPage, collections, configFailed });

  it("offers the option with choices when collections are configured", () => {
    expect(state(false, ["pages"])).toBe("ready");
    expect(state(true, ["pages"])).toBe("ready");
  });

  it("hides it when nothing is stored, configured, or unknown", () => {
    expect(state(false, [])).toBe("hidden");
    expect(state(false, null)).toBe("hidden");
  });

  it("keeps it for a form that already redirects to a page", () => {
    // The stored value is still posted on save, so hiding it lets an author
    // overwrite a destination they were never shown.
    expect(state(true, [])).toBe("stored-only");
    expect(state(true, null)).toBe("stored-only");
  });

  it("offers it as unknown when the configuration could not be read", () => {
    // An empty list is an answer; a failed read is not. Reporting the first
    // when the second happened states something false about the site.
    expect(state(false, [], true)).toBe("unknown");
  });

  it("prefers the stored value over the unknown state", () => {
    // A stored page is a fact about THIS form; the failed read is a fact about
    // the request. The form's own state is the more useful thing to show.
    expect(state(true, [], true)).toBe("stored-only");
  });

  it("prefers real choices over both", () => {
    expect(state(true, ["pages"], true)).toBe("ready");
  });

  it("asks whether a page is STORED, not whether the option is selected", () => {
    // Conflating the two let an author choose this option while the
    // configuration was unknown: the state flipped to `stored-only` with
    // nothing stored, so the picker had no collections to offer and the save
    // could only be refused. Selecting the option is not a stored page.
    expect(state(false, [], true)).toBe("unknown");
    expect(state(false, null, true)).toBe("unknown");
  });
});

describe("hasStoredRedirectPage", () => {
  /**
   * The call-site half of the same decision, and the half a break-verification
   * on `redirectOptionState` cannot reach: the pure function stayed correct
   * while the value handed to it was wrong.
   */
  it("is false when the option is selected but no page is named", () => {
    expect(hasStoredRedirectPage({})).toBe(false);
    expect(hasStoredRedirectPage({ redirectPage: undefined })).toBe(false);
    expect(hasStoredRedirectPage({ redirectPage: {} })).toBe(false);
    expect(
      hasStoredRedirectPage({ redirectPage: { relationTo: "pages" } })
    ).toBe(false);
  });

  it("is true only when a page is actually named", () => {
    expect(
      hasStoredRedirectPage({
        redirectPage: { relationTo: "pages", value: "p1" },
      })
    ).toBe(true);
  });

  it("counts a bare id, which is a valid stored shape", () => {
    // Valid when exactly one collection is configured. Asking
    // `parseRedirectReference` with no collections cannot resolve WHICH
    // document it is — but the question here is whether anything is stored,
    // and answering "no" hides the destination in exactly the states where the
    // author needs to see it: configuration failed, or the collection went
    // away.
    expect(hasStoredRedirectPage({ redirectPage: "pg1" })).toBe(true);
    expect(hasStoredRedirectPage({ redirectPage: "" })).toBe(false);
    expect(hasStoredRedirectPage({ redirectPage: "   " })).toBe(false);
  });

  it("reads a reference without needing the configuration", () => {
    // Configuration is exactly what may be missing when this is asked.
    expect(
      hasStoredRedirectPage({
        redirectPage: { relationTo: "retired", value: "r1" },
      })
    ).toBe(true);
  });
});
