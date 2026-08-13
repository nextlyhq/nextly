/**
 * The rule both halves of the dead-class check ask.
 *
 * Tested here rather than through either caller, because the component and the
 * source scan share this module precisely so they cannot disagree about what
 * "inert" means — and a rule asserted twice, once per caller, is the drift this
 * arrangement exists to prevent.
 */
import { describe, expect, it } from "vitest";

import { baseUtility, decodeEntities, inertClassesIn } from "./inert-classes";

describe("inert classes", () => {
  it("names a field-only class", () => {
    expect(inertClassesIn("w-full border-input")).toEqual(["border-input"]);
    expect(inertClassesIn("bg-background")).toEqual(["bg-background"]);
    expect(inertClassesIn("text-foreground")).toEqual(["text-foreground"]);
  });

  it("leaves layout classes alone", () => {
    // The negative half: a rule that reported everything would satisfy every
    // assertion above and be useless.
    expect(inertClassesIn("w-full max-w-sm flex-1")).toEqual([]);
    expect(inertClassesIn("")).toEqual([]);
  });

  it("sees through variants and reports the class as written", () => {
    // A variant says WHEN a utility applies, not what it does — and these are
    // the spellings an author reaches for once the plain one appears inert.
    expect(inertClassesIn("hover:border-input")).toEqual([
      "hover:border-input",
    ]);
    expect(inertClassesIn("md:dark:border-input")).toEqual([
      "md:dark:border-input",
    ]);
    expect(inertClassesIn("!border-input")).toEqual(["!border-input"]);
    // Reported AS WRITTEN, so the message names something searchable.
    expect(baseUtility("md:dark:!border-input")).toBe("border-input");
  });

  it("reads the class the browser reads", () => {
    // Reported decoded, because that is the class that renders. Variants
    // survive intact; only the reference is resolved.
    expect(inertClassesIn("border&#45;input")).toEqual(["border-input"]);
    expect(decodeEntities("border&#45;input")).toBe("border-input");
    expect(decodeEntities("a&amp;b")).toBe("a&b");
  });

  it("allows a border colour once the wrapper has a border", () => {
    // The case that matters most, because getting it wrong rejects CORRECT
    // code: `border-border` is dead only while nothing paints an edge on the
    // wrapper. With a width utility present the caller has deliberately drawn
    // one and the colour is doing exactly what they asked.
    expect(inertClassesIn("border border-border")).toEqual([]);
    expect(inertClassesIn("border-2 border-input")).toEqual([]);
    expect(inertClassesIn("border-t border-border")).toEqual([]);
    // Without a width it is still dead.
    expect(inertClassesIn("border-border")).toEqual(["border-border"]);
    // And a width utility does not excuse a non-border class.
    expect(inertClassesIn("border bg-background")).toEqual(["bg-background"]);
  });

  it("does not treat a zero width as a painted border", () => {
    // `border-0` IS a width utility and paints nothing, so a colour beside it
    // is back in the inert case the exemption exists to carve out. The
    // exemption has to ask whether an edge is DRAWN, not whether a
    // width-shaped class is present.
    expect(inertClassesIn("border-0 border-input")).toEqual(["border-input"]);
    expect(inertClassesIn("border-x-0 border-border")).toEqual([
      "border-border",
    ]);
    // A real width alongside a zero one still paints on the other sides.
    expect(inertClassesIn("border-x-0 border-y border-input")).toEqual([]);
  });

  it("sees through an opacity modifier", () => {
    // `border-input/50` still emits a border colour; the modifier says how
    // much, the way a variant says when.
    expect(inertClassesIn("border-input/50")).toEqual(["border-input/50"]);
    expect(inertClassesIn("hover:border-input/50")).toEqual([
      "hover:border-input/50",
    ]);
    expect(inertClassesIn("bg-background/[0.4]")).toEqual([
      "bg-background/[0.4]",
    ]);
    expect(baseUtility("hover:border-input/50")).toBe("border-input");
  });
});
