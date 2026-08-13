/**
 * The rule both halves of the dead-class check ask.
 *
 * Tested here rather than through either caller, because the component and the
 * source scan share this module precisely so they cannot disagree about what
 * "inert" means — and a rule asserted twice, once per caller, is the drift this
 * arrangement exists to prevent.
 */
import { describe, expect, it } from "vitest";

import {
  baseUtility,
  decodeEntities,
  inertClassesFor,
  inertClassesIn,
} from "./inert-classes";

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

  it("allows a border colour beside any border spelling", () => {
    // Logical sides and arbitrary widths paint an edge exactly as `border-2`
    // does. Enumerating width spellings is what missed these, so the rule asks
    // whether any OTHER border utility is present rather than matching a list
    // of the ones that were thought of.
    expect(inertClassesIn("border-s border-input")).toEqual([]);
    expect(inertClassesIn("border-e border-border")).toEqual([]);
    expect(inertClassesIn("border-[3px] border-input")).toEqual([]);
    expect(inertClassesIn("border-t-[2px] border-border")).toEqual([]);
    // The logical zero widths paint nothing, same as the physical ones.
    expect(inertClassesIn("border-s-0 border-input")).toEqual(["border-input"]);
  });

  it("allows a background once the wrapper has a box to paint", () => {
    // The input fills the wrapper's content box, so with no padding the
    // background is covered entirely. Padding makes it a visible frame around
    // the field, which is a caller asking for something real.
    expect(inertClassesIn("p-2 bg-background")).toEqual([]);
    expect(inertClassesIn("px-4 bg-background")).toEqual([]);
    expect(inertClassesIn("ps-2 bg-background")).toEqual([]);
    expect(inertClassesIn("p-[10px] bg-background")).toEqual([]);
    // Padding does not excuse the other two: no text renders in the padding,
    // and the wrapper still paints no edge.
    expect(inertClassesIn("p-2 text-foreground")).toEqual(["text-foreground"]);
    expect(inertClassesIn("p-2 border-input")).toEqual(["border-input"]);
    // A class that merely starts with `p` is not padding.
    expect(inertClassesIn("pointer-events-none bg-background")).toEqual([
      "bg-background",
    ]);
    // Zero padding adds no box, so the field still covers the wrapper exactly
    // and the background is back in the inert case -- the same relationship
    // `border-0` has to a border colour.
    expect(inertClassesIn("p-0 bg-background")).toEqual(["bg-background"]);
    expect(inertClassesIn("px-0 bg-background")).toEqual(["bg-background"]);
    expect(inertClassesIn("ps-0 bg-background")).toEqual(["bg-background"]);
    // Real padding on another axis still paints, so the pair is allowed.
    expect(inertClassesIn("px-0 py-2 bg-background")).toEqual([]);
  });

  it("leaves an unparseable character reference alone", () => {
    // This runs inside the development effect, so a throw here takes the
    // component down rather than warning about it. A code point outside
    // Unicode's range must therefore come back as written.
    expect(() => decodeEntities("&#99999999;")).not.toThrow();
    expect(decodeEntities("&#99999999;")).toBe("&#99999999;");
    expect(decodeEntities("&#xFFFFFFFF;")).toBe("&#xFFFFFFFF;");
    // The valid neighbours still decode, so the guard did not simply stop
    // decoding altogether -- which would pass the assertions above.
    expect(decodeEntities("&#45;")).toBe("-");
    expect(decodeEntities("&#x2D;")).toBe("-");
    expect(inertClassesIn("border&#99999999;input")).toEqual([]);
  });

  it("judges the class the element actually receives", () => {
    // `cn` drops the loser of a conflict, so a discarded token never reaches
    // the DOM and naming it would describe markup that was never rendered.
    expect(inertClassesFor("border-input border-destructive")).toEqual([]);
    expect(inertClassesFor("bg-background bg-primary")).toEqual([]);
    expect(inertClassesFor("text-foreground text-primary")).toEqual([]);
    // The surviving token is still reported when it is the inert one.
    expect(inertClassesFor("border-destructive border-input")).toEqual([
      "border-input",
    ]);
    // And the wrapper's own classes do not themselves trigger anything.
    expect(inertClassesFor(undefined)).toEqual([]);
    expect(inertClassesFor("w-full")).toEqual([]);
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
