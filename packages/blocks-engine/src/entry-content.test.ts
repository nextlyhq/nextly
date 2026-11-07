/**
 * The Entry content block's own rules, judged by validation on every write,
 * and the composition of an entry's blocks into a template for drawing.
 *
 * Each refusal is paired with the document that passes beside it: one Entry
 * content block in a template is the control for a second, and a template is
 * the control for every other kind, so a rule refusing the block everywhere
 * (or nowhere) fails one half.
 */
import { describe, expect, it } from "vitest";

import { DOCUMENT_FORMAT_VERSION, type BlockDocument } from "./document";
import {
  composeEntryContent,
  ENTRY_CONTENT_SLOT,
  ENTRY_CONTENT_TYPE,
  entryContentPlacements,
  holdsEntryContent,
} from "./entry-content";
import { validate, type ValidationContext } from "./validation";
import { FIXTURE_BREAKPOINTS } from "./validation.fixtures";

const ctx: ValidationContext = {
  breakpoints: FIXTURE_BREAKPOINTS,
  mode: "forgiving",
};

function entryContent(id: string, field: unknown = "body") {
  return { id, type: ENTRY_CONTENT_TYPE, version: 1, props: { field } };
}

function box(id: string, children: unknown[]) {
  return { id, type: "core/box", version: 1, props: {}, slots: { children } };
}

function text(id: string, words: string) {
  return { id, type: "core/text", version: 1, props: { text: words } };
}

function documentOf(kind: string, ...nodes: unknown[]): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind,
    nodes,
  } as BlockDocument;
}

/** What a text block says, or nothing for any other block. */
function wordsOf(node: { readonly props?: Record<string, unknown> }): unknown {
  return node.props?.text;
}

/** The Entry content codes validation reports, with where each is. */
function entryContentFindings(document: BlockDocument) {
  return validate(document, ctx)
    .filter(issue => issue.code.startsWith("entry-content-"))
    .map(issue => ({ code: issue.code, path: issue.path }));
}

describe("an Entry content block, judged by validation", () => {
  it("passes once in a template, nested or at the top (the control)", () => {
    expect(
      entryContentFindings(documentOf("template", entryContent("ec")))
    ).toEqual([]);
    expect(
      entryContentFindings(
        documentOf("template", box("b", [entryContent("ec")]))
      )
    ).toEqual([]);
  });

  it("refuses a second one in a template, naming the second", () => {
    expect(
      entryContentFindings(
        documentOf(
          "template",
          entryContent("first"),
          box("b", [entryContent("second")])
        )
      )
    ).toEqual([
      {
        code: "entry-content-duplicate",
        path: "/nodes/1/slots/children/0",
      },
    ]);
  });

  it.each(["page", "component", "pattern", "region"])(
    "refuses one in a document of kind %s",
    kind => {
      expect(
        entryContentFindings(documentOf(kind, entryContent("ec")))
      ).toEqual([{ code: "entry-content-outside-template", path: "/nodes/0" }]);
    }
  );

  it("refuses a field that is not text, and takes a field named as text (the control)", () => {
    expect(
      entryContentFindings(documentOf("template", entryContent("ec", 42)))
    ).toEqual([
      { code: "entry-content-field-invalid", path: "/nodes/0/props/field" },
    ]);
    // Unset is the save's to judge against the collection, not a shape fault.
    expect(
      entryContentFindings(
        documentOf("template", {
          id: "ec",
          type: ENTRY_CONTENT_TYPE,
          version: 1,
          props: {},
        })
      )
    ).toEqual([]);
  });
});

describe("finding Entry content blocks", () => {
  it("finds them at any depth, in document order, and stops at the node cap", () => {
    const nodes = [
      entryContent("a"),
      box("b", [text("t", "x"), entryContent("c")]),
    ];
    expect(entryContentPlacements(nodes).map(({ node }) => node.id)).toEqual([
      "a",
      "c",
    ]);
    // One entry read: the first block only.
    expect(entryContentPlacements(nodes, 1).map(({ node }) => node.id)).toEqual(
      ["a"]
    );
    expect(holdsEntryContent(box("b", [entryContent("c")]))).toBe(true);
    expect(holdsEntryContent(box("b", [text("t", "x")]))).toBe(false);
  });
});

