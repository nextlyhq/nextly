/**
 * How many pages use each header & footer set.
 *
 * The properties a plausible rule gets wrong: counting only the pages that
 * name a set (so the default misses the pages that follow it, and the pages
 * that fall back to it from an unpublished set), taking the page's place away
 * from the unpublished set it names, counting a page switched to "None",
 * counting a page twice for the default it names, and calling a count whole
 * when a read stopped at its bound.
 */
import { describe, expect, it } from "vitest";

import type { PageLayoutRow } from "./component-page-reach";
import { countSetPages } from "./layout-page-counts";

let pageIds = 0;
function page(
  layout: string | null,
  noHeaderFooter: boolean | null = false
): PageLayoutRow {
  pageIds += 1;
  return { id: `p${pageIds}`, layout, noHeaderFooter };
}

const whole = <T>(value: T) => ({ ...value, complete: true });

function site(args: {
  defaultLayout?: string | null;
  published?: readonly string[];
  publishedComplete?: boolean;
}) {
  return {
    defaultLayout: args.defaultLayout ?? null,
    published: {
      ids: new Set(args.published ?? []),
      complete: args.publishedComplete ?? true,
    },
  };
}

describe("the pages a header & footer set is used on", () => {
  it("are the pages that name it, and every set asked about is answered", () => {
    const counts = countSetPages(
      ["main", "landing", "unused"],
      whole({ pages: [page("landing"), page("landing"), page("main")] }),
      site({ defaultLayout: "main", published: ["main", "landing", "unused"] })
    );

    expect(counts).toEqual({
      main: { pages: 1, floor: false },
      landing: { pages: 2, floor: false },
      unused: { pages: 0, floor: false },
    });
  });

  it("for the site default, include the pages that follow the default", () => {
    const counts = countSetPages(
      ["main", "landing"],
      whole({ pages: [page(null), page(null), page("landing")] }),
      site({ defaultLayout: "main", published: ["main", "landing"] })
    );

    expect(counts.main).toEqual({ pages: 2, floor: false });
    // Following the default is the default's alone.
    expect(counts.landing).toEqual({ pages: 1, floor: false });
  });

  it("for the site default, include the pages falling back from an unpublished set, which still count for that set", () => {
    const counts = countSetPages(
      ["main", "unfinished"],
      whole({ pages: [page("unfinished"), page("unfinished")] }),
      site({ defaultLayout: "main", published: ["main"] })
    );

    expect(counts.main).toEqual({ pages: 2, floor: false });
    // The set they name is still theirs: published, it wraps them.
    expect(counts.unfinished).toEqual({ pages: 2, floor: false });
  });

  it("for the site default, include the pages naming a set that no longer exists", () => {
    const counts = countSetPages(
      ["main"],
      whole({ pages: [page("deleted")] }),
      site({ defaultLayout: "main", published: ["main"] })
    );

    expect(counts.main).toEqual({ pages: 1, floor: false });
  });

  it("never count a page naming a published set for the default", () => {
    const counts = countSetPages(
      ["main", "landing"],
      whole({ pages: [page("landing")] }),
      site({ defaultLayout: "main", published: ["main", "landing"] })
    );

    expect(counts.main).toEqual({ pages: 0, floor: false });
  });

  it("count a page naming the default once", () => {
    const counts = countSetPages(
      ["main"],
      whole({ pages: [page("main")] }),
      site({ defaultLayout: "main", published: ["main"] })
    );

    expect(counts.main).toEqual({ pages: 1, floor: false });
  });

  it("count a page naming the default once while the default is unpublished", () => {
    const counts = countSetPages(
      ["main"],
      whole({ pages: [page("main")] }),
      site({ defaultLayout: "main", published: [] })
    );

    expect(counts.main).toEqual({ pages: 1, floor: false });
  });

  it("count a page switched to None for no set, whatever it names", () => {
    const counts = countSetPages(
      ["main", "landing", "unfinished"],
      whole({
        pages: [
          page("landing", true),
          page(null, true),
          page("unfinished", true),
        ],
      }),
      site({ defaultLayout: "main", published: ["main", "landing"] })
    );

    expect(counts).toEqual({
      main: { pages: 0, floor: false },
      landing: { pages: 0, floor: false },
      unfinished: { pages: 0, floor: false },
    });
  });

  it("count the pages following the default for it while it is unpublished", () => {
    // Formula, not drawing: the pages are the default's whenever it is put live.
    const counts = countSetPages(
      ["main"],
      whole({ pages: [page(null)] }),
      site({ defaultLayout: "main", published: [] })
    );

    expect(counts.main).toEqual({ pages: 1, floor: false });
  });

  it("count the pages that name no set for no set when the site has no default", () => {
    const counts = countSetPages(
      ["landing"],
      whole({ pages: [page(null), page("unfinished")] }),
      site({ defaultLayout: null, published: ["landing"] })
    );

    expect(counts).toEqual({ landing: { pages: 0, floor: false } });
  });

  it("answer only the sets asked about", () => {
    const counts = countSetPages(
      ["main"],
      whole({ pages: [page("hidden"), page("main")] }),
      site({ defaultLayout: "main", published: ["main", "hidden"] })
    );

    expect(Object.keys(counts)).toEqual(["main"]);
  });

  it("count a page once when a paged read returned its row twice", () => {
    // Offset paging repeats a row when a page is written between two reads.
    const twice = page("landing");
    const counts = countSetPages(
      ["main", "landing"],
      whole({ pages: [twice, page(null), twice] }),
      site({ defaultLayout: "main", published: ["main", "landing"] })
    );

    expect(counts).toEqual({
      main: { pages: 1, floor: false },
      landing: { pages: 1, floor: false },
    });
  });

  it("keep the default whole for a page naming it while the bounded published read stopped", () => {
    const counts = countSetPages(
      ["main"],
      whole({ pages: [page("main")] }),
      site({ defaultLayout: "main", published: [], publishedComplete: false })
    );

    expect(counts.main).toEqual({ pages: 1, floor: false });
  });

  it("are floors, every one, when the page read stopped at its bound", () => {
    const counts = countSetPages(
      ["main", "landing"],
      { pages: [page("landing")], complete: false },
      site({ defaultLayout: "main", published: ["main", "landing"] })
    );

    expect(counts).toEqual({
      main: { pages: 0, floor: true },
      landing: { pages: 1, floor: true },
    });
  });

  it("for the default, leave out a page whose set the bounded published read could not place, and say it is a floor", () => {
    // "other" may be published past the bound, wrapping the page itself, so
    // counting it for the default could say more than the truth.
    const counts = countSetPages(
      ["main", "other"],
      whole({ pages: [page("other"), page(null)] }),
      site({
        defaultLayout: "main",
        published: ["main"],
        publishedComplete: false,
      })
    );

    expect(counts.main).toEqual({ pages: 1, floor: true });
    expect(counts.other).toEqual({ pages: 1, floor: false });
  });

  it("keep the default whole when the bounded published read placed every set the pages name", () => {
    const counts = countSetPages(
      ["main", "landing"],
      whole({ pages: [page("landing"), page(null), page("main")] }),
      site({
        defaultLayout: "main",
        published: ["main", "landing"],
        publishedComplete: false,
      })
    );

    expect(counts.main).toEqual({ pages: 2, floor: false });
  });
});
