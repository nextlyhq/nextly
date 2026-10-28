/**
 * Where a site widget's component is resolved from: relative to the config
 * file, or a package, and never a path alias nothing that writes or checks the
 * component map resolves.
 */
import { describe, expect, it } from "vitest";

import { siteComponentProblem } from "../site-component";

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
