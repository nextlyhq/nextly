/**
 * The checks made across the site rather than on one page: a title or
 * description two pages share, a missing production address, and a content
 * type SEO is added to whose pages have no public address.
 */
import { describe, expect, it } from "vitest";

import {
  noAddressProblems,
  productionAddressProblems,
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
      sharedValueProblems([page("1", "One", "First"), page("2", "Two", "Second")])
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
        "settings",
        "Set an address",
      ],
    ]);
    const note = problems[0]?.fix;
    expect(note?.place === "developer" && note.note).toContain(
      'publicAddress: "/cases/{slug}"'
    );
  });
});
