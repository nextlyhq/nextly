import { describe, expect, it } from "vitest";

import { redirectOptionState } from "./FormSettingsTab";

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
    stored: boolean,
    collections: string[] | null,
    configFailed = false
  ) => redirectOptionState({ stored, collections, configFailed });

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
});
