/**
 * The removal's rescan, against fake stored documents: which rows still
 * reference a style, read through the blocks fields the builder opens, a page
 * at a time by id, in every stored form; and the refusal's words.
 */
import {
  DEFAULT_LIMITS,
  DOCUMENT_FORMAT_VERSION,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { classUsageOf } from "./class-usage";
import type { ClassUsageDirectApi } from "./class-usage-runtime";
import {
  referencesAny,
  stillUsedMessage,
  storedUsesOf,
  type StoredDocuments,
} from "./shared-style-rescan";
import { storedDocumentsOf } from "./shared-styles-routes";
import type { BuilderDocumentType } from "./site-style-route";
import { tokenUsageOf } from "./token-usage";

/** The shared styles' extractor, as the remove route hands it. */
const classes = (stored: unknown) => classUsageOf(stored).ids;

/** A stored block document whose one node carries `classes`. */
const blocks = (...classes: string[]) => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    {
      id: "n",
      type: "core/heading",
      version: 1,
      props: { text: "n", level: 2 },
      classes,
    },
  ],
});

const pages: BuilderDocumentType = {
  slug: "pages",
  label: "Pages",
  paths: ["content"],
};

describe("whether a stored row references a style", () => {
  const ids = new Set(["c-card"]);

  it("reads a blocks field inside a group, and a group stored as text", () => {
    expect(
      referencesAny(
        { hero: { body: blocks("c-card") } },
        ["hero.body"],
        ids,
        classes
      )
    ).toBe(true);
    expect(
      referencesAny(
        { hero: JSON.stringify({ body: blocks("c-card") }) },
        ["hero.body"],
        ids,
        classes
      )
    ).toBe(true);
  });

  it("reads a blocks field in every row of a repeater, rows stored as text too", () => {
    // Only the second row uses the style: a reader of one row, or of none,
    // would take it for unused.
    const rows = [
      { id: "r1", body: blocks("c-hero") },
      { id: "r2", body: blocks("c-card") },
    ];
    expect(
      referencesAny({ sections: rows }, ["sections.body"], ids, classes)
    ).toBe(true);
    expect(
      referencesAny(
        { sections: JSON.stringify(rows) },
        ["sections.body"],
        ids,
        classes
      )
    ).toBe(true);
    expect(
      referencesAny(
        { sections: [{ id: "r1", body: blocks("c-hero") }] },
        ["sections.body"],
        ids,
        classes
      )
    ).toBe(false);
  });

  it("reads a blocks field in a repeater inside a row of another", () => {
    expect(
      referencesAny(
        {
          sections: [
            { id: "s1", columns: [{ id: "c1", body: blocks() }] },
            { id: "s2", columns: [{ id: "c2", body: blocks("c-card") }] },
          ],
        },
        ["sections.columns.body"],
        ids,
        classes
      )
    ).toBe(true);
  });

  it("reads only the fields named, and only the ids asked about", () => {
    expect(
      referencesAny({ other: blocks("c-card") }, ["content"], ids, classes)
    ).toBe(false);
    expect(
      referencesAny({ content: blocks("c-hero") }, ["content"], ids, classes)
    ).toBe(false);
  });
});

/**
 * Stored documents: `rows` per collection, by id order, `size` to a page,
 * and each row's other stored forms by its id.
 */
function storedOf(
  rows: Record<string, unknown>[],
  singles: { type: BuilderDocumentType; forms: unknown[] }[] = [],
  size = 2,
  forms: Record<string, unknown[] | Error> = {}
): { documents: StoredDocuments; cursors: (string | undefined)[] } {
  const cursors: (string | undefined)[] = [];
  const documents: StoredDocuments = {
    collections: async () => [pages],
    singles: async () => singles.map(single => single.type),
    rowsAfter: async (_type, after) => {
      cursors.push(after);
      const rest = rows.filter(
        row => after === undefined || String(row.id) > after
      );
      return { items: rest.slice(0, size), hasNext: rest.length > size };
    },
    rowForms: async (_type, id) => {
      const found = Object.hasOwn(forms, id) ? forms[id] : [];
      if (found instanceof Error) throw found;
      return found ?? [];
    },
    singleForms: async type =>
      singles.find(single => single.type.slug === type.slug)?.forms ?? [],
  };
  return { documents, cursors };
}