describe("composing an entry's content into its template", () => {
  const body = documentOf(
    "page",
    text("p1", "First paragraph"),
    box("inner", [text("p2", "Second paragraph")])
  );

  it("draws the entry's blocks for the field the block names, with ids of their own", () => {
    const template = documentOf(
      "template",
      text("title", "Title"),
      entryContent("ec", "body")
    );
    const composed = composeEntryContent(template, {
      valueOf: field => (field === "body" ? body : undefined),
    });
    const drawn = composed.nodes[1]?.slots?.[ENTRY_CONTENT_SLOT] ?? [];
    // The entry's blocks, in order, each with an id of its own.
    expect(drawn.map(wordsOf)).toEqual(["First paragraph", undefined]);
    expect(drawn[1]?.slots?.children?.map(wordsOf)).toEqual([
      "Second paragraph",
    ]);
    const ids = [
      ...drawn.map(node => node.id),
      drawn[1]?.slots?.children?.[0]?.id,
    ];
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(["p1", "inner", "p2"]).not.toContain(id);
    // What the template stores is untouched: nothing of the entry is in it.
    expect(template.nodes[1]).toEqual(entryContent("ec", "body"));
  });

  it("reads the field the block names, and no other", () => {
    const template = documentOf("template", entryContent("ec", "sidebar"));
    const asked: string[] = [];
    const composed = composeEntryContent(template, {
      valueOf: field => {
        asked.push(field);
        return field === "body" ? body : undefined;
      },
    });
    expect(asked).toEqual(["sidebar"]);
    // Nothing composed: the same document, by identity.
    expect(composed).toBe(template);
  });

  it("draws nothing for an empty field, one that is absent, or one holding no document", () => {
    const template = documentOf("template", entryContent("ec"));
    for (const value of [
      documentOf("page"),
      undefined,
      null,
      "not a document",
      { formatVersion: 99, nodes: [text("p", "x")] },
    ]) {
      expect(composeEntryContent(template, { valueOf: () => value })).toBe(
        template
      );
    }
  });

  it("reads a document stored as JSON text", () => {
    const template = documentOf("template", entryContent("ec"));
    const composed = composeEntryContent(template, {
      valueOf: () => JSON.stringify(body),
    });
    expect(
      composed.nodes[0]?.slots?.[ENTRY_CONTENT_SLOT]?.map(wordsOf)
    ).toEqual(["First paragraph", undefined]);
  });

  it("never draws an Entry content block the entry's content holds, at any depth", () => {
    const holding = documentOf(
      "template",
      text("p1", "Kept"),
      entryContent("nested-top"),
      box("inner", [entryContent("nested-deep"), text("p2", "Kept too")])
    );
    const composed = composeEntryContent(
      documentOf("template", entryContent("ec")),
      { valueOf: () => holding }
    );
    const drawn = composed.nodes[0]?.slots?.[ENTRY_CONTENT_SLOT] ?? [];
    // The control: the entry's other blocks are drawn.
    expect(drawn.map(wordsOf)).toEqual(["Kept", undefined]);
    expect(entryContentPlacements(drawn)).toEqual([]);
    expect(drawn[1]?.slots?.children?.map(wordsOf)).toEqual(["Kept too"]);
  });

  it("composes only a template, and only its first Entry content block", () => {
    const page = documentOf("page", entryContent("ec"));
    expect(composeEntryContent(page, { valueOf: () => body })).toBe(page);
    const two = documentOf("template", entryContent("a"), entryContent("b"));
    const composed = composeEntryContent(two, { valueOf: () => body });
    expect(composed.nodes[0]?.slots?.[ENTRY_CONTENT_SLOT]).toHaveLength(2);
    expect(composed.nodes[1]?.slots?.[ENTRY_CONTENT_SLOT]).toBeUndefined();
  });
});

