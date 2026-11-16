/**
 * The pages search names where a page stands by the admin's own rule, so the
 * Pages panel and the entry header call one page one thing.
 *
 * The admin's rule (`pillStateFromForm`) is a browser export; the search runs
 * on the server and cannot import it, so `pageStateOf` restates its two facts.
 * This holds the two together, case by case: a rule changed on one side and
 * not the other fails here, rather than drifting in silence.
 *
 * @module pages-state.test
 */
import { PILL_LABEL, pillStateFromForm } from "@nextlyhq/plugin-sdk/admin";
import { describe, expect, it } from "vitest";

import { pageStateOf } from "./pages-search-route";

describe("a page's state, by the admin's status pill", () => {
  it("agrees with pillStateFromForm on every status and working draft", () => {
    for (const status of ["draft", "published"] as const) {
      for (const hasWorkingDraft of [false, true]) {
        // A plainly published page carries no state; the pill calls it
        // published.
        expect(pageStateOf(status, hasWorkingDraft, false) ?? "published").toBe(
          pillStateFromForm(status, false, hasWorkingDraft)
        );
      }
    }
  });

  it("names a state the pill has a word for, scheduled aside", () => {
    for (const status of ["draft", "published"] as const) {
      for (const hasWorkingDraft of [false, true]) {
        const state = pageStateOf(status, hasWorkingDraft, false);
        if (state !== undefined) expect(PILL_LABEL).toHaveProperty(state);
      }
    }
  });

  it("calls a page a scheduled release will publish scheduled, whatever else holds", () => {
    expect(pageStateOf("draft", false, true)).toBe("scheduled");
    expect(pageStateOf("published", true, true)).toBe("scheduled");
    expect(pageStateOf("published", false, true)).toBe("scheduled");
    // And nothing for a page without the lifecycle.
    expect(pageStateOf(undefined, true, true)).toBeUndefined();
  });
});
