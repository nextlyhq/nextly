/**
 * What a document can say about itself, and what it must refuse to guess.
 */
import { describe, expect, it } from "vitest";

import type { BlockSeoContribution } from "./block";
import { deriveSeoFromDocument, type SeoDefinitionSource } from "./derive-seo";
import type { BlockDocument, BlockNode } from "./document";
import { DOCUMENT_FORMAT_VERSION } from "./document";

function node(
  id: string,
  type: string,
  props: Record<string, unknown> = {},
  slots?: Record<string, BlockNode[]>
): BlockNode {
  const n: BlockNode = { id, type, version: 1, props };
  if (slots) n.slots = slots;
  return n;
}

/** The rule the renderer uses: a node with conditions is withheld. */
function visible(node: BlockNode): boolean {
  const conditions = (node.visibility as { conditions?: unknown } | undefined)
    ?.conditions;
  return !Array.isArray(conditions) || conditions.length === 0;
}

function doc(nodes: BlockNode[]): BlockDocument {
  return { formatVersion: DOCUMENT_FORMAT_VERSION, kind: "page", nodes };
}

/** Definitions for the three core shapes, plus anything a test adds. */
function definitions(
  extra: Record<string, (props: never) => BlockSeoContribution | undefined> = {}
): SeoDefinitionSource {
  const map: Record<
    string,
    { seo?: (props: never) => BlockSeoContribution | undefined }
  > = {
    "core/heading": {
      seo: (p: never) => ({ title: (p as { text?: string }).text }),
    },
    "core/paragraph": {
      seo: (p: never) => ({ description: (p as { text?: string }).text }),
    },
    "core/image": {
      seo: (p: never) => ({
        image: { media: (p as { mediaId?: string }).mediaId ?? "" },
      }),
    },
    "core/box": { slots: { children: {} } },
    "plugin/two": { slots: { first: {}, second: {} } },
    ...Object.fromEntries(
      Object.entries(extra).map(([k, v]) => [
        k,
        { seo: v, slots: { first: {}, second: {} } },
      ])
    ),
  };
  return type => map[type];
}

