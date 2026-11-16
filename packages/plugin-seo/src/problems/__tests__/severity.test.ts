/**
 * Every kind of problem has one severity, and the counts the Overview's
 * health verdict and the problem list show are counted one way: a page
 * check once for each page it fails on, a site check once.
 */
import { describe, expect, it } from "vitest";

import {
  KIND_ORDER,
  KIND_SEVERITY,
  KIND_TEXT,
  problemsHref,
  problemsToFix,
  severityCounts,
  SEVERITY_ORDER,
  WHOLE_SITE,
  type Problem,
  type ProblemKind,
} from "../contract";

/** A problem of `kind` about `subject`. */
function problem(kind: ProblemKind, subject: Problem["subject"]): Problem {
  return { kind, subject, what: "", action: "", fix: { place: "media" } };
}

/** A page of `type` with `id`, in `locale` where given. */
const page = (id: string, type = "posts", locale?: string) => ({
  type,
  id,
  label: `Page ${id}`,
  ...(locale === undefined ? {} : { locale }),
});

describe("each kind's severity", () => {
  it("gives every kind the list checks for exactly one severity", () => {
    const kinds = Object.keys(KIND_TEXT) as ProblemKind[];
    expect(new Set(Object.keys(KIND_SEVERITY))).toEqual(new Set(kinds));
    expect(new Set(KIND_ORDER)).toEqual(new Set(kinds));
    for (const kind of kinds) {
      expect(SEVERITY_ORDER).toContain(KIND_SEVERITY[kind]);
    }
  });

  it("calls a page kept out of search an error, a duplicate a warning and a long title a notice", () => {
    expect(KIND_SEVERITY.proxyNotWired).toBe("error");
    expect(KIND_SEVERITY.sharedDescription).toBe("warning");
    expect(KIND_SEVERITY.shareImage).toBe("warning");
    expect(KIND_SEVERITY.longTitle).toBe("notice");
  });
});

describe("severityCounts", () => {
  it("counts nothing on a list with nothing to fix", () => {
    expect(severityCounts([])).toEqual({ error: 0, warning: 0, notice: 0 });
  });

  it("counts a page check once for each page it fails on", () => {
    const counts = severityCounts([
      problem("longTitle", page("1")),
      problem("longTitle", page("2")),
      problem("longTitle", page("3", "pages")),
      problem("longTitle", page("4")),
    ]);
    expect(counts).toEqual({ error: 0, warning: 0, notice: 4 });
  });

  it("counts a page check failing several times on one page once", () => {
    // Three broken links on one page, and two groups of images with no alt text.
    const counts = severityCounts([
      problem("brokenLink", page("1")),
      problem("brokenLink", page("1")),
      problem("brokenLink", page("1")),
      problem("imageAlt", page("1")),
      problem("imageAlt", page("1")),
    ]);
    expect(counts).toEqual({ error: 0, warning: 1, notice: 1 });
  });

  it("counts a page in each of its languages as its own page", () => {
    const counts = severityCounts([
      problem("noTitle", page("1")),
      problem("noTitle", page("1", "posts", "de")),
    ]);
    expect(counts.error).toBe(2);
  });

  it("counts a site check once, however many things it names", () => {
    const counts = severityCounts([
      problem("redirectChain", { label: "/old" }),
      problem("redirectChain", { label: "/older" }),
      problem("noAddress", { type: "cases", label: "Case studies" }),
      problem("noAddress", { type: "jobs", label: "Jobs" }),
      problem("proxyNotWired", WHOLE_SITE),
    ]);
    expect(counts).toEqual({ error: 2, warning: 1, notice: 0 });
  });

  it("counts the board's sample rows as 1, 3 and 4", () => {
    const counts = severityCounts([
      problem("proxyNotWired", WHOLE_SITE),
      problem("sharedDescription", page("blog", "pages")),
      problem("sharedDescription", page("community", "pages")),
      problem("shareImage", page("home", "pages")),
      ...["a", "b", "c", "d"].map(id => problem("longTitle", page(id))),
    ]);
    expect(counts).toEqual({ error: 1, warning: 3, notice: 4 });
    expect(problemsToFix(counts)).toBe(4);
  });
});

describe("problemsHref", () => {
  it("narrows the list to one severity, or opens it whole", () => {
    expect(problemsHref()).toBe("/admin/plugins/nextlyhq-plugin-seo/problems");
    expect(problemsHref("warning")).toBe(
      "/admin/plugins/nextlyhq-plugin-seo/problems?severity=warning"
    );
  });
});

describe("a sitemap page robots.txt blocks", () => {
  it("is an error, since what was set for it doesn't reach search", () => {
    expect(KIND_SEVERITY.robotsBlocked).toBe("error");
  });
});
