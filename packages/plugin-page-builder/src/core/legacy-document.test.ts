import { describe, expect, it } from "vitest";

import {
  isLegacyDocument,
  toEngineDocument,
  type ConversionNote,
} from "./legacy-document";
import type { BlockDocument as LegacyDocument, BlockNode } from "./types";

/** A legacy node with only what a caller cares about spelled out. */
function node(id: string, over: Partial<BlockNode> = {}): BlockNode {
  return { id, type: "core/heading", props: {}, ...over };
}

/** The editor's synthetic wrapper: an empty container holding `children`. */
function wrapper(children: BlockNode[]): BlockNode {
  return {
    id: "root",
    type: "core/container",
    props: {},
    slots: { default: children },
  };
}

function doc(
  root: BlockNode,
  over: Partial<LegacyDocument> = {}
): LegacyDocument {
  return { version: 1, root, ...over };
}

function noteFor(notes: ConversionNote[], field: string): ConversionNote {
  const found = notes.find(n => n.field === field);
  if (!found) throw new Error(`expected a note for "${field}"`);
  return found;
}

describe("toEngineDocument", () => {
  it("promotes the synthetic wrapper's children to the top level", () => {
    const { document } = toEngineDocument(doc(wrapper([node("a"), node("b")])));

    // The point of the conversion: the wrapper is gone and the page IS the list.
    expect(document.nodes.map(n => n.id)).toEqual(["a", "b"]);
    expect(document.formatVersion).toBe(1);
    expect(document.kind).toBe("page");
  });

  it("carries CONTENT across, not just structure", () => {
    // A shape-preserving no-op passes a structural check. Asserting on a value
    // an author actually typed is what separates a real conversion from one
    // that rebuilt the tree and lost what was in it.
    const { document } = toEngineDocument(
      doc(wrapper([node("a", { props: { text: "Hello world" } })]))
    );

    expect(document.nodes[0].props).toEqual({ text: "Hello world" });
  });

  it("preserves nesting three deep with siblings at every level", () => {
    // A fixture one level deep passes whichever encoding is used, because a
    // flat list and a tree agree about a tree of depth one.
    const deep = wrapper([
      node("l1a", {
        type: "core/container",
        slots: {
          default: [
            node("l2a", {
              type: "core/container",
              slots: { default: [node("l3a"), node("l3b")] },
            }),
            node("l2b"),
          ],
        },
      }),
      node("l1b"),
    ]);

    const { document } = toEngineDocument(doc(deep));

    expect(document.nodes.map(n => n.id)).toEqual(["l1a", "l1b"]);
    const l1a = document.nodes[0];
    expect(l1a.slots?.default.map(n => n.id)).toEqual(["l2a", "l2b"]);
    expect(l1a.slots?.default[0].slots?.default.map(n => n.id)).toEqual([
      "l3a",
      "l3b",
    ]);
  });

  it("preserves slot IDENTITY, not merely child order", () => {
    // `core/columns` restricts which blocks its slot accepts. A conversion that
    // kept the children but renamed or merged the slot would leave that
    // restriction pointing at a slot that no longer exists, and it would stop
    // refusing anything without failing.
    const { document } = toEngineDocument(
      doc(
        wrapper([
          node("cols", {
            type: "core/columns",
            slots: { left: [node("x")], right: [node("y")] },
          }),
        ])
      )
    );

    const cols = document.nodes[0];
    expect(Object.keys(cols.slots ?? {}).sort()).toEqual(["left", "right"]);
    expect(cols.slots?.left.map(n => n.id)).toEqual(["x"]);
    expect(cols.slots?.right.map(n => n.id)).toEqual(["y"]);
  });

  it("keeps an EMPTY slot distinguishable from an ABSENT one", () => {
    // Both encode as "no children" unless the key itself survives. An empty
    // slot is a region an author can drop into; an absent one is a region the
    // block does not have.
    const { document } = toEngineDocument(
      doc(
        wrapper([
          node("empty", { type: "core/container", slots: { default: [] } }),
          node("absent"),
        ])
      )
    );

    expect(document.nodes[0].slots).toEqual({ default: [] });
    expect(document.nodes[1].slots).toBeUndefined();
  });

  describe("values the engine requires but the legacy shape did not carry", () => {
    it("assumes version 1 for a node that stored none, and SAYS SO", () => {
      const { document, notes } = toEngineDocument(doc(wrapper([node("a")])));

      expect(document.nodes[0].version).toBe(1);
      // A synthesised value is a decision. Asserting only the value would pass
      // on an implementation that invented it silently.
      expect(noteFor(notes, "version").path).toBe("a");
    });

    it("keeps a stored schema version rather than overwriting it", () => {
      const { document, notes } = toEngineDocument(
        doc(wrapper([node("a", { definitionVersion: 7 })]))
      );

      expect(document.nodes[0].version).toBe(7);
      expect(notes.some(n => n.field === "version")).toBe(false);
    });

    it("renames the legacy `part` kind and records the rename", () => {
      const { document, notes } = toEngineDocument(
        doc(wrapper([]), { kind: "part" })
      );

      expect(document.kind).toBe("region");
      expect(noteFor(notes, "kind").detail).toContain("part");
    });
  });

  describe("losses are reported, never silent", () => {
    it("reports entrance motion, which the engine cannot store", () => {
      const { notes } = toEngineDocument(
        doc(wrapper([node("a", { motion: { type: "fade" } })]))
      );

      expect(noteFor(notes, "motion").path).toBe("a");
    });

    it("reports a raw custom class", () => {
      const { notes } = toEngineDocument(
        doc(wrapper([node("a", { customClass: "my-thing" })]))
      );

      expect(noteFor(notes, "customClass").detail).toContain("my-thing");
    });

    it("reports stored SEO, which the engine derives instead", () => {
      const { notes } = toEngineDocument(
        doc(wrapper([]), { settings: { seo: { title: "T" } } })
      );

      expect(noteFor(notes, "settings.seo").path).toBe("document");
    });

    it("reports blocks stranded in a non-default slot on the wrapper", () => {
      const stranded = wrapper([node("kept")]);
      stranded.slots = { ...stranded.slots, aside: [node("lost")] };

      const { document, notes } = toEngineDocument(doc(stranded));

      expect(document.nodes.map(n => n.id)).toEqual(["kept"]);
      expect(noteFor(notes, "slots.aside").detail).toContain("1 block");
    });

    it("emits NO notes for a document that converts cleanly", () => {
      // Without this, a permanently-noisy converter would satisfy every
      // assertion above while telling an operator nothing.
      const { notes } = toEngineDocument(
        doc(wrapper([node("a", { definitionVersion: 1 })]))
      );

      expect(notes).toEqual([]);
    });
  });

  describe("bindings", () => {
    it("binds to the loop ITEM, not the entry owning the document", () => {
      // The distinction decides whether a repeated block shows its own row.
      // Legacy bindings resolve only inside a collection loop, so "field"
      // always meant the current item; `entry` is the page, so converting to
      // it would leave every repetition showing the same values. Nothing
      // structural separates the two — both are a well-formed binding — so
      // this assertion has to name the source explicitly.
      const { document } = toEngineDocument(
        doc(
          wrapper([
            node("a", {
              bindings: { text: { source: "field", path: "author.name" } },
            }),
          ])
        )
      );

      expect(document.nodes[0].bindings?.text.source).toBe("item");
    });

    it("rewrites `path` onto `$bind`", () => {
      const { document } = toEngineDocument(
        doc(
          wrapper([
            node("a", {
              bindings: { text: { source: "field", path: "author.name" } },
            }),
          ])
        )
      );

      expect(document.nodes[0].bindings).toEqual({
        text: { source: "item", $bind: "author.name" },
      });
    });

    it("reports a display transform, which has no engine equivalent", () => {
      const { notes } = toEngineDocument(
        doc(
          wrapper([
            node("a", {
              bindings: {
                date: {
                  source: "field",
                  path: "publishedAt",
                  transform: "date:MMM d, yyyy",
                },
              },
            }),
          ])
        )
      );

      expect(noteFor(notes, "bindings.date.transform").detail).toContain(
        "date:MMM d, yyyy"
      );
    });
  });

  describe("the root the author built", () => {
    it("is still unwrapped when its attribute map is EMPTY", () => {
      // Clearing the last attribute in the legacy editor stores `{}` rather
      // than removing the field, so an untouched wrapper can legitimately
      // carry one. Treating that as authorship preserves a `core/container`
      // with no behaviour to preserve.
      const wrapped = wrapper([node("a")]);
      wrapped.attributes = {};

      const { document } = toEngineDocument(doc(wrapped));

      expect(document.nodes.map(n => n.id)).toEqual(["a"]);
    });

    it("is kept as a real block rather than unwrapped", () => {
      // Unwrapping a container the author added would change how the page
      // renders — its padding and background would simply stop applying.
      const authored = wrapper([node("a")]);
      authored.props = { maxWidth: "narrow" };

      const { document, notes } = toEngineDocument(doc(authored));

      expect(document.nodes.map(n => n.id)).toEqual(["root"]);
      expect(document.nodes[0].slots?.default.map(n => n.id)).toEqual(["a"]);
      expect(noteFor(notes, "root").path).toBe("root");
    });

    it("moves a synthetic wrapper's styling to page-level styles", () => {
      const styled = wrapper([node("a")]);
      styled.style = { base: { backgroundColor: "#fff" } };
      styled.customCss = ".x { color: red }";

      const { document } = toEngineDocument(doc(styled));

      // The wrapper disappears; its styling must not disappear with it.
      expect(document.nodes.map(n => n.id)).toEqual(["a"]);
      expect(document.settings?.styles?.base).toEqual({
        base: { backgroundColor: "#fff" },
      });
      expect(document.settings?.customCss).toBe(".x { color: red }");
    });
  });

  describe("styles", () => {
    it("folds the legacy style/styleHover pair into states", () => {
      const { document } = toEngineDocument(
        doc(
          wrapper([
            node("a", {
              style: { base: { color: "#111" } },
              styleHover: { base: { color: "#222" } },
            }),
          ])
        )
      );

      expect(document.nodes[0].styles).toEqual({
        base: { base: { color: "#111" } },
        hover: { base: { color: "#222" } },
      });
    });

    it("rewrites a legacy token reference onto the engine's spelling", () => {
      // The two spellings differ only in the key: legacy `{ token }` against
      // the engine's `{ $token }`. Left alone, a token survives the generic
      // object walk as an ordinary nested object — present, well-formed, and
      // no longer a token. So asserting the value merely EXISTS passes on the
      // broken conversion; the key is the whole property under test.
      const { document } = toEngineDocument(
        doc(
          wrapper([
            node("a", {
              style: { base: { color: { token: "color.primary" } } },
            }),
          ])
        )
      );

      expect(document.nodes[0].styles?.base?.base).toEqual({
        color: { $token: "color.primary" },
      });
    });

    it("refuses a value the engine's envelope cannot hold", () => {
      // Written by an older version whose type no longer describes it. Letting
      // it through would store a value that fails validation on the next read.
      const bad = node("a");
      Object.assign(bad, { style: { base: { boxShadow: [1, 2] } } });

      const { document } = toEngineDocument(doc(wrapper([bad])));

      expect(document.nodes[0].styles).toBeUndefined();
    });

    it("carries per-breakpoint visibility under `devices`", () => {
      const { document } = toEngineDocument(
        doc(wrapper([node("a", { visibility: { mobile: false } })]))
      );

      expect(document.nodes[0].visibility).toEqual({
        devices: { mobile: false },
      });
    });
  });
});

