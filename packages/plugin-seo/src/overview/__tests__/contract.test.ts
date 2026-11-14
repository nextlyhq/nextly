/**
 * The Overview's pure parts: where each checklist item links, how each
 * optional connection reads, which addresses not found are recent, and how
 * the site's pages are grouped by where their title and description come
 * from.
 */
import { describe, expect, it } from "vitest";

import {
  coverageGroupOf,
  coverageOf,
  type SiteAddress,
} from "../../code-pages/contract";
import type { NotFoundView } from "../../redirects/contract";
import {
  CHECKLIST_ITEMS,
  checklistItemText,
  indexNowConnection,
  recentNotFound,
  redirectsConnection,
  searchConsoleConnection,
} from "../contract";

const SECTION = "/admin/plugins/nextlyhq-plugin-seo";

describe("checklistItemText", () => {
  it("links each item to where it is done", () => {
    const hrefs = Object.fromEntries(
      CHECKLIST_ITEMS.map(id => [
        id,
        checklistItemText({ id, done: false }).href,
      ])
    );
    expect(hrefs).toEqual({
      site: `${SECTION}/settings?tab=general`,
      patterns: `${SECTION}/settings?tab=types`,
      shareImage: `${SECTION}/settings?tab=images`,
      brand: `${SECTION}/settings?tab=brand`,
      import: `${SECTION}/pages/import`,
      searchConsole: `${SECTION}/settings?tab=connections`,
    });
  });

  it("names how many content types want a pattern", () => {
    expect(
      checklistItemText({ id: "patterns", done: true, types: 2 }).label
    ).toBe("Choose title patterns for 2 content types");
    expect(
      checklistItemText({ id: "patterns", done: true, types: 1 }).label
    ).toBe("Choose title patterns for 1 content type");
  });
});

describe("the connections' lines", () => {
  it("reads Search Console as connected, not connected or failing", () => {
    expect(searchConsoleConnection({ configured: true }).text).toBe(
      "Not connected"
    );
    expect(
      searchConsoleConnection({
        configured: true,
        connected: { email: "a@b.c" },
      }).standing
    ).toBe("connected");
    const failing = searchConsoleConnection({
      configured: true,
      connected: {},
      failed: { at: "2026-11-12T00:00:00Z", result: "failed", message: "x" },
    });
    expect(failing).toMatchObject({
      standing: "failing",
      text: "Failing · reconnect",
      href: `${SECTION}/settings?tab=connections`,
    });
  });

  it("reads IndexNow as off until switched on, and failing on a refused notice", () => {
    expect(indexNowConnection({}).standing).toBe("not-connected");
    expect(
      indexNowConnection({
        switchedOn: false,
        last: { at: "2026-11-12T00:00:00Z", result: "sent" },
      }).standing
    ).toBe("not-connected");
    expect(indexNowConnection({ switchedOn: true }).text).toBe("Connected");
    expect(
      indexNowConnection({
        switchedOn: true,
        last: { at: "2026-11-12T00:00:00Z", result: "refused-key" },
      })
    ).toMatchObject({ standing: "failing", text: "Failing · check the key" });
  });

  it("reads the site's Proxy as running, quiet or not wired", () => {
    expect(redirectsConnection({ state: "running", lastSeen: null })).toEqual({
      name: "Redirects on the site",
      standing: "connected",
      text: "Running",
    });
    expect(
      redirectsConnection({ state: "quiet", lastSeen: null })
    ).toMatchObject({
      standing: "failing",
      href: `${SECTION}/redirects`,
    });
    expect(
      redirectsConnection({ state: "not-wired", lastSeen: null }).standing
    ).toBe("not-connected");
  });
});

describe("recentNotFound", () => {
  const NOW = Date.parse("2026-11-12T12:00:00Z");
  const row = (id: string, lastSeen: string, hits = 1): NotFoundView => ({
    id,
    path: `/${id}`,
    from: `/${id}`,
    hits,
    lastSeen,
    kind: "missing",
    suggestion: null,
    cameFrom: null,
    ignored: false,
  });

  it("leaves out an address someone chose to ignore", () => {
    const rows = [
      { ...row("set-aside", "2026-11-12T11:30:00Z"), ignored: true },
      row("b", "2026-11-12T11:00:00Z"),
    ];
    expect(recentNotFound(rows, NOW).map(each => each.id)).toEqual(["b"]);
  });

  it("lists the last week's addresses, most recent first, three at most", () => {
    const rows = [
      row("old", "2026-11-01T00:00:00Z", 900),
      row("a", "2026-11-10T00:00:00Z", 50),
      row("b", "2026-11-12T11:00:00Z"),
      row("c", "2026-11-11T00:00:00Z"),
      row("d", "2026-11-06T00:00:00Z"),
    ];
    expect(recentNotFound(rows, NOW).map(each => each.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("lists none where nothing was not found lately", () => {
    expect(recentNotFound([row("old", "2026-10-01T00:00:00Z")], NOW)).toEqual(
      []
    );
  });
});

describe("page coverage", () => {
  type Listed = Pick<SiteAddress, "standing" | "sources">;
  const listed = (
    title: SiteAddress["sources"]["title"],
    description: SiteAddress["sources"]["description"],
    standing: SiteAddress["standing"] = "listed"
  ): Listed => ({
    standing,
    sources: {
      ...(title === undefined ? {} : { title }),
      ...(description === undefined ? {} : { description }),
    },
  });

  it("counts a page typed for, or given by its code, as set for the page", () => {
    expect(coverageGroupOf(listed("page", "page"))).toBe("bothSet");
    expect(coverageGroupOf(listed("code", "page"))).toBe("bothSet");
    expect(coverageGroupOf(listed("code", "code"))).toBe("bothSet");
  });

  it("counts a template, pattern, content or site value as worked out", () => {
    for (const level of ["template", "pattern", "content", "site"] as const) {
      expect(coverageGroupOf(listed(level, level))).toBe("bothWorkedOut");
    }
    // A value missing altogether is not set for the page either.
    expect(coverageGroupOf(listed(undefined, "pattern"))).toBe("bothWorkedOut");
  });

  it("counts one set and one worked out as one of each", () => {
    expect(coverageGroupOf(listed("page", "pattern"))).toBe("oneOfEach");
    expect(coverageGroupOf(listed("site", "code"))).toBe("oneOfEach");
  });

  it("counts a page hidden from search as hidden, whatever its values", () => {
    expect(coverageGroupOf(listed("page", "page", "hidden"))).toBe("hidden");
    expect(coverageGroupOf(listed("page", "page", "type-hidden"))).toBe(
      "hidden"
    );
    // A page built in code whose route does not ask for its head is public.
    expect(coverageGroupOf(listed("code", "code", "not-connected"))).toBe(
      "bothSet"
    );
  });

  it("adds the groups up to the total", () => {
    const coverage = coverageOf([
      listed("page", "page"),
      listed("code", "page"),
      listed("pattern", "site"),
      listed("page", "content"),
      listed("page", "page", "hidden"),
      // A page of a type with SEO off is its own group, whatever its sources.
      listed("page", "page", "seo-off"),
    ]);
    expect(coverage).toEqual({
      total: 6,
      seoOff: 1,
      hidden: 1,
      bothSet: 2,
      bothWorkedOut: 1,
      oneOfEach: 1,
    });
    expect(
      coverage.seoOff +
        coverage.hidden +
        coverage.bothSet +
        coverage.bothWorkedOut +
        coverage.oneOfEach
    ).toBe(coverage.total);
  });
});
