/**
 * A shared style's usage as the route answers it: documents by kind, the
 * blocks on them, and the open field's document reported apart in the parts
 * the editor swaps for its live field, only to a caller who may read it.
 */
import { describe, expect, it, vi } from "vitest";

import {
  SHARED_STYLE_USAGE_ROUTE_PATH,
  sharedStyleUsagePath,
} from "./library-contract";
import {
  hereParts,
  readableHere,
  usageHereOf,
  usageOf,
  type UsageHereReaders,
} from "./shared-style-usage-here";
import type { BlockShare, DocumentsUsing } from "./usage-count";

const kindOf = (collection: string) =>
  collection === "components" ? ("components" as const) : ("pages" as const);

/** One row's share: a field of one copy, holding `blocks`. */
const share = (
  field: string,
  blocks: number | null,
  copy: { locale?: string; variant?: string } = {}
): BlockShare => ({
  locale: copy.locale ?? "",
  variant: copy.variant ?? "published",
  field,
  blocks,
});

const found: DocumentsUsing = {
  collections: [
    {
      collection: "pages",
      documents: ["p1", "p2"],
      shares: [
        [share("content", 2), share("sidebar", 1)],
        [share("content", 1)],
      ],
    },
    {
      collection: "components",
      documents: ["k1"],
      shares: [[share("content", 3)]],
    },
    {
      collection: "home",
      documents: [null],
      shares: [[share("content", 4)]],
      single: true,
    },
  ],
  complete: true,
  countsBlocks: true,
};

/** The editor open on `field` of a document, in the main row, no language. */
const open = (
  document: { collection: string; id: string } | { single: string },
  field = "content"
) => ({ document, field, locale: "", variant: "published" as const });

describe("a style's usage", () => {
  it("counts blocks across its documents, and documents by kind", () => {
    expect(usageOf(found, kindOf)).toEqual({
      documents: 4,
      byKind: { pages: 3, components: 1, patterns: 0, layouts: 0 },
      blocks: 11,
      complete: true,
    });
  });

  it("reports the open field's document in parts, its other fields kept", () => {
    // p1 holds 2 in `content` and 1 in `sidebar`: with `content` open, the
    // sidebar's 1 stays beside whatever the editor holds live.
    expect(
      usageOf(found, kindOf, open({ collection: "pages", id: "p1" })).here
    ).toEqual({ saved: 3, alongside: 1, elsewhere: 0, kind: "pages" });
    expect(
      usageOf(found, kindOf, open({ collection: "components", id: "k1" })).here
    ).toEqual({ saved: 3, alongside: 0, elsewhere: 0, kind: "components" });
  });

  it("reports a Single's parts, matched as a Single", () => {
    expect(usageOf(found, kindOf, open({ single: "home" })).here).toEqual({
      saved: 4,
      alongside: 0,
      elsewhere: 0,
      kind: "pages",
    });
    // A collection of the Single's slug is a different document.
    expect(
      usageOf(found, kindOf, open({ collection: "home", id: "x" })).here
    ).toEqual({ saved: 0, alongside: 0, elsewhere: 0, kind: "pages" });
  });

  it("says 0 throughout for an open entry that does not use the style", () => {
    expect(
      usageOf(found, kindOf, open({ collection: "pages", id: "p9" })).here
    ).toEqual({ saved: 0, alongside: 0, elsewhere: 0, kind: "pages" });
  });

  it("is a floor while any document's blocks are not counted", () => {
    const usage = usageOf(
      {
        collections: [
          {
            collection: "pages",
            documents: ["p1", "p2"],
            shares: [[share("content", 2)], [share("content", null)]],
          },
        ],
        complete: true,
        countsBlocks: true,
      },
      kindOf,
      open({ collection: "pages", id: "p2" })
    );
    expect(usage).toMatchObject({ blocks: 2, complete: false });
    // The open document is in the listing with its count unknown: said so,
    // never as 0, which would count its page a second time.
    expect(usage.here).toEqual({
      saved: null,
      alongside: 0,
      elsewhere: 0,
      kind: "pages",
    });
  });

  it("counts no blocks for an index that keeps none", () => {
    const usage = usageOf(
      {
        collections: [{ collection: "pages", documents: ["p1"] }],
        complete: true,
      },
      kindOf,
      open({ collection: "pages", id: "p1" })
    );
    expect(usage.blocks).toBeUndefined();
    expect(usage.here).toBeUndefined();
    expect(usage.complete).toBe(true);
  });
});

