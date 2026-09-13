/**
 * The dashboard card: which numbers it offers, and where they come from.
 *
 * The card is declarative -- the host draws it from cell queries -- so what
 * matters here is that the cells describe answers this plugin's source can
 * actually give. That the two AGREE at runtime is
 * `widget-card.integration.test.ts`'s job, against a real boot.
 */
import { text } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import { defaultSeoFields } from "../fields";
import { SEO_ISSUES_WIDGET_ID, seoIssuesWidget } from "../widget-card";
import { ISSUE_FIELD, SEO_ISSUES_SOURCE_ID } from "../widget-source";

describe("the SEO issues card", () => {
  it("offers one number per issue the installed fields can report", () => {
    const card = seoIssuesWidget(defaultSeoFields());

    expect(card?.id).toBe(SEO_ISSUES_WIDGET_ID);
    expect(card?.archetype).toBe("stats");
    expect(card?.cells).toHaveLength(5);
  });

  it("leads with the issues that remove a page from results", () => {
    // Priority, not declaration convenience: an unintended `noindex` and a
    // missing title both take a page out of search, where a missing social
    // image changes how a link previews.
    const labels = seoIssuesWidget(defaultSeoFields())?.cells.map(
      cell => cell.label
    );

    expect(labels?.[0]).toBe("Hidden from search engines");
    expect(labels?.[1]).toBe("Missing meta title");
    expect(labels?.at(-1)).toBe("Missing social image");
  });

  it("asks its own source, filtered to the issue the cell names", () => {
    const card = seoIssuesWidget(defaultSeoFields());

    for (const cell of card?.cells ?? []) {
      expect(cell.query.source).toBe(SEO_ISSUES_SOURCE_ID);
      expect(cell.query.op).toBe("count");
      expect(cell.query.where).toEqual({
        [ISSUE_FIELD]: { equals: cell.label },
      });
    }
  });

  it("keys every cell distinctly, so two numbers cannot collapse into one", () => {
    // The card keys each answer back by `key`, so a duplicate would draw the
    // same number twice under two labels -- which is not wrong-looking in any
    // way a reader could detect. Boot refuses it; this says the generated set
    // never produces one.
    const keys = seoIssuesWidget(defaultSeoFields())?.cells.map(c => c.key);

    expect(new Set(keys).size).toBe(keys?.length);
  });

  it("offers only what a partial override installs", () => {
    const card = seoIssuesWidget([
      text({ name: "metaTitle" }),
      text({ name: "canonical" }),
    ]);

    expect(card?.cells.map(cell => cell.label)).toEqual([
      "Missing meta title",
      "Missing canonical URL",
    ]);
  });

  it("contributes no card at all when nothing it understands is installed", () => {
    // 🔴 A `stats` card with no cells is refused at boot, and rightly -- it
    // would draw an empty frame. A project whose override leaves nothing this
    // source can check gets no card rather than a broken one.
    expect(seoIssuesWidget([text({ name: "focusKeyword" })])).toBeUndefined();
  });

  it("stays within the cap a stats card may declare", () => {
    // Each cell is its own count query, so the cap is what keeps one card from
    // consuming the whole batch and darkening every other widget.
    expect(
      seoIssuesWidget(defaultSeoFields())?.cells.length
    ).toBeLessThanOrEqual(8);
  });
});