describe("deriveSeoFromDocument", () => {
  it("takes each field from the first block that offers it", () => {
    const derived = deriveSeoFromDocument(
      doc([
        node("1", "core/heading", { text: "Pricing" }),
        node("2", "core/paragraph", { text: "Plans for every team." }),
        node("3", "core/image", { mediaId: "m1" }),
      ]),
      definitions(),
      visible
    );

    expect(derived).toEqual({
      title: "Pricing",
      description: "Plans for every team.",
      image: [{ kind: "media", value: "m1" }],
    });
  });

  it("fills each field independently, whatever the document order", () => {
    // A page opening with an image and heading later must take both. Stopping
    // at the first block that answered ANYTHING would make the result depend
    // on ordering the author cannot see.
    const derived = deriveSeoFromDocument(
      doc([
        node("1", "core/image", { mediaId: "hero" }),
        node("2", "core/heading", { text: "About" }),
      ]),
      definitions(),
      visible
    );

    expect(derived).toEqual({
      title: "About",
      image: [{ kind: "media", value: "hero" }],
    });
  });

  it("keeps the FIRST of a repeated field, not the last", () => {
    const derived = deriveSeoFromDocument(
      doc([
        node("1", "core/heading", { text: "First" }),
        node("2", "core/heading", { text: "Second" }),
      ]),
      definitions(),
      visible
    );

    expect(derived.title).toBe("First");
  });

  it("descends into slots, so a heading inside a section still counts", () => {
    const derived = deriveSeoFromDocument(
      doc([
        node(
          "1",
          "core/box",
          {},
          {
            children: [node("2", "core/heading", { text: "Nested" })],
          }
        ),
      ]),
      definitions(),
      visible
    );

    expect(derived.title).toBe("Nested");
  });

  it("omits a field nothing answered for, rather than setting it undefined", () => {
    // The result is spread over a caller's own fallbacks, so a present key
    // holding `undefined` would erase a value that was already known.
    const derived = deriveSeoFromDocument(
      doc([node("1", "core/heading", { text: "Only a title" })]),
      definitions(),
      visible
    );

    expect(Object.keys(derived)).toEqual(["title"]);
    expect("description" in derived).toBe(false);
  });

  it("ignores blank and whitespace-only offers", () => {
    const derived = deriveSeoFromDocument(
      doc([
        node("1", "core/heading", { text: "   " }),
        node("2", "core/heading", { text: "Real" }),
      ]),
      definitions(),
      visible
    );

    expect(derived.title).toBe("Real");
  });

  it("trims what it takes", () => {
    const derived = deriveSeoFromDocument(
      doc([node("1", "core/heading", { text: "  Padded  " })]),
      definitions(),
      visible
    );

    expect(derived.title).toBe("Padded");
  });

  it("survives a block whose seo throws", () => {
    // Third-party code on the metadata path, and metadata generation runs
    // before the page renders — so a throw here would fail the whole route
    // rather than cost one field.
    const derived = deriveSeoFromDocument(
      doc([
        node("1", "plugin/hostile", {}),
        node("2", "core/heading", { text: "Still here" }),
      ]),
      definitions({
        "plugin/hostile": () => {
          throw new Error("boom");
        },
      }),
      visible
    );

    expect(derived.title).toBe("Still here");
  });

  it("ignores a block type nothing has registered", () => {
    const derived = deriveSeoFromDocument(
      doc([
        node("1", "plugin/unknown", { text: "invisible" }),
        node("2", "core/heading", { text: "Known" }),
      ]),
      definitions(),
      visible
    );

    expect(derived.title).toBe("Known");
  });

  it("lets a contributed block answer, not just the core library", () => {
    // The reason the offer is declared by the block: a page built mostly from
    // third-party blocks is exactly the one with nothing else to fall back on.
    const derived = deriveSeoFromDocument(
      doc([node("1", "plugin/hero", { headline: "Contributed" })]),
      definitions({
        "plugin/hero": (p: never) => ({
          title: (p as { headline?: string }).headline,
        }),
      }),
      visible
    );

    expect(derived.title).toBe("Contributed");
  });

  it("normalizes a single image offer into a candidate list", () => {
    const derived = deriveSeoFromDocument(
      doc([node("1", "core/image", { mediaId: "m1" })]),
      definitions(),
      visible
    );

    expect(derived.image).toEqual([{ kind: "media", value: "m1" }]);
  });

  it("keeps a block's image candidates in the order it offered them", () => {
    // The block's preference AND its fallback: an image renders the resolved
    // media when it can and the typed URL when it cannot, so both travel.
    const derived = deriveSeoFromDocument(
      doc([node("1", "plugin/pic", {})]),
      definitions({
        "plugin/pic": () => ({
          image: [{ media: "m1" }, { url: "/fallback.png" }],
        }),
      }),
      visible
    );

    expect(derived.image).toEqual([
      { kind: "media", value: "m1" },
      { kind: "url", value: "/fallback.png" },
    ]);
  });

  it("drops blank entries from a candidate list", () => {
    const derived = deriveSeoFromDocument(
      doc([node("1", "plugin/pic", {})]),
      definitions({
        "plugin/pic": () => ({ image: ["", "  ", "/real.png"] }),
      }),
      visible
    );

    // A bare string means a URL: the safe reading, since a wrong URL renders a
    // broken image while a wrong media lookup silently drops the picture.
    expect(derived.image).toEqual([{ kind: "url", value: "/real.png" }]);
  });

  it("ignores a block offering only blank candidates", () => {
    const derived = deriveSeoFromDocument(
      doc([
        node("1", "plugin/pic", {}),
        node("2", "core/image", { mediaId: "m2" }),
      ]),
      definitions({ "plugin/pic": () => ({ image: [] }) }),
      visible
    );

    expect(derived.image).toEqual([{ kind: "media", value: "m2" }]);
  });

  it("takes nothing from a gated node", () => {
    // A conditioned node is omitted from server output, so deriving a page
    // TITLE from it publishes the withheld text on every search result.
    const gated = node("1", "core/heading", { text: "Members only" });
    gated.visibility = {
      conditions: [[{ field: "tier", op: "eq", value: "x" }]],
    };

    const derived = deriveSeoFromDocument(
      doc([gated, node("2", "core/heading", { text: "Public" })]),
      definitions(),
      visible
    );

    expect(derived.title).toBe("Public");
  });

  it("takes nothing from BENEATH a gated node either", () => {
    // The whole subtree leaves the output, so a visible-looking child of a
    // hidden container must not speak for a page it never reaches. An
    // immediate-parent check would miss a gated GRANDparent.
    const gated = node(
      "1",
      "core/box",
      {},
      {
        children: [
          node(
            "2",
            "core/box",
            {},
            {
              children: [node("3", "core/heading", { text: "Buried" })],
            }
          ),
        ],
      }
    );
    gated.visibility = {
      conditions: [[{ field: "tier", op: "eq", value: "x" }]],
    };

    const derived = deriveSeoFromDocument(
      doc([gated, node("4", "core/heading", { text: "Public" })]),
      definitions(),
      visible
    );

    expect(derived.title).toBe("Public");
  });

  it("keeps a later image's candidates after an earlier one", () => {
    // Whether a candidate yields a picture is decided AFTER this walk, so a
    // first image offering only a deleted media id must not end the search.
    const derived = deriveSeoFromDocument(
      doc([
        node("1", "core/image", { mediaId: "deleted" }),
        node("2", "core/image", { mediaId: "live" }),
      ]),
      definitions(),
      visible
    );

    expect(derived.image).toEqual([
      { kind: "media", value: "deleted" },
      { kind: "media", value: "live" },
    ]);
  });

  it("reads slots in the order the definition declares them", () => {
    // The stored object lists `second` first; the definition declares
    // `first` first. Declared order wins, because stored order is a JSON
    // object's insertion order and need not match what the block draws — so
    // reading it could pick a different first heading than the page shows.
    const container = node(
      "1",
      "plugin/two",
      {},
      {
        second: [node("2", "core/heading", { text: "Second" })],
        first: [node("3", "core/heading", { text: "First" })],
      }
    );

    const derived = deriveSeoFromDocument(
      doc([container]),
      definitions({ "plugin/two": () => undefined }),
      visible
    );

    expect(derived.title).toBe("First");
  });

  it("keeps a UUID-shaped direct src as a URL", () => {
    // The failure no string test could avoid: a `src` that happens to be
    // UUID-shaped renders fine, and any shape-based guess sends it to a media
    // lookup that misses. Only the block knows which prop it came from.
    const derived = deriveSeoFromDocument(
      doc([node("1", "plugin/pic", {})]),
      definitions({
        "plugin/pic": () => ({
          image: { url: "550e8400-e29b-41d4-a716-446655440000" },
        }),
      }),
      visible
    );

    expect(derived.image).toEqual([
      { kind: "url", value: "550e8400-e29b-41d4-a716-446655440000" },
    ]);
  });

  it("keeps a media id a URL heuristic would misread", () => {
    // The mirror case, chosen so no text-based guess can pass it: this id
    // carries a slash and a dot, so every "looks like a URL" test calls it an
    // address. Only the block's own provenance says otherwise.
    const derived = deriveSeoFromDocument(
      doc([node("1", "plugin/pic", {})]),
      definitions({
        "plugin/pic": () => ({ image: { media: "library/asset.42" } }),
      }),
      visible
    );

    expect(derived.image).toEqual([
      { kind: "media", value: "library/asset.42" },
    ]);
  });

  it("returns nothing for an empty document", () => {
    expect(deriveSeoFromDocument(doc([]), definitions(), visible)).toEqual({});
  });
});