describe("every stored document still using a style", () => {
  it("walks every page of a collection by id, and names each row using one", async () => {
    const { documents, cursors } = storedOf([
      { id: "a", content: blocks() },
      { id: "b", content: blocks("c-card") },
      { id: "c", content: blocks("c-hero") },
      { id: "d", content: blocks("c-card", "c-hero") },
      { id: "e", content: blocks() },
    ]);
    expect(await storedUsesOf(["c-card"], documents, classes)).toEqual([
      { kind: "collection", slug: "pages", id: "b" },
      { kind: "collection", slug: "pages", id: "d" },
    ]);
    // Resumed after the last id read, never by an offset.
    expect(cursors).toEqual([undefined, "b", "d"]);
  });

  it("reads a Single's draft as well as its document, and names it by label", async () => {
    const home: BuilderDocumentType = {
      slug: "home",
      label: "Home",
      paths: ["body"],
    };
    const { documents } = storedOf(
      [],
      [{ type: home, forms: [{ body: blocks() }, { body: blocks("c-card") }] }]
    );
    expect(await storedUsesOf(["c-card"], documents, classes)).toEqual([
      { kind: "single", slug: "home", id: "", label: "Home" },
    ]);
  });

  it("reads each document by the extractor it is handed: variables too", async () => {
    // The same rows, asked about a variable through the variable index's own
    // walk. The class extractor finds nothing here, which is the control.
    const usingBrand = {
      ...blocks(),
      nodes: [
        {
          ...blocks().nodes[0],
          styles: { base: { base: { color: { $token: "color.brand" } } } },
        },
      ],
    };
    const { documents } = storedOf([
      { id: "a", content: blocks("color.brand") },
      { id: "b", content: usingBrand },
    ]);
    const tokens = (stored: unknown) =>
      tokenUsageOf(stored, DEFAULT_LIMITS).ids;

    expect(await storedUsesOf(["color.brand"], documents, tokens)).toEqual([
      { kind: "collection", slug: "pages", id: "b" },
    ]);
    expect(
      await storedUsesOf(
        ["color.brand"],
        storedOf([{ id: "b", content: usingBrand }]).documents,
        classes
      )
    ).toEqual([]);
  });

  it("finds a use held only by a row's other stored forms, and reads them only when the listed one has none", async () => {
    const asked: string[] = [];
    const { documents } = storedOf(
      [
        { id: "a", content: blocks("c-card") },
        { id: "b", content: blocks() },
        { id: "c", content: blocks() },
      ],
      [],
      2,
      // `b`'s pending draft, or one of its languages, places the style.
      { b: [{ content: blocks() }, { content: blocks("c-card") }] }
    );
    const rowForms = documents.rowForms;
    documents.rowForms = async (type, id) => {
      asked.push(id);
      return rowForms(type, id);
    };
    expect(await storedUsesOf(["c-card"], documents, classes)).toEqual([
      { kind: "collection", slug: "pages", id: "a" },
      { kind: "collection", slug: "pages", id: "b" },
    ]);
    // `a` was found in the listed form, so its other forms were not read.
    expect(asked).toEqual(["b", "c"]);
  });

  it("refuses when a row's other form cannot be read, rather than taking it for unused", async () => {
    const { documents } = storedOf([{ id: "a", content: blocks() }], [], 2, {
      a: new Error("the draft read failed"),
    });
    await expect(
      storedUsesOf(["c-card"], documents, classes)
    ).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      logContext: { reason: "shared-style-rescan-form-unreadable", id: "a" },
    });
  });

  it("refuses a row with no id, rather than passing over it", async () => {
    const { documents } = storedOf([{ content: blocks("c-card") }]);
    await expect(
      storedUsesOf(["c-card"], documents, classes)
    ).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
  });
});

