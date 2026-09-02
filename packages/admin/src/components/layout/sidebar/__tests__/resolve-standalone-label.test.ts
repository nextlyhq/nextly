import { describe, expect, it } from "vitest";

import {
  resolveStandaloneLabel,
  type LabelledStandalonePlugin,
} from "../lib/resolve-standalone-label";

/** The real slug rule: lowercased, non-alphanumerics collapsed to a dash. */
const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

const plugins: LabelledStandalonePlugin[] = [
  { name: "Form Builder", appearance: { label: "Forms" } },
  { name: "SEO Toolkit" },
];

describe("resolveStandaloneLabel", () => {
  it("has no heading when the selection is not a standalone plugin", () => {
    expect(resolveStandaloneLabel("collections", plugins, slugOf)).toBe("");
  });

  it("prefers the label a plugin declared", () => {
    expect(
      resolveStandaloneLabel("standalone-form-builder", plugins, slugOf)
    ).toBe("Forms");
  });

  it("falls back to the plugin's name when it declared no label", () => {
    expect(
      resolveStandaloneLabel("standalone-seo-toolkit", plugins, slugOf)
    ).toBe("SEO Toolkit");
  });

  /**
   * The last resort. A panel selected for a plugin that is no longer visible
   * still gets a heading rather than an empty one, so the panel never reads as
   * broken while the rail catches up.
   */
  it("falls back to the slug when no plugin matches", () => {
    expect(resolveStandaloneLabel("standalone-gone", plugins, slugOf)).toBe(
      "gone"
    );
  });

  /**
   * An empty declared label is not a heading. `||` is load-bearing here rather
   * than `??`: a plugin shipping `label: ""` would otherwise head its panel
   * with nothing at all.
   */
  it("treats an empty declared label as absent", () => {
    const blank: LabelledStandalonePlugin[] = [
      { name: "Analytics", appearance: { label: "" } },
    ];
    expect(resolveStandaloneLabel("standalone-analytics", blank, slugOf)).toBe(
      "Analytics"
    );
  });
});
