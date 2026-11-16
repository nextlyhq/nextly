/**
 * The checks made across the site rather than on one page: a title or
 * description two pages share, a missing production address, and a content
 * type SEO is added to whose pages have no public address.
 */
import { describe, expect, it } from "vitest";

import {
  noAddressProblems,
  productionAddressProblems,
  proxyProblems,
  PROXY_WIRING_NOTE,
  listingProblems,
  redirectChainProblems,
  sharedValueProblems,
  type CheckedPage,
} from "../site-checks";

function page(id: string, title?: string, description?: string): CheckedPage {
  return {
    subject: { type: "posts", id, label: `Post ${id}`, detail: `/blog/${id}` },
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
  };
}

describe("sharedValueProblems", () => {
  it("passes pages whose titles and descriptions all differ", () => {
    expect(
      sharedValueProblems([
        page("1", "One", "First"),
        page("2", "Two", "Second"),
      ])
    ).toEqual([]);
  });

  it("reports every page sharing a title, as written apart from spacing and case", () => {
    const problems = sharedValueProblems([
      page("1", "Harbour Walk"),
      page("2", "  harbour   walk "),
      page("3", "Other"),
    ]);
    expect(problems.map(p => [p.kind, p.subject.id, p.what])).toEqual([
      ["sharedTitle", "1", "Title: “Harbour Walk”, also on Post 2"],
      ["sharedTitle", "2", "Title: “  harbour   walk ”, also on Post 1"],
    ]);
    expect(problems[0]?.fix).toEqual({
      place: "page",
      tab: "seo",
      field: "metaTitle",
    });
  });

  it("reports a shared description, and names how many others share it past two", () => {
    const problems = sharedValueProblems([
      page("1", "A", "Same"),
      page("2", "B", "Same"),
      page("3", "C", "Same"),
      page("4", "D", "Same"),
    ]);
    expect(problems.map(p => p.kind)).toEqual([
      "sharedDescription",
      "sharedDescription",
      "sharedDescription",
      "sharedDescription",
    ]);
    expect(problems[0]?.what).toBe(
      "Description: “Same”, also on Post 2 and 2 other pages"
    );
  });
});

describe("productionAddressProblems", () => {
  it("passes a site with a production address", () => {
    expect(
      productionAddressProblems(["https://example.com"], "listable")
    ).toEqual([]);
  });

  it("reports a listable site with none, and says plainly what to do", () => {
    const [problem] = productionAddressProblems([], "listable");
    expect(problem).toMatchObject({
      kind: "productionAddress",
      subject: { label: "Whole site" },
      action: "Set the address",
      fix: { place: "settings", tab: "general" },
    });
    expect(problem?.what).toContain("NEXTLY_PRODUCTION_ADDRESSES");
    expect(problem?.what).toContain("copies of the site can show up in search");
  });

  it("tells a guarded site that every page asks search engines to stay away", () => {
    const [problem] = productionAddressProblems([], "guarded");
    expect(problem?.what).toContain(
      "every page asks search engines to stay away"
    );
  });
});

describe("noAddressProblems", () => {
  it("passes when every type has an address", () => {
    expect(noAddressProblems([])).toEqual([]);
  });

  it("reports a type with no public address, fixed in code or in the settings", () => {
    const problems = noAddressProblems([
      { key: "cases", label: "Case studies", entries: 3, inCode: true },
      { key: "notes", label: "Notes", entries: 1, inCode: false },
    ]);
    expect(problems.map(p => [p.subject, p.fix.place, p.action])).toEqual([
      [
        { type: "cases", label: "Case studies", detail: "3 entries" },
        "developer",
        "Copy a note for a developer",
      ],
      [
        { type: "notes", label: "Notes", detail: "1 entry" },
        "developer",
        "Copy a note for a developer",
      ],
    ]);
    const note = problems[0]?.fix;
    expect(note?.place === "developer" && note.note).toContain(
      'publicAddress: "/cases/{slug}"'
    );
  });
});

describe("redirectChainProblems", () => {
  it("passes redirects that each take one hop", () => {
    expect(redirectChainProblems([])).toEqual([]);
  });

  it("reports a redirect whose To address redirects again, and where it should go", () => {
    const [problem] = redirectChainProblems([
      { source: "/a", target: "/new/x", end: "/newer/x" },
    ]);
    expect(problem).toMatchObject({
      kind: "redirectChain",
      subject: { label: "/a" },
      what: "/a → /new/x → /newer/x",
      fix: { place: "developer" },
    });
    const fix = problem?.fix;
    expect(fix?.place === "developer" && fix.note).toContain(
      "Point /a straight at /newer/x"
    );
  });
});

describe("listingProblems", () => {
  const labels = new Map([
    ["posts:7", { label: "Harbour", detail: "/blog/harbour" }],
  ]);

  it("passes a site whose every page is listed", () => {
    expect(listingProblems([], labels, "en")).toEqual([]);
  });

  it("reports a page whose address another page holds, and one not recorded yet", () => {
    const problems = listingProblems(
      [
        {
          kind: "held-by-another",
          holder: { collection: "posts", id: "7" },
          path: "/blog/harbour",
          language: "en",
          heldBy: { collection: "pages", id: "2", label: "Harbour page" },
        },
        {
          kind: "not-recorded",
          holder: { collection: "posts", id: "8" },
          path: "/blog/boats",
          language: "de",
        },
      ],
      labels,
      "en"
    );
    expect(problems.map(p => [p.kind, p.subject, p.what, p.fix])).toEqual([
      [
        "notListed",
        { type: "posts", id: "7", label: "Harbour", detail: "/blog/harbour" },
        // The other page is not named: the reader may not be able to read it.
        "Its address /blog/harbour is held by another page, so it has no official address and isn't in the sitemap",
        { place: "page", tab: "content" },
      ],
      [
        "notListed",
        { type: "posts", id: "8", label: "posts 8", detail: "/blog/boats" },
        "Its address /blog/boats in de isn't recorded as its own yet, so it's left out of the sitemap. Saving the page records it.",
        { place: "page", tab: "content" },
      ],
    ]);
  });
});

describe("proxyProblems", () => {
  it("lists saved redirects the Proxy never served, with the wiring for a developer", () => {
    const [problem, ...rest] = proxyProblems(
      { state: "not-wired", lastSeen: null },
      3
    );
    expect(rest).toEqual([]);
    expect(problem).toMatchObject({
      kind: "proxyNotWired",
      subject: { label: "Whole site" },
      fix: { place: "developer", note: PROXY_WIRING_NOTE },
    });
    expect(problem?.what).toBe(
      "3 redirects are saved but not served: proxy.ts is not wired, so no request has reached the site's Proxy."
    );
    expect(PROXY_WIRING_NOTE).toContain("createNextlyProxy");
  });

  it("names the day a Proxy that stopped running last ran", () => {
    expect(
      proxyProblems(
        { state: "quiet", lastSeen: "2026-10-01T08:00:00.000Z" },
        1
      )[0]?.what
    ).toBe(
      "1 redirect is saved but not served: no request has reached the site's Proxy since 2026-10-01."
    );
  });

  it("lists nothing while the Proxy runs, or where no redirect is saved", () => {
    expect(
      proxyProblems(
        { state: "running", lastSeen: "2026-11-12T08:00:00.000Z" },
        5
      )
    ).toEqual([]);
    expect(proxyProblems({ state: "not-wired", lastSeen: null }, 0)).toEqual(
      []
    );
  });
});
