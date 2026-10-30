/**
 * The site config's `overrides`, as every reading of a widget takes them: one
 * application, whatever shape the widget states its settings in.
 */
import { describe, expect, it } from "vitest";

import { withSiteOverride, type SiteDashboardRules } from "../site-rules";

const rules = (
  overrides: SiteDashboardRules["overrides"]
): SiteDashboardRules => ({
  hidden: new Set(),
  replaced: new Map(),
  alternatives: new Set(),
  overrides,
});

const widget = {
  id: "core/recent-activity",
  title: "Recent activity",
  description: "What changed",
  size: {
    default: { w: 6, h: 5 },
    min: { w: 4, h: 4 },
    max: { w: 12, h: 8 },
  },
  settings: [
    { name: "limit", type: "number", defaultValue: 10 },
    { name: "density", type: "select", defaultValue: "comfortable" },
  ],
};

describe("a site override", () => {
  const overridden = rules(
    new Map([
      [
        "core/recent-activity",
        {
          title: "Latest changes",
          size: { max: { w: 6, h: 6 } },
          settings: { limit: 5 },
        },
      ],
    ])
  );

  it("changes the title, narrows the sizes, and starts the named setting at its value", () => {
    expect(withSiteOverride(widget, overridden)).toEqual({
      ...widget,
      title: "Latest changes",
      size: {
        default: { w: 6, h: 5 },
        min: { w: 4, h: 4 },
        max: { w: 6, h: 6 },
      },
      settings: [
        { name: "limit", type: "number", defaultValue: 5 },
        { name: "density", type: "select", defaultValue: "comfortable" },
      ],
    });
  });

  it("starts a declared widget's settings, keyed by name, the same way", () => {
    const declared = {
      id: "core/recent-activity",
      settings: { limit: { type: "number", defaultValue: 10 } },
    };
    expect(withSiteOverride(declared, overridden).settings).toEqual({
      limit: { type: "number", defaultValue: 5 },
    });
  });

  it("changes nothing more when applied twice, as two readings may", () => {
    const once = withSiteOverride(widget, overridden);
    expect(withSiteOverride(once, overridden)).toEqual(once);
  });

  it("leaves a widget it does not name as it is", () => {
    const other = { ...widget, id: "core/team" };
    expect(withSiteOverride(other, overridden)).toBe(other);
  });
});