describe("isLegacyDocument", () => {
  it("separates the two envelopes on key presence alone", () => {
    expect(
      isLegacyDocument({
        version: 1,
        root: { id: "r", type: "core/container", props: {} },
      })
    ).toBe(true);
    expect(
      isLegacyDocument({ formatVersion: 1, kind: "page", nodes: [] })
    ).toBe(false);
  });

  it("refuses values that are not documents at all", () => {
    for (const value of [null, undefined, 7, "root", [], { root: "no" }]) {
      expect(isLegacyDocument(value)).toBe(false);
    }
  });

  it("refuses a root that cannot survive the conversion", () => {
    // The guard has to promise what the narrowed type promises. A shallower
    // one accepts these, narrows with TypeScript's blessing, and then throws
    // partway through the walk — turning a repairable row into a failed
    // migration instead of a controlled rejection.
    for (const root of [
      {},
      { id: "r" },
      { id: "r", type: "core/container" },
      { id: "r", type: "core/container", props: "no" },
      { id: 7, type: "core/container", props: {} },
    ]) {
      expect(isLegacyDocument({ version: 1, root })).toBe(false);
    }
  });

  it("still accepts a well-formed legacy document", () => {
    // Without this, tightening the guard to reject everything would satisfy
    // the assertion above.
    expect(
      isLegacyDocument({
        version: 1,
        root: { id: "r", type: "core/container", props: {} },
      })
    ).toBe(true);
  });
});
