/**
 * The picker's six: most added first, the default six for an author with no
 * history, ties broken by the default order, blocks the place refuses skipped
 * so the next takes their seat, and saved sections, components and
 * variations never counted into the grid. And the counts themselves, kept
 * through a store that may fail.
 *
 * @module insert-usage.test
 */
import { describe, expect, it } from "vitest";

import type { PreferenceStore } from "../../shell-state";

import type { InsertEntry } from "./inserter-types";
import {
  DEFAULT_MOST_USED,
  mostUsedEntries,
  readInsertCounts,
  recordInsert,
} from "./insert-usage";

/** A block's own entry, as the catalogue builds one. */
function block(name: string, variationName?: string): InsertEntry {
  return {
    kind: "block",
    id: variationName === undefined ? name : `${name}#${variationName}`,
    blockName: name,
    ...(variationName === undefined ? {} : { variationName }),
    label: name.replace("core/", ""),
    description: "",
    category: "content",
    keywords: [],
    version: 1,
    props: {},
  };
}

/** Every core block the picker might show, in a palette's order. */
const PALETTE: readonly InsertEntry[] = [
  "core/section",
  "core/box",
  "core/columns",
  "core/heading",
  "core/text",
  "core/quote",
  "core/image",
  "core/gallery",
  "core/button",
  "core/accordion",
].map(name => block(name));

const names = (entries: readonly InsertEntry[]): string[] =>
  entries.map(entry => (entry.kind === "block" ? entry.blockName : entry.id));

/** A store holding one text, which can be told to fail. */
function memoryStore(
  initial: string | null = null,
  fails: { read?: boolean; write?: boolean } = {}
): PreferenceStore & { value: string | null } {
  const store = {
    value: initial,
    read: () => {
      if (fails.read === true) throw new Error("storage refused");
      return store.value;
    },
    write: (value: string) => {
      if (fails.write === true) throw new Error("quota");
      store.value = value;
    },
  };
  return store;
}

describe("the six most used", () => {
  it("are the default six, in their order, for an author with no inserts", () => {
    expect(names(mostUsedEntries(PALETTE, {}))).toEqual([...DEFAULT_MOST_USED]);
    expect(DEFAULT_MOST_USED).toEqual([
      "core/heading",
      "core/text",
      "core/image",
      "core/button",
      "core/box",
      "core/columns",
    ]);
  });

  it("put the most added first", () => {
    const six = mostUsedEntries(PALETTE, {
      "core/quote": 3,
      "core/gallery": 5,
      "core/heading": 1,
    });
    expect(names(six)).toEqual([
      "core/gallery",
      "core/quote",
      "core/heading",
      "core/text",
      "core/image",
      "core/button",
    ]);
  });

  it("break a tie by the default order, not the palette's", () => {
    // Box comes before Heading in the palette; the default order puts
    // Heading first, and an unranked block after every default one.
    const six = mostUsedEntries(PALETTE, {
      "core/box": 2,
      "core/heading": 2,
      "core/accordion": 2,
    });
    expect(names(six).slice(0, 3)).toEqual([
      "core/heading",
      "core/box",
      "core/accordion",
    ]);
  });

  it("skip a block the place refuses, so the next one shows", () => {
    // The caller hands only what the place accepts: here no Image.
    const offered = PALETTE.filter(
      entry => entry.kind !== "block" || entry.blockName !== "core/image"
    );
    expect(names(mostUsedEntries(offered, {}))).toEqual([
      "core/heading",
      "core/text",
      "core/button",
      "core/box",
      "core/columns",
      // The first block past the defaults, in the palette's order.
      "core/section",
    ]);
  });

  it("show fewer than six only where fewer are offered", () => {
    const offered = [block("core/column")];
    expect(names(mostUsedEntries(offered, {}))).toEqual(["core/column"]);
  });

  it("never count a saved section, a component or a variation into the grid", () => {
    const pattern: InsertEntry = {
      kind: "pattern",
      id: "pattern:hero",
      patternId: "hero",
      label: "Hero",
      description: "",
      category: "other",
      keywords: [],
      document: { formatVersion: 1, kind: "pattern", nodes: [] },
    } as unknown as InsertEntry;
    const component: InsertEntry = {
      kind: "component",
      id: "component:card",
      label: "Card",
      description: "",
      category: "nextly:components",
      keywords: [],
      roots: ["core/box"],
    } as unknown as InsertEntry;
    const six = mostUsedEntries(
      [pattern, component, block("core/heading", "large"), ...PALETTE],
      { "core/heading": 9 }
    );
    expect(six.map(entry => entry.id)).not.toContain("pattern:hero");
    expect(six.map(entry => entry.id)).not.toContain("component:card");
    expect(six.map(entry => entry.id)).not.toContain("core/heading#large");
    expect(six[0]?.id).toBe("core/heading");
  });
});

describe("the insert counts", () => {
  it("count each insert of a block, and read back what was counted", () => {
    const store = memoryStore();
    recordInsert(store, "core/quote");
    recordInsert(store, "core/quote");
    recordInsert(store, "core/heading");
    expect(readInsertCounts(store)).toEqual({
      "core/quote": 2,
      "core/heading": 1,
    });
  });

  it("read nothing from a store that is empty, refuses, or holds junk", () => {
    expect(readInsertCounts(undefined)).toEqual({});
    expect(readInsertCounts(memoryStore())).toEqual({});
    expect(readInsertCounts(memoryStore("{", {}))).toEqual({});
    expect(readInsertCounts(memoryStore(null, { read: true }))).toEqual({});
    expect(
      readInsertCounts(
        memoryStore(
          JSON.stringify({
            counts: { "core/text": 2, "core/box": -1, "core/image": "4" },
          })
        )
      )
    ).toEqual({ "core/text": 2 });
  });

  it("keep what they had when the store cannot be written", () => {
    const store = memoryStore(JSON.stringify({ counts: { "core/text": 1 } }), {
      write: true,
    });
    expect(() => recordInsert(store, "core/text")).not.toThrow();
    expect(readInsertCounts(store)).toEqual({ "core/text": 1 });
  });
});