describe("the entry's own DOM ids, once drawn inside its template", () => {
  it("gives an id the template also uses one of its own, and keeps the entry's anchor on its own element", () => {
    const template = documentOf(
      "template",
      { ...text("t-hero", "Template hero"), cssId: "hero" },
      entryContent("ec")
    );
    const body = documentOf(
      "page",
      { ...text("e-hero", "Entry hero"), cssId: "hero" },
      {
        id: "e-link",
        type: "core/button",
        version: 1,
        props: { label: "Back to top", href: "#hero" },
        attributes: { "aria-describedby": "hero" },
      }
    );
    const composed = composeEntryContent(template, { valueOf: () => body });
    const drawn = composed.nodes[1]?.slots?.[ENTRY_CONTENT_SLOT] ?? [];
    const entryHero = drawn[0]?.cssId;
    // The template's own id is untouched; the entry's is its own.
    expect(composed.nodes[0]?.cssId).toBe("hero");
    expect(entryHero).toBeDefined();
    expect(entryHero).not.toBe("hero");
    // The entry's anchor and its aria reference follow its element.
    expect(drawn[1]?.props.href).toBe(`#${entryHero ?? ""}`);
    expect(drawn[1]?.attributes?.["aria-describedby"]).toBe(entryHero);
    // The same on every render: drawn ids are derived, never random.
    const again = composeEntryContent(template, { valueOf: () => body });
    expect(again.nodes[1]?.slots?.[ENTRY_CONTENT_SLOT]?.[0]?.cssId).toBe(
      entryHero
    );
  });

  it("replaces an id set through the attribute bag, and leaves a link to another page alone (the control)", () => {
    const body = documentOf(
      "page",
      {
        ...text("e-intro", "Intro"),
        attributes: { id: "intro", "data-x": "kept" },
      },
      {
        id: "e-out",
        type: "core/button",
        version: 1,
        props: { label: "Elsewhere", href: "/pricing#intro" },
      }
    );
    const composed = composeEntryContent(
      documentOf("template", entryContent("ec")),
      { valueOf: () => body }
    );
    const drawn = composed.nodes[0]?.slots?.[ENTRY_CONTENT_SLOT] ?? [];
    expect(drawn[0]?.attributes?.id).not.toBe("intro");
    expect(drawn[0]?.attributes?.["data-x"]).toBe("kept");
    // A fragment on another page's address names that page's id, not this one's.
    expect(drawn[1]?.props.href).toBe("/pricing#intro");
  });
});

describe("the ids the entry's blocks are drawn with", () => {
  it("never takes an id the template already holds, so both nodes are kept", () => {
    // A template already holding the id a plain concatenation would mint
    // for the entry's `p` (`ec:p`), and the id `p` itself.
    const template = documentOf(
      "template",
      text("ec:p", "The template's own"),
      text("p", "The template's p"),
      entryContent("ec")
    );
    const composed = composeEntryContent(template, {
      valueOf: () => documentOf("page", text("p", "The entry's p")),
    });
    const [drawn] = composed.nodes[2]?.slots?.[ENTRY_CONTENT_SLOT] ?? [];
    expect(drawn?.props.text).toBe("The entry's p");
    // The template's two blocks keep their ids, and the drawn one has its own.
    expect(composed.nodes.map(node => node.id)).toEqual(["ec:p", "p", "ec"]);
    expect(["ec:p", "p", "ec"]).not.toContain(drawn?.id);
  });

  it("mints the same ids on every render", () => {
    const template = documentOf("template", entryContent("ec"));
    const body = documentOf("page", text("p", "x"), text("q", "y"));
    const once = composeEntryContent(template, { valueOf: () => body });
    const twice = composeEntryContent(template, { valueOf: () => body });
    expect(
      once.nodes[0]?.slots?.[ENTRY_CONTENT_SLOT]?.map(node => node.id)
    ).toEqual(
      twice.nodes[0]?.slots?.[ENTRY_CONTENT_SLOT]?.map(node => node.id)
    );
  });
});