describe("the stored documents, as the rescan reads them on a real site", () => {
  /** A site with one pages collection holding `content`, in these languages. */
  function siteOf(locales: readonly string[]) {
    return {
      self: { collections: {}, singles: {} },
      config:
        locales.length === 0
          ? {}
          : { localization: { locales: locales.map(code => ({ code })) } },
      services: {
        collections: {
          listCollections: async () => ({
            data: [
              {
                slug: "pages",
                label: "Pages",
                fields: [{ name: "content", type: "blocks" }],
              },
            ],
            pagination: { hasMore: false },
          }),
        },
        singles: { list: async () => ({ data: [], total: 0 }) },
      },
    };
  }

  /**
   * The Direct API over stored forms keyed `id|locale|form`, recording each
   * by-id read. A draft form is answered as the overlay answers one; any
   * form not stored answers the live row, as a read without a sidecar does.
   */
  function directApiOf(
    listed: Record<string, unknown>[],
    stored: Record<string, unknown>
  ) {
    const reads: string[] = [];
    const findByID: ClassUsageDirectApi["findByID"] = async args => {
      const key = `${args.id}|${args.locale ?? ""}|${args.draft === true ? "draft" : "published"}`;
      reads.push(`${key}|fallback:${String(args.fallbackLocale)}`);
      if (Object.hasOwn(stored, key)) {
        return {
          id: args.id,
          content: stored[key],
          ...(args.draft === true ? { _isWorkingDraft: true } : {}),
        };
      }
      return { id: args.id, content: blocks() };
    };
    return {
      reads,
      nextly: {
        find: async () => ({ items: listed, meta: { hasNext: false } }),
        findByID,
        findSingle: async () => null,
      },
    };
  }

  it("finds a style used only inside a repeater's row, on a collection whose only blocks field is there", async () => {
    // The collection declares no blocks field outside its repeater, so it is
    // a document the builder edits only through a row; a removal must still
    // see the row's use and be refused.
    const site = {
      self: { collections: {}, singles: {} },
      config: {},
      services: {
        collections: {
          listCollections: async () => ({
            data: [
              {
                slug: "landing",
                label: "Landing",
                fields: [
                  {
                    name: "sections",
                    type: "repeater",
                    fields: [
                      { name: "heading", type: "text" },
                      { name: "body", type: "blocks" },
                    ],
                  },
                ],
              },
            ],
            pagination: { hasMore: false },
          }),
        },
        singles: { list: async () => ({ data: [], total: 0 }) },
      },
    };
    const sections = [
      { id: "r1", heading: "One", body: blocks() },
      { id: "r2", heading: "Two", body: blocks("c-card") },
    ];
    const selects: unknown[] = [];
    const nextly = {
      find: async (args: { select?: unknown }) => {
        selects.push(args.select);
        return {
          items: [{ id: "l1", sections }],
          meta: { hasNext: false },
        };
      },
      findByID: (async args => ({
        id: args.id,
        sections,
      })) as ClassUsageDirectApi["findByID"],
      findSingle: async () => null,
    };
    expect(
      await storedUsesOf(
        ["c-card"],
        storedDocumentsOf(site as never, nextly as never),
        classes
      )
    ).toEqual([{ kind: "collection", slug: "landing", id: "l1" }]);
    // The repeater's column is the one read for its rows' blocks.
    expect(selects).toEqual([{ id: true, sections: true }]);
  });

  it("finds a use only a non-default language stores, reading each language with its fallback off", async () => {
    const { nextly, reads } = directApiOf([{ id: "p1", content: blocks() }], {
      "p1|fr|published": blocks("c-card"),
    });
    expect(
      await storedUsesOf(
        ["c-card"],
        storedDocumentsOf(siteOf(["en", "fr"]) as never, nextly),
        classes
      )
    ).toEqual([{ kind: "collection", slug: "pages", id: "p1" }]);
    expect(reads).toEqual([
      "p1|en|published|fallback:false",
      "p1|en|draft|fallback:false",
      "p1|fr|published|fallback:false",
      "p1|fr|draft|fallback:false",
    ]);
  });

  it("finds a use only a pending working draft holds, on a site without languages", async () => {
    const { nextly, reads } = directApiOf([{ id: "p1", content: blocks() }], {
      "p1||draft": blocks("c-card"),
    });
    expect(
      await storedUsesOf(
        ["c-card"],
        storedDocumentsOf(siteOf([]) as never, nextly),
        classes
      )
    ).toEqual([{ kind: "collection", slug: "pages", id: "p1" }]);
    // The listed row is the default form, so only the draft is read again.
    expect(reads).toEqual(["p1||draft|fallback:undefined"]);
  });

  it("passes a row none of whose forms holds the style", async () => {
    // The control for the two above: every form is read, and none holds it.
    const { nextly } = directApiOf([{ id: "p1", content: blocks() }], {});
    expect(
      await storedUsesOf(
        ["c-card"],
        storedDocumentsOf(siteOf(["en", "fr"]) as never, nextly),
        classes
      )
    ).toEqual([]);
  });

  it("refuses when a form's read fails", async () => {
    const { nextly } = directApiOf([{ id: "p1", content: blocks() }], {});
    nextly.findByID = async () => {
      throw new Error("the companion table is unreadable");
    };
    await expect(
      storedUsesOf(
        ["c-card"],
        storedDocumentsOf(siteOf(["en"]) as never, nextly),
        classes
      )
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  });
});

describe("the words a removal is refused with", () => {
  it("names the first document the caller may open, and counts the rest", () => {
    expect(stillUsedMessage(3, "Home", 1)).toBe(
      "Still used on Home and 2 more. Remove it from those pages first."
    );
    expect(stillUsedMessage(1, "Home", 2)).toBe(
      "Still used on Home. Remove them from that page first."
    );
  });

  it("names nothing the caller may not open", () => {
    expect(stillUsedMessage(2, undefined, 1)).toBe(
      "Still used on 2 pages you can't open. Ask someone who can open them to remove it first."
    );
  });
});