describe("the open document's parts", () => {
  const editing = (
    field: string,
    locale = "",
    variant: "published" | "draft" = "published"
  ) => ({ field, locale, variant });

  it("keeps the published copy apart while its pending draft is open", () => {
    // Published: 3 in `content`. The draft open in the editor: 1. Whatever
    // the draft holds live, the published page still holds its 3.
    const shares = [
      share("content", 3),
      share("content", 1, { variant: "draft" }),
    ];
    expect(hereParts(shares, editing("content", "", "draft"))).toEqual({
      saved: 3,
      alongside: 0,
      elsewhere: 3,
    });
    // The main row open instead: the draft is the other copy.
    expect(hereParts(shares, editing("content"))).toEqual({
      saved: 3,
      alongside: 0,
      elsewhere: 1,
    });
  });

  it("keeps a published page's saved copy beside an edit not yet published", () => {
    // Published with no pending draft: a save makes a draft beside it, and
    // the live page keeps its 3 blocks until the edit is published.
    const shares = [share("content", 3), share("sidebar", 1)];
    expect(
      hereParts(shares, { ...editing("content"), keepsSaved: true })
    ).toEqual({ saved: 4, alongside: 1, elsewhere: 4 });
    // Not kept: the edit replaces it.
    expect(hereParts(shares, editing("content"))).toEqual({
      saved: 4,
      alongside: 1,
      elsewhere: 0,
    });
  });

  it("swaps only the edited language of a translated field", () => {
    // English `content` 2, French `content` 3, and a `sidebar` every
    // language shares holding 1: English is 3, French 4.
    const shares = [
      share("content", 2, { locale: "en" }),
      share("content", 3, { locale: "fr" }),
      share("sidebar", 1),
    ];
    expect(hereParts(shares, editing("content", "en"))).toEqual({
      saved: 4,
      alongside: 1,
      elsewhere: 4,
    });
  });

  it("swaps a field every language shares in each language's copy", () => {
    const shares = [
      share("content", 2, { locale: "en" }),
      share("content", 3, { locale: "fr" }),
      share("sidebar", 1),
    ];
    // The open `sidebar` is in both copies: the larger without it is 3.
    expect(hereParts(shares, editing("sidebar", "en"))).toEqual({
      saved: 4,
      alongside: 3,
      elsewhere: 0,
    });
  });

  it("says the parts are unknown where the rows cannot place the open field", () => {
    // `aside` has no rows: shared by every language, its live blocks would
    // count in French too, which holds more; the edited language's own,
    // they would not. The two readings differ, so nothing is claimed.
    const shares = [
      share("content", 2, { locale: "en" }),
      share("content", 3, { locale: "fr" }),
    ];
    expect(hereParts(shares, editing("aside", "en")).alongside).toBeNull();
    // Where the edited language's copy is the largest, both readings agree.
    expect(hereParts(shares, editing("aside", "fr"))).toEqual({
      saved: 3,
      alongside: 3,
      elsewhere: 2,
    });
  });

  it("carries an unknown count through, never as 0", () => {
    const shares = [share("content", 2), share("sidebar", null)];
    expect(hereParts(shares, editing("content"))).toEqual({
      saved: null,
      alongside: null,
      elsewhere: 0,
    });
  });
});