describe("a minted DOM id the template already publishes", () => {
  it("is claimed past, so the drawn id is the page's only one", () => {
    const body = documentOf("page", {
      ...text("e-hero", "Entry hero"),
      cssId: "hero",
    });
    // The control: what the entry's `hero` is drawn as beside a template
    // holding nothing of the kind.
    const plain = composeEntryContent(
      documentOf("template", text("t", "Template"), entryContent("ec")),
      { valueOf: () => body }
    );
    const minted = plain.nodes[1]?.slots?.[ENTRY_CONTENT_SLOT]?.[0]?.cssId;
    expect(typeof minted).toBe("string");
    // The same template, its own block already publishing that very id.
    const clashing = composeEntryContent(
      documentOf(
        "template",
        { ...text("t", "Template"), cssId: minted },
        entryContent("ec")
      ),
      { valueOf: () => body }
    );
    const drawn = clashing.nodes[1]?.slots?.[ENTRY_CONTENT_SLOT]?.[0]?.cssId;
    expect(clashing.nodes[0]?.cssId).toBe(minted);
    expect(drawn).toBe(`${String(minted)}-2`);
  });
});

describe("an entry larger than the page may draw", () => {
  /**
   * An entry forest of `size` text blocks whose entries past `readable`
   * count each read of them, as an oversized stored Body would cost.
   */
  function counted(size: number, readable: number) {
    const reads = { past: 0 };
    const nodes: unknown[] = [];
    for (let at = 0; at < size; at += 1) {
      if (at < readable) {
        nodes.push(text(`e${String(at)}`, `Block ${String(at)}`));
        continue;
      }
      const node = text(`e${String(at)}`, `Block ${String(at)}`);
      Object.defineProperty(nodes, at, {
        enumerable: true,
        get: () => {
          reads.past += 1;
          return node;
        },
      });
    }
    // Not spread: spreading would read every entry here.
    const body = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes,
    } as BlockDocument;
    return { body, reads };
  }

  it("is cut to what the page may still draw, and never read past it", () => {
    // A cap of 10 with the template's two nodes: eight of the entry's draw.
    const { body, reads } = counted(200, 8);
    const composed = composeEntryContent(
      documentOf("template", text("t", "Template"), entryContent("ec")),
      { valueOf: () => body, maxNodes: 10 }
    );
    const drawn = composed.nodes[1]?.slots?.[ENTRY_CONTENT_SLOT] ?? [];
    expect(drawn.map(wordsOf)).toEqual(
      Array.from({ length: 8 }, (_, at) => `Block ${String(at)}`)
    );
    expect(reads.past).toBe(0);
  });

  it("draws every block of an entry within the cap (the control)", () => {
    const { body, reads } = counted(5, 5);
    const composed = composeEntryContent(
      documentOf("template", entryContent("ec")),
      { valueOf: () => body, maxNodes: 10 }
    );
    expect(composed.nodes[0]?.slots?.[ENTRY_CONTENT_SLOT]).toHaveLength(5);
    expect(reads.past).toBe(0);
  });
});

describe("an entry nested deeper than the page may draw", () => {
  /** A chain of `levels` boxes, the innermost holding a text block. */
  function chain(levels: number): BlockDocument {
    let inner: unknown = text("deepest", "At the bottom");
    for (let level = levels - 1; level >= 0; level -= 1) {
      inner = box(`b${String(level)}`, [inner]);
    }
    return documentOf("page", inner);
  }

  /** How many levels of the entry's blocks are drawn below the block. */
  function drawnLevels(composed: BlockDocument): number {
    let levels = 0;
    let at = composed.nodes[0]?.slots?.[ENTRY_CONTENT_SLOT];
    while (Array.isArray(at) && at.length > 0) {
      levels += 1;
      at = at[0]?.slots?.children;
    }
    return levels;
  }

  const template = documentOf("template", entryContent("ec"));
  const body = chain(20);

  it("draws to the depth the caller raised the limit to", () => {
    // 20 boxes and the text below them: 21 levels under the top-level block,
    // the deepest at depth 22.
    const composed = composeEntryContent(template, {
      valueOf: () => body,
      maxDepth: 22,
    });
    expect(drawnLevels(composed)).toBe(21);
  });

  it("is cut at the format's own depth where none is given (the control)", () => {
    // The block at depth 1, so its blocks reach depth 12: eleven levels.
    const composed = composeEntryContent(template, { valueOf: () => body });
    expect(drawnLevels(composed)).toBe(11);
  });
});
