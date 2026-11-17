/**
 * The settings Single's guard, as a write that bypasses the make-default
 * route meets it: refused, with words naming the one place the default is
 * set.
 *
 * The hooks are taken from the Single's own declaration, so the test reaches
 * the guard the site runs rather than a copy of it.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_LAYOUT_WRITE_CONTEXT,
  pageBuilderSettingsSingle,
} from "./settings-single";

type Hook = (hook: { context?: Record<string, unknown> }) => void;

/** The Single's pre-write hooks, both phases. */
function guards(): Hook[] {
  const hooks = (
    pageBuilderSettingsSingle() as {
      hooks?: { beforeValidate?: Hook[]; beforeChange?: Hook[] };
    }
  ).hooks;
  return [...(hooks?.beforeValidate ?? []), ...(hooks?.beforeChange ?? [])];
}

describe("a write to the site default that bypasses the route", () => {
  it("is refused, saying where the site default is set", () => {
    expect(guards()).toHaveLength(2);
    for (const guard of guards()) {
      expect(() => guard({})).toThrow(
        "The site default is set from the Header & footer list, with Make site default."
      );
    }
  });

  it("lets the route's own marked write through", () => {
    for (const guard of guards()) {
      expect(() =>
        guard({ context: { ...DEFAULT_LAYOUT_WRITE_CONTEXT } })
      ).not.toThrow();
    }
  });
});
