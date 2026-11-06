/**
 * The removal's rescan, against fake stored documents: which rows still
 * reference a style, read through the blocks fields the builder opens, a page
 * at a time by id; and the refusal's words.
 */
import {
  DEFAULT_LIMITS,
  DOCUMENT_FORMAT_VERSION,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { classUsageOf } from "./class-usage";
import {
  referencesAny,
  stillUsedMessage,
  storedUsesOf,
  type StoredDocuments,
} from "./shared-style-rescan";
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

  it("reads only the fields named, and only the ids asked about", () => {
    expect(
      referencesAny({ other: blocks("c-card") }, ["content"], ids, classes)
    ).toBe(false);
    expect(
      referencesAny({ content: blocks("c-hero") }, ["content"], ids, classes)
    ).toBe(false);
  });
});

/** Stored documents: `rows` per collection, by id order, `size` to a page. */
function storedOf(
  rows: Record<string, unknown>[],
  singles: { type: BuilderDocumentType; forms: unknown[] }[] = [],
  size = 2
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

  it("refuses a row with no id, rather than passing over it", async () => {
    const { documents } = storedOf([{ content: blocks("c-card") }]);
    await expect(
      storedUsesOf(["c-card"], documents, classes)
    ).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
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
