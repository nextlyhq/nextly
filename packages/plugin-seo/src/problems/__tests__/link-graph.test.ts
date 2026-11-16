/**
 * How many pages link to each page and how many it links to, and which
 * listed pages no other page links to, all derived from the links each
 * page's check resolved. The separating cases: a page's links to itself and
 * repeated links count once or not at all, a link from another language is
 * not a link here, and a page whose links were never read is neither
 * counted nor called an orphan.
 */
import { describe, expect, it } from "vitest";

import {
  linkCounts,
  linkedPageKey,
  orphanProblems,
  type LinkedPage,
} from "../link-graph";

function page(
  id: string,
  to: string[],
  more: Partial<LinkedPage> & { home?: boolean; listed?: boolean } = {}
): LinkedPage {
  const { home = false, listed = true, ...rest } = more;
  return {
    subject: { type: "posts", id, label: `Post ${id}`, detail: `/blog/${id}` },
    locale: "en",
    links: {
      to: to.map(each => linkedPageKey("posts", each, "en")),
      listed,
      home,
    },
    ...rest,
  };
}

describe("a page's key", () => {
  it("holds no NUL, which a PostgreSQL JSON column refuses in a string", () => {
    expect(linkedPageKey("single:home", "h1", "en")).not.toContain("\u0000");
    expect(linkedPageKey("posts", "a", "en")).not.toBe(
      linkedPageKey("posts", "a", "de")
    );
  });
});

describe("link counts", () => {
  it("counts the distinct other pages linking in and linked to, not the links", () => {
    const pages = [
      // `a` links to b twice and to itself: one page out.
      page("a", ["b", "b", "a"]),
      page("b", ["c"]),
      page("c", ["b"]),
    ];
    const counts = linkCounts(pages);
    expect(counts.get(linkedPageKey("posts", "a", "en"))).toEqual({
      inbound: 0,
      outbound: 1,
    });
    expect(counts.get(linkedPageKey("posts", "b", "en"))).toEqual({
      inbound: 2,
      outbound: 1,
    });
    expect(counts.get(linkedPageKey("posts", "c", "en"))).toEqual({
      inbound: 1,
      outbound: 1,
    });
  });

  it("counts a link for the language its address is served in", () => {
    // The German page links to b's German address, not to the English b.
    const german: LinkedPage = {
      ...page("a", []),
      locale: "de",
      links: {
        to: [linkedPageKey("posts", "b", "de")],
        listed: true,
        home: false,
      },
    };
    const counts = linkCounts([german, page("b", [])]);
    expect(counts.get(linkedPageKey("posts", "b", "en"))?.inbound).toBe(0);
    const linked = linkCounts([german, { ...page("b", []), locale: "de" }]);
    expect(linked.get(linkedPageKey("posts", "b", "de"))?.inbound).toBe(1);
  });

  it("leaves a page whose links were never read uncounted, and counts nothing from it", () => {
    const unread: LinkedPage = {
      subject: { type: "posts", id: "old", label: "Old", detail: "/blog/old" },
      locale: "en",
    };
    const counts = linkCounts([unread, page("b", [])]);
    expect(counts.has(linkedPageKey("posts", "old", "en"))).toBe(false);
    expect(counts.get(linkedPageKey("posts", "b", "en"))?.inbound).toBe(0);
  });
});

describe("orphan pages", () => {
  it("names a listed page no other page links to, and none that one links to", () => {
    const problems = orphanProblems([page("a", ["b"]), page("b", [])]);
    expect(problems).toEqual([
      {
        kind: "orphanPage",
        subject: {
          type: "posts",
          id: "a",
          label: "Post a",
          detail: "/blog/a",
        },
        what: "No other page links here",
        action: "Open the page",
        fix: { place: "page", tab: "content" },
      },
    ]);
  });

  it("is not satisfied by a page linking to itself", () => {
    const kinds = orphanProblems([page("a", ["a"])]).map(p => p.subject.id);
    expect(kinds).toEqual(["a"]);
  });

  it("leaves out the home page, a page hidden from search, and a page whose links were never read", () => {
    const problems = orphanProblems([
      page("home", [], { home: true }),
      page("hidden", [], { listed: false }),
      { subject: { type: "posts", id: "old", label: "Old" }, locale: "en" },
    ]);
    expect(problems).toEqual([]);
  });

  it("names an orphan in another language with that language, as the list opens its editor in", () => {
    const german: LinkedPage = { ...page("a", []), locale: "de" };
    const [problem] = orphanProblems([german, page("b", [])], undefined, "en");
    expect(problem?.subject).toMatchObject({ id: "a", locale: "de" });
    const [english] = orphanProblems([page("b", [])], undefined, "en");
    expect(english?.subject).not.toHaveProperty("locale");
  });

  it("counts links from every page but names only the pages asked about", () => {
    const all = [page("a", ["b"]), page("b", []), page("c", [])];
    const named = orphanProblems(
      all,
      [all[1], all[2]].filter(Boolean) as LinkedPage[]
    );
    expect(named.map(p => p.subject.id)).toEqual(["c"]);
  });
});
