/**
 * What the Pages screen shows from the list it reads and the shared problem
 * list: each page's status, the Type filter's choices, the pages a search and
 * the filters keep, and where a title comes from.
 */
import { describe, expect, it } from "vitest";

import type { SiteAddress } from "../../code-pages/contract";
import type { Problem, ProblemKind } from "../../problems/contract";
import {
  developerNote,
  entryHref,
  problemsByPage,
  shownPages,
  statusOf,
  titleSourceText,
  typeChoices,
  valueSource,
  type PagesFilter,
} from "../pages-view";

const ITEMS: SiteAddress[] = [
  {
    path: "/",
    name: "Home",
    source: "entry",
    from: "Home page",
    standing: "listed",
    sources: { title: "code" },
    entry: { kind: "single", slug: "home", id: "1" },
  },
  {
    path: "/blog/hello",
    name: "Hello",
    source: "entry",
    from: "Posts",
    standing: "listed",
    sources: { title: "pattern" },
    titlePattern: "{Title} | {Site name} Blog",
    entry: { kind: "collection", slug: "posts", id: "7" },
  },
  {
    path: "/de/blog/hallo",
    name: "Hallo",
    source: "entry",
    from: "Posts",
    standing: "listed",
    sources: { title: "page" },
    entry: { kind: "collection", slug: "posts", id: "7", locale: "de" },
  },
  {
    path: "/pricing",
    name: "Pricing",
    source: "built",
    from: "app/pricing/page.tsx",
    standing: "not-connected",
    sources: {},
  },
  {
    path: "/integrations/wordpress",
    name: "Wordpress",
    source: "dynamic",
    from: "app/integrations/[name]/page.tsx",
    standing: "hidden",
    sources: {},
  },
];

/** A problem of `kind` about the page `type`/`id`, in `locale`. */
const problem = (
  kind: ProblemKind,
  type: string | undefined,
  id: string | undefined,
  locale?: string
): Problem => ({
  kind,
  subject: {
    label: "x",
    ...(type === undefined ? {} : { type }),
    ...(id === undefined ? {} : { id }),
    ...(locale === undefined ? {} : { locale }),
  },
  what: "x",
  action: "Fix",
  fix: { place: "page", tab: "seo" },
});

describe("each page's status", () => {
  const byPage = problemsByPage([
    problem("longTitle", "posts", "7"),
    problem("noDescription", "posts", "7"),
    problem("noTitle", "posts", "7", "de"),
    // About the whole site: no page's status.
    problem("productionAddress", undefined, undefined),
  ]);
  const status = (at: number) => statusOf(ITEMS[at] as SiteAddress, byPage);

  it("is its most serious problem, in its own language", () => {
    expect(status(1)).toBe("warning");
    expect(status(2)).toBe("error");
  });

  it("is good, not connected or hidden where the list holds nothing for it", () => {
    expect(status(0)).toBe("good");
    expect(status(3)).toBe("not-connected");
    expect(status(4)).toBe("hidden");
  });

  it("names a Single by its type key", () => {
    const single = problemsByPage([problem("canonical", "single:home", "1")]);
    expect(statusOf(ITEMS[0] as SiteAddress, single)).toBe("error");
  });
});

describe("the Type filter and the search", () => {
  it("offers each collection, then the Singles, then the pages built in code", () => {
    expect(typeChoices(ITEMS)).toEqual([
      { value: "collection:posts", label: "Posts" },
      { value: "singles", label: "Singles" },
      { value: "code", label: "Built in code" },
    ]);
  });

  it("keeps the pages of a type and a status whose address or name holds the search", () => {
    const byPage = problemsByPage([problem("noTitle", "posts", "7", "de")]);
    const shown = (filter: Partial<PagesFilter>) =>
      shownPages(
        ITEMS,
        { query: "", type: "all", status: "all", ...filter },
        item => statusOf(item, byPage)
      ).map(item => item.path);
    expect(shown({ type: "collection:posts" })).toEqual([
      "/blog/hello",
      "/de/blog/hallo",
    ]);
    expect(shown({ type: "code" })).toEqual([
      "/pricing",
      "/integrations/wordpress",
    ]);
    expect(shown({ status: "error" })).toEqual(["/de/blog/hallo"]);
    expect(shown({ status: "good" })).toEqual(["/", "/blog/hello"]);
    expect(shown({ query: "HALL" })).toEqual(["/de/blog/hallo"]);
    expect(shown({ query: "press" })).toEqual(["/integrations/wordpress"]);
  });
});

describe("where a title comes from", () => {
  it("says the pattern it was made from, or the level that gave it", () => {
    expect(titleSourceText(ITEMS[1] as SiteAddress)).toBe(
      "Pattern: {Title} | {Site name} Blog"
    );
    expect(titleSourceText(ITEMS[0] as SiteAddress)).toBe(
      "From the page\u2019s code"
    );
    expect(titleSourceText(ITEMS[2] as SiteAddress)).toBe("Own value");
  });
});

describe("where an entry opens", () => {
  it("opens a translation in its language", () => {
    expect(entryHref({ kind: "collection", slug: "posts", id: "7", locale: "de" })).toBe(
      "/admin/collections/posts/7?locale=de"
    );
    expect(entryHref({ kind: "single", slug: "home", id: "1" })).toBe(
      "/admin/singles/home"
    );
  });
});

describe("the note for a developer", () => {
  it("names the address, its route and the line to add", () => {
    const note = developerNote(ITEMS[3] as SiteAddress);
    expect(note).toContain("/pricing (app/pricing/page.tsx)");
    expect(note).toContain('seoMetadata("/pricing")');
  });
});

describe("where a field's value comes from", () => {
  const page = (
    standing: SiteAddress["standing"],
    automatic: NonNullable<SiteAddress["seo"]>["automatic"]
  ): SiteAddress => ({
    path: "/pricing",
    name: "Pricing",
    source: "built",
    from: "app/pricing/page.tsx",
    standing,
    sources: {},
    seo: { typed: { hidden: false }, automatic },
  });
  const pattern = {
    title: {
      value: "Pricing | Acme",
      from: "pattern" as const,
      pattern: "{Title} | {Site name}",
    },
  };

  it("is what was typed, whatever else there is", () => {
    expect(valueSource(page("listed", pattern), "title", true)).toEqual({
      kind: "typed",
    });
  });

  it("is the route's code only where its code supplies the value", () => {
    expect(
      valueSource(
        page("listed", { title: { value: "Pricing", from: "code" } }),
        "title",
        false
      )
    ).toEqual({ kind: "code", connected: true });
    // A route not connected yet is said to be so in the panel's note; its
    // value still comes from where it comes from.
    expect(valueSource(page("not-connected", pattern), "title", false)).toEqual(
      { kind: "pattern", pattern: "{Title} | {Site name}" }
    );
  });

  it("is the site's pattern, or its defaults, otherwise", () => {
    expect(valueSource(page("listed", pattern), "title", false)).toEqual({
      kind: "pattern",
      pattern: "{Title} | {Site name}",
    });
    expect(valueSource(page("listed", pattern), "description", false)).toEqual({
      kind: "site",
      field: "description",
      found: false,
    });
  });
});
