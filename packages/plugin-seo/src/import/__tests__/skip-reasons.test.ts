/**
 * The reasons the import's report gives for a page it skips. A value a
 * page's code overrides is described by what the plugin knows now, never as
 * one that was never served: the plugin can't know what a page showed before
 * it was installed.
 */
import { describe, expect, it } from "vitest";

import { SKIPPED } from "../plan";

describe("the import's skip reasons", () => {
  it("never claim a value was never served", () => {
    for (const reason of Object.values(SKIPPED)) {
      expect(reason).not.toMatch(/never served|never reached/i);
    }
  });

  it("say the page's code sets its own value now, and when to include it", () => {
    expect(SKIPPED.neverServed).toBe(
      "The page's code sets its own value now, so importing this one would change what the page shows. Include it if the page showed it before and should again."
    );
  });
});
