/**
 * Which colours "Clean up unused…" lists: the site's own colours the count
 * has shown unused, never a built-in one, never one the open page uses.
 */
import { describe, expect, it } from "vitest";

import { cleanUpCandidates } from "./colour-usage";
import type { UsageState } from "./variable-usage";

const STATES: Readonly<Record<string, UsageState>> = {
  primary: "unused",
  spare: "unused",
  extra: "unused",
  used: "used",
  counting: "counting",
  "on-page": "unused",
};

const colours = Object.keys(STATES).map(identity => ({ identity }));

const rule = {
  stateOf: (identity: string): UsageState => STATES[identity] ?? "counting",
  builtIn: (identity: string) => identity === "primary",
  onPage: new Set(["on-page"]),
};

describe("the colours a clean-up lists", () => {
  it("lists each colour the site made that nothing uses, in the order given", () => {
    expect(cleanUpCandidates(colours, rule).listed).toEqual([
      { identity: "spare" },
      { identity: "extra" },
    ]);
  });

  it("never lists a built-in colour, however unused", () => {
    expect(
      cleanUpCandidates(colours, rule).listed.map(entry => entry.identity)
    ).not.toContain("primary");
  });

  it("leaves out a colour the open page uses, though no save has said so yet", () => {
    expect(
      cleanUpCandidates(colours, { ...rule, onPage: undefined }).listed.map(
        entry => entry.identity
      )
    ).toContain("on-page");
    expect(
      cleanUpCandidates(colours, rule).listed.map(entry => entry.identity)
    ).not.toContain("on-page");
  });

  it("says when one of the site's own colours is still being counted", () => {
    expect(cleanUpCandidates(colours, rule).counting).toBe(true);
    expect(
      cleanUpCandidates(
        colours.filter(entry => entry.identity !== "counting"),
        rule
      ).counting
    ).toBe(false);
    // A built-in still counting holds nothing back: it is never listed.
    expect(
      cleanUpCandidates([{ identity: "primary" }], {
        ...rule,
        stateOf: () => "counting",
      }).counting
    ).toBe(false);
  });
});
