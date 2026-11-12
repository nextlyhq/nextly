/**
 * What Edit mode works out: which rows can be typed in and why the others
 * can't, the line under each box, and a save split into steps that each
 * save on their own, so a save that stops part-way says which pages were
 * saved and which were not.
 */
import { describe, expect, it } from "vitest";

import { BULK_SAVE_LIMIT, type BulkRow } from "../../bulk/contract";
import type { SiteAddress } from "../../code-pages/contract";
import type { Problem } from "../../problems/contract";
import {
  boxLine,
  editRowsOf,
  editsAfter,
  saveOutcome,
  saveSteps,
  typesToRead,
  type PageEdits,
  type TypeRows,
} from "../pages-edit";

const post = (id: string, path: string, locale?: string): SiteAddress => ({
  path,
  name: `Post ${id}`,
  source: "entry",
  from: "Posts",
  standing: "listed",
  sources: { title: "pattern", description: "content" },
  titlePattern: "{Title} | Acme",
  title: `Post ${id} | Acme`,
  description: "From the post.",
  entry: {
    kind: "collection",
    slug: "posts",
    id,
    ...(locale === undefined ? {} : { locale }),
  },
});

const ITEMS: SiteAddress[] = [
  post("1", "/blog/one"),
  post("2", "/blog/two"),
  post("1", "/de/blog/eins", "de"),
  {
    path: "/about",
    name: "About",
    source: "entry",
    from: "About page",
    standing: "listed",
    sources: { title: "page" },
    entry: { kind: "single", slug: "about", id: "9" },
  },
  {
    path: "/pricing",
    name: "Pricing",
    source: "built",
    from: "app/pricing/page.tsx",
    standing: "listed",
    sources: { title: "code" },
    seo: {
      typed: { hidden: true, description: "Plans." },
      automatic: { title: { value: "Pricing in code", from: "code" } },
    },
  },
];

const row = (id: string, extra: Partial<BulkRow> = {}): BulkRow => ({
  id,
  label: `Post ${id}`,
  title: "",
  description: "",
  autoTitle: `Post ${id} | Acme`,
  rev: `r${id}`,
  editable: true,
  ...extra,
});

const ROWS: TypeRows = new Map<string, readonly BulkRow[] | Error>([
  ["posts", [row("1"), row("2", { editable: false })]],
  ["single:about", new Error("You can't read the About page.")],
]);

describe("the rows", () => {
  const rows = editRowsOf(ITEMS, ROWS);

  it("reads the types of the pages shown in the site's language", () => {
    expect(typesToRead(ITEMS)).toEqual(["posts", "single:about"]);
  });

  it("types into a page the person may change, and a page built in code", () => {
    expect(rows.map(each => each.target.kind)).toEqual([
      "entry",
      "read-only",
      "read-only",
      "read-only",
      "code",
    ]);
    expect(rows[4]).toMatchObject({
      title: "",
      description: "Plans.",
      autoTitle: "Pricing in code",
    });
  });

  it("says why a row is shown only", () => {
    const why = (at: number) =>
      boxLine(rows[at] as (typeof rows)[number], "title", {}, []).text;
    expect(why(1)).toBe(
      "You can't change this page's SEO here. Open the page to change it."
    );
    expect(why(2)).toBe(
      "A translation is edited on the page, in its language."
    );
    expect(why(3)).toBe("You can't read the About page.");
  });

  it("waits for a type still being read", () => {
    expect(editRowsOf(ITEMS, new Map())[0]?.target.kind).toBe("reading");
  });
});

describe("the line under a box", () => {
  const [one] = editRowsOf(ITEMS, ROWS);
  if (one === undefined) throw new Error("no row");
  const shared: Problem = {
    kind: "sharedTitle",
    subject: { label: "Post 1", type: "posts", id: "1" },
    what: "x",
    action: "x",
    fix: { place: "page", tab: "seo" },
  };

  it("says where an empty box's value comes from", () => {
    expect(boxLine(one, "title", {}, []).text).toBe("Pattern: {Title} | Acme");
    expect(boxLine(one, "description", {}, []).text).toBe("From its content");
  });

  it("counts what is typed, says when it is longer than search shows, and that it changed", () => {
    const edits: PageEdits = { "/blog/one": { title: "Hello" } };
    expect(boxLine(one, "title", edits, []).text).toBe(
      "5 characters · Good · changed"
    );
    const long = { "/blog/one": { title: "x".repeat(80) } };
    expect(boxLine(one, "title", long, [])).toEqual({
      text: "80 characters · Longer than search shows · changed",
      tone: "warning",
    });
  });

  it("says another page has the same value, as the problem list found it", () => {
    const typed = editRowsOf(
      ITEMS,
      new Map([["posts", [row("1", { title: "Same" })]]])
    )[0];
    if (typed === undefined) throw new Error("no row");
    expect(boxLine(typed, "title", {}, [shared]).text).toBe(
      "Same as another page · give it its own"
    );
    expect(boxLine(typed, "description", {}, [shared]).text).not.toContain(
      "Same as"
    );
  });
});

describe("a save", () => {
  const rows = editRowsOf(ITEMS, ROWS);

  it("saves each content type in one step and each page built in code in its own", () => {
    const edits: PageEdits = {
      "/blog/one": { title: "One" },
      // Shown only: never sent.
      "/blog/two": { title: "Two" },
      "/pricing": { title: "Plans and prices" },
    };
    expect(saveSteps(rows, edits)).toEqual([
      {
        kind: "entries",
        type: "posts",
        paths: ["/blog/one"],
        changes: [{ id: "1", rev: "r1", title: "One" }],
      },
      {
        kind: "code",
        paths: ["/pricing"],
        input: {
          path: "/pricing",
          title: "Plans and prices",
          description: "Plans.",
          hidden: true,
        },
      },
    ]);
  });

  it("sends nothing for a box typed back to what the page holds", () => {
    expect(saveSteps(rows, { "/blog/one": { title: "" } })).toEqual([]);
  });

  it("splits a type's pages into saves of the most one save takes", () => {
    const many = Array.from({ length: BULK_SAVE_LIMIT + 1 }, (_, at) =>
      post(String(at), `/blog/${at}`)
    );
    const read = new Map([["posts", many.map((_, at) => row(String(at)))]]);
    const edits = Object.fromEntries(
      many.map(item => [item.path, { title: "New" }])
    );
    const steps = saveSteps(editRowsOf(many, read), edits);
    expect(steps.map(step => step.paths.length)).toEqual([BULK_SAVE_LIMIT, 1]);
  });

  it("says which pages were saved and which were not, and keeps the edits not saved", () => {
    const edits: PageEdits = {
      "/blog/one": { title: "One" },
      "/pricing": { title: "Plans and prices" },
    };
    const [posts, pricing] = saveSteps(rows, edits);
    if (posts === undefined || pricing === undefined) throw new Error("steps");
    const outcome = saveOutcome(
      [
        { step: posts, saved: true },
        { step: pricing, saved: false, message: "The database didn't answer." },
      ],
      rows
    );
    expect(outcome).toEqual({
      saved: ["/blog/one"],
      failed: [{ names: ["Pricing"], message: "The database didn't answer." }],
    });
    expect(editsAfter(edits, outcome.saved)).toEqual({
      "/pricing": { title: "Plans and prices" },
    });
  });
});
