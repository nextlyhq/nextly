/**
 * The own robots.txt rules as stored: the Content-Signal tick is kept with
 * them as a boolean, with or without lines in the box, and anything else in
 * its place is refused, so a value edited past the screen never adds a line
 * no one ticked.
 */
import { describe, expect, it } from "vitest";

import {
  robotsRulesProblem,
  storedRobotsRulesOf,
} from "../robots-rules-stored";

describe("the Content-Signal tick, stored with the own rules", () => {
  it("is kept where ticked, with an empty box", () => {
    const value = { text: "", contentSignal: true };
    expect(robotsRulesProblem(value)).toBeNull();
    expect(storedRobotsRulesOf(value)).toEqual({ rules: value });
  });

  it("is kept beside the box's lines and their confirmation", () => {
    const value = {
      text: "User-agent: *\nDisallow: /blog",
      confirmed: { text: "User-agent: *\nDisallow: /blog", pages: "3:bb" },
      contentSignal: true,
    };
    expect(storedRobotsRulesOf(value)).toEqual({ rules: value });
  });

  it("is refused as anything but a boolean", () => {
    const value = { text: "", contentSignal: "yes" };
    expect(robotsRulesProblem(value)).not.toBeNull();
    expect(storedRobotsRulesOf(value).rules).toBeUndefined();
  });
});
