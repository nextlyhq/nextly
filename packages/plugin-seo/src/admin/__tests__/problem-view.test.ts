/**
 * The problem list's screen groups problems by kind in the list's order,
 * says when it was last checked in words, and links each fix to its place.
 */
import { describe, expect, it } from "vitest";

import { fixHref, type Problem } from "../../problems/contract";
import { checkedWords, groupsOf } from "../problem-view";

function problem(kind: Problem["kind"], label: string): Problem {
  return {
    kind,
    subject: { type: "posts", id: label, label },
    what: "",
    action: "",
    fix: { place: "page", tab: "seo", field: "metaTitle" },
  };
}

describe("groupsOf", () => {
  it("groups problems by kind, site-wide kinds first, each explained once", () => {
    const groups = groupsOf([
      problem("imageAlt", "a"),
      problem("sharedTitle", "b"),
      problem("productionAddress", "site"),
      problem("sharedTitle", "c"),
    ]);
    expect(groups.map(g => [g.kind, g.problems.length, g.siteWide])).toEqual([
      ["productionAddress", 1, true],
      ["sharedTitle", 2, false],
      ["imageAlt", 1, false],
    ]);
    expect(groups[1]).toMatchObject({
      title: "Same title on several pages",
      explain:
        "Google may show only one of them. Give each page its own title.",
    });
  });
});

describe("checkedWords", () => {
  const at = Date.parse("2026-11-11T12:00:00.000Z");
  const said = (ms: number) =>
    checkedWords("2026-11-11T12:00:00.000Z", at + ms);

  it("says how long ago, in the largest whole unit", () => {
    expect(said(20_000)).toBe("just now");
    expect(said(60_000)).toBe("1 minute ago");
    expect(said(3 * 60_000)).toBe("3 minutes ago");
    expect(said(2 * 3_600_000)).toBe("2 hours ago");
    expect(said(26 * 3_600_000)).toBe("1 day ago");
    expect(said(3 * 86_400_000)).toBe("3 days ago");
  });
});

describe("fixHref", () => {
  const page = (fix: Problem["fix"], type = "posts"): Problem => ({
    ...problem("noTitle", "a"),
    subject: { type, id: "7", label: "A" },
    fix,
  });

  it("opens the page's SEO tab or its content, the settings tab, or the media library", () => {
    expect(
      fixHref(page({ place: "page", tab: "seo", field: "metaTitle" }))
    ).toBe("/admin/collections/posts/7?tab=nextlyhq-plugin-seo.tab");
    expect(
      fixHref(page({ place: "page", tab: "content", field: "body" }))
    ).toBe("/admin/collections/posts/7");
    expect(fixHref(page({ place: "page", tab: "seo" }, "single:home"))).toBe(
      "/admin/singles/home?tab=nextlyhq-plugin-seo.tab"
    );
    expect(fixHref(page({ place: "settings", tab: "types" }))).toBe(
      "/admin/plugins/nextlyhq-plugin-seo/settings?tab=types"
    );
    expect(fixHref(page({ place: "media" }))).toBe("/admin/media");
  });

  it("opens the editor in the language the page was checked in", () => {
    const german: Problem = {
      ...page({ place: "page", tab: "seo", field: "metaDescription" }),
      subject: { type: "posts", id: "7", label: "Hafen", locale: "de" },
    };
    expect(fixHref(german)).toBe(
      "/admin/collections/posts/7?tab=nextlyhq-plugin-seo.tab&locale=de"
    );
    expect(
      fixHref({
        ...german,
        fix: { place: "page", tab: "content", field: "body" },
      })
    ).toBe("/admin/collections/posts/7?locale=de");
  });

  it("has no address for a note copied for a developer", () => {
    expect(
      fixHref(page({ place: "developer", note: "Add a line." }))
    ).toBeUndefined();
  });
});
