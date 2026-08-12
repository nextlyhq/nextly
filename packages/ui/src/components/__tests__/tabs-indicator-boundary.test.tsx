/**
 * The indicator survives a call site trying to override it, by ANY route.
 *
 * `tabs-contract.test.ts` scans source text, and text can only see the routes it
 * was written for. A class reaching `className` through an identifier, a spread,
 * or an aliased import is invisible to it — measured, not assumed: both of those
 * first two escaped the scan while still overriding the underline.
 *
 * So the boundary is not the scan. It is the MERGE ORDER: `cn()` resolves
 * through tailwind-merge, and the primitive puts its indicator classes after
 * `className`, so the last class on each property is the primitive's. That acts
 * on the resolved value rather than on the text that produced it, which is why
 * it holds for routes nobody enumerated.
 *
 * These assert the resolved `class` attribute, because that is the thing the
 * browser reads. Asserting the source would be testing the input to the question
 * rather than its answer.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Tabs, TabsList, TabsTrigger } from "../tabs";

/**
 * The trigger's resolved class list, taken from rendered markup.
 *
 * Rendered rather than reading the source constants, and server-rendered rather
 * than through a DOM: this package renders nothing else in tests, so a DOM
 * environment and a testing-library dependency would be new machinery for one
 * assertion. `renderToStaticMarkup` runs the real component and the real `cn()`,
 * which is the whole mechanism under test.
 */
function triggerClassesFor(className?: string): string[] {
  const html = renderToStaticMarkup(
    <Tabs defaultValue="a">
      <TabsList>
        <TabsTrigger value="a" className={className}>
          A
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
  const trigger = /data-slot="tabs-trigger"[^>]*/.exec(html)?.[0] ?? "";
  const classAttr = /class="([^"]*)"/.exec(trigger)?.[1] ?? "";
  return classAttr.split(/\s+/).filter(Boolean);
}

describe("the tab indicator boundary", () => {
  it("keeps the underline when a call site passes no className", () => {
    // The instrument control. Every assertion below is "the primitive's class
    // is present"; if the component rendered nothing, or the query missed, they
    // would all fail for a reason unrelated to overriding.
    const classes = triggerClassesFor();
    expect(classes).toContain("border-b-2!");
    expect(classes).toContain("rounded-none!");
  });

  it.each([
    ["a corner", "rounded-md", "rounded-none!"],
    ["the underline width", "border-b-0", "border-b-2!"],
    ["the underline offset", "mb-4", "-mb-0.5!"],
    // The important forms. tailwind-merge groups by importance, so an
    // unimportant protected utility loses to a caller's `!` no matter how late
    // it sits in the merge — these are the cases that ordering alone missed.
    ["an important corner", "rounded-md!", "rounded-none!"],
    ["an important underline width", "border-b-0!", "border-b-2!"],
    ["an important offset", "mb-4!", "-mb-0.5!"],
  ])("overrides %s passed by a call site", (_label, attempted, expected) => {
    // The route is irrelevant to the mechanism: by the time `cn()` runs, an
    // identifier, a spread and a literal are the same string. This passes a
    // literal because that is the readable form, and the boundary is the merge
    // order rather than the syntax.
    const classes = triggerClassesFor(attempted);
    // The primitive's declaration is present and important, so it wins — that
    // is the property, and it is what the browser resolves.
    expect(classes).toContain(expected);
    // An UNIMPORTANT attempt may still sit in the string; it simply loses to an
    // important declaration. An IMPORTANT one lands in the same tailwind-merge
    // group and is dropped outright. Asserting absence in both cases would be
    // asserting a mechanism rather than the outcome.
    if (attempted.endsWith("!")) {
      expect(classes).not.toContain(attempted);
    }
  });

  it("still lets a call site change layout", () => {
    // The complement, and the reason this is a merge order rather than a filter.
    // A tab strip in a dialog is a different shape from one in a sheet, so size
    // and width stay the surface's to decide.
    const classes = triggerClassesFor("w-full px-0");
    expect(classes).toContain("w-full");
    expect(classes).toContain("px-0");
    expect(classes).not.toContain("px-4");
    // ...while the indicator is untouched by that same className.
    expect(classes).toContain("border-b-2!");
  });

  it("drops an inline style aimed at the indicator, and keeps the rest", () => {
    // The route no class ordering can close: an inline declaration beats every
    // class, important or not. Stripped from the resolved object rather than
    // scanned for in source, so a spread, an alias or a value built in another
    // module all converge here.
    const html = renderToStaticMarkup(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger
            value="a"
            style={{ borderBottomColor: "red", opacity: 0.5 }}
          >
            A
          </TabsTrigger>
        </TabsList>
      </Tabs>
    );
    const trigger = /data-slot="tabs-trigger"[^>]*/.exec(html)?.[0] ?? "";
    const style = /style="([^"]*)"/.exec(trigger)?.[1] ?? "";
    expect(style).not.toContain("border-bottom-color");
    // The complement: only the indicator is owned, so an unrelated declaration
    // survives. Without this the strip could be deleting everything and pass.
    expect(style).toContain("opacity");
  });
});