describe("what the editor has open, as the usage read names it", () => {
  const url = (here: string, extra = "&hereField=content&hereVariant=draft") =>
    `https://site.test/x?here=${encodeURIComponent(here)}${extra}`;

  it("reads a document, its field, its language and its stored form", () => {
    expect(
      usageHereOf(
        url("pages/p1", "&hereField=content&hereLocale=fr&hereVariant=draft")
      )
    ).toEqual({
      document: { collection: "pages", id: "p1" },
      field: "content",
      locale: "fr",
      variant: "draft",
    });
    expect(
      usageHereOf(
        url(
          "pages/p1",
          "&hereField=content&hereVariant=published&hereKeepsSaved=1"
        )
      )
    ).toEqual({
      document: { collection: "pages", id: "p1" },
      field: "content",
      variant: "published",
      keepsSaved: true,
    });
    expect(usageHereOf(url("pages/a/b"))?.document).toEqual({
      collection: "pages",
      id: "a/b",
    });
    expect(usageHereOf(url("single:home"))).toEqual({
      document: { single: "home" },
      field: "content",
      variant: "draft",
    });
  });

  it("names nothing for a value that names no document, field or form", () => {
    expect(usageHereOf("https://site.test/x")).toBeUndefined();
    for (const value of ["", "pages", "/p1", "pages/", "single:"]) {
      expect(usageHereOf(url(value))).toBeUndefined();
    }
    expect(usageHereOf(url("pages/p1", "&hereVariant=draft"))).toBeUndefined();
    expect(
      usageHereOf(url("pages/p1", "&hereField=content&hereVariant=old"))
    ).toBeUndefined();
  });

  it("is the shape the browser's path asks in", () => {
    const path = sharedStyleUsagePath(["c-a"], {
      document: { collection: "pages", id: "p1" },
      field: "content",
      locale: "fr",
      variant: "published",
      keepsSaved: true,
    });
    expect(path.startsWith(`${SHARED_STYLE_USAGE_ROUTE_PATH}?`)).toBe(true);
    expect(usageHereOf(`https://site.test/${path}`)).toEqual({
      document: { collection: "pages", id: "p1" },
      field: "content",
      locale: "fr",
      variant: "published",
      keepsSaved: true,
    });
  });
});

describe("the open document, only as far as the caller may read it", () => {
  const readers = (readable: boolean): UsageHereReaders => ({
    named: vi.fn(async (_collection: string, ids: readonly string[]) =>
      readable ? ids.map(id => ({ id, title: id })) : null
    ),
    single: vi.fn(async (slug: string) => (readable ? slug : null)),
    defaultLocale: () => "en",
  });
  const asked = (here: string, locale = "") =>
    `https://site.test/x?here=${encodeURIComponent(here)}&hereField=content&hereVariant=published${locale}`;

  it("names a document the caller may read, in the site's default language", async () => {
    const may = readers(true);
    expect(await readableHere(asked("pages/p1"), may)).toEqual({
      document: { collection: "pages", id: "p1" },
      field: "content",
      locale: "en",
      variant: "published",
    });
    expect(may.named).toHaveBeenCalledWith("pages", ["p1"]);
    expect(
      (await readableHere(asked("single:home", "&hereLocale=fr"), may))?.locale
    ).toBe("fr");
  });

  it("names nothing the caller may not read", async () => {
    const mayNot = readers(false);
    expect(await readableHere(asked("pages/p1"), mayNot)).toBeUndefined();
    expect(await readableHere(asked("single:home"), mayNot)).toBeUndefined();
    // A read that fails (an id the database cannot take) names nothing,
    // rather than failing the whole usage read.
    expect(
      await readableHere(asked("pages/not-an-id"), {
        ...mayNot,
        named: async () => {
          throw new Error("invalid input syntax for type uuid");
        },
      })
    ).toBeUndefined();
    // Read, but another document answered: not the one named.
    expect(
      await readableHere(asked("pages/p1"), {
        ...mayNot,
        named: async () => [{ id: "p2" }],
      })
    ).toBeUndefined();
  });
});
