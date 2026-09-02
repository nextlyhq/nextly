import { describe, expect, it } from "vitest";

import { pluginSlug } from "@admin/lib/plugins/plugin-slug";

import {
  resolveStandaloneLabel,
  type LabelledStandalonePlugin,
} from "../lib/resolve-standalone-label";

/**
 * The production slug rule, not a local restatement of it.
 *
 * A hand-written copy agreed with `pluginAdminSlug` on the plain names below
 * and diverged on scoped or punctuation-wrapped ones, where the real rule also
 * trims the dashes it produces at the ends. Those are exactly the names that
 * would make this helper miss the plugin and exercise the slug fallback while
 * the test claimed to be checking the matching branch.
 */
const slugOf = pluginSlug;

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
  /**
   * A name the two rules spell differently, with the id written out rather
   * than derived.
   *
   * `pluginAdminSlug("@acme/Analytics")` is "acme-analytics"; a lowercase
   * dash-collapsing copy yields "-acme-analytics", because the real rule also
   * trims the dashes that a leading `@` and an inner `/` produce. Deriving the
   * id with the same helper the lookup uses would make this pass under either
   * rule — both sides would move together — so the literal is the whole point.
   * Under a local copy the plugin is never found and the label falls through to
   * the slug.
   */
  it("matches a scoped plugin name", () => {
    const scoped: LabelledStandalonePlugin[] = [{ name: "@acme/Analytics" }];
    expect(
      resolveStandaloneLabel("standalone-acme-analytics", scoped, slugOf)
    ).toBe("@acme/Analytics");
  });

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
