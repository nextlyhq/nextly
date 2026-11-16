/**
 * Where a site widget's component is resolved from: relative to the config
 * file, or a package, and never a path alias nothing that writes or checks the
 * component map resolves.
 */
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import { siteComponentProblem } from "../site-component";
import { widgetDeclarationFaults } from "../validate";

/**
 * The object the widgets guide hands `defineWidget` in its site widget example, read from the
 * page itself rather than copied here, so the test and the page cannot come to show two objects.
 * The literal is plain JavaScript, so it is evaluated as written.
 */
function documentedSiteWidget(): Record<string, unknown> {
  const page = readFileSync(
    new URL("../../../../../../../docs/widgets/index.mdx", import.meta.url),
    "utf-8"
  );
  const literal = /const notes = defineWidget\((\{[\s\S]*?\n\})\);/.exec(
    page
  )?.[1];
  if (literal === undefined) {
    throw new Error(
      "the widgets guide no longer shows the site widget example"
    );
  }
  return runInNewContext(`(${literal})`) as Record<string, unknown>;
}

describe("a site widget's component", () => {
  it.each([
    "./dashboard/revenue#Revenue",
    "../shared/cards#Totals",
    "./dashboard/notes",
    "@acme/cards/admin#Revenue",
    "acme-cards#Revenue",
  ])("may name %s", component => {
    expect(siteComponentProblem(component)).toBeUndefined();
  });

  it.each([
    ["@/dashboard/revenue#Revenue", "./dashboard/revenue#Revenue"],
    ["~/dashboard/revenue#Revenue", "./dashboard/revenue#Revenue"],
    ["/abs/dashboard/revenue#Revenue", "./abs/dashboard/revenue#Revenue"],
    ["@/dashboard/notes", "./dashboard/notes#default"],
  ])("may not name %s, and is told to write %s", (component, instead) => {
    expect(siteComponentProblem(component)).toBe(
      `view.component "${component}" names a module the component map cannot resolve: write it relative to the config file: ${instead}`
    );
  });
});

describe("the widgets guide's site widget example", () => {
  it("is a declaration startup accepts as written", () => {
    const widget = documentedSiteWidget();
    expect(widgetDeclarationFaults(widget, "the site config")).toEqual([]);
    expect(
      siteComponentProblem((widget.view as { component: string }).component)
    ).toBeUndefined();
  });
});
