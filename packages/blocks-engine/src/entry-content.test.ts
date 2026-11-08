/**
 * The Entry content block's own rules, judged by validation on every write,
 * and the composition of an entry's blocks into a template for drawing.
 *
 * Each refusal is paired with the document that passes beside it: one Entry
 * content block in a template is the control for a second, and a template is
 * the control for every other kind, so a rule refusing the block everywhere
 * (or nowhere) fails one half.
 */
import { describe, expect, it, vi } from "vitest";

import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
} from "./document";
import {
  composeEntryContent,
  ENTRY_CONTENT_SLOT,
  ENTRY_CONTENT_TYPE,
  entryContentPlacements,
  holdsEntryContent,
} from "./entry-content";
import { DEFAULT_LIMITS } from "./limits";
import { hostIdsIn, resolveComponentInstances } from "./resolve-instances";
import { walkNodes } from "./tree";
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

/**
 * What the resolver says of a page drawn under `limits`: whether it draws
 * whole (its survey reads every node within the cap, and no placement is
 * refused for want of room), what it refused, and the page it resolved to.
 * The resolver's own answer, so the cut is held to it and to no count kept
 * beside it.
 */
function resolvedUnder(
  page: BlockDocument,
  definitions: ReadonlyMap<string, BlockDocument>,
  limits: typeof DEFAULT_LIMITS
) {
  const resolved = resolveComponentInstances(page, definitions, {
    limits,
    conditioned: "carry",
  });
  const truncated = hostIdsIn(page.nodes, limits.maxNodes).truncated;
  return {
    whole:
      !truncated &&
      !resolved.unresolved.some(instance => instance.reason === "budget"),
    unresolved: resolved.unresolved,
    document: resolved.document,
  };
}

/** The blocks a composed template's Entry content block holds. */
function slotOf(page: BlockDocument, at: number): readonly BlockNode[] {
  return page.nodes[at]?.slots?.[ENTRY_CONTENT_SLOT] ?? [];
}

/**
 * The entry composed into `template` (its Entry content block at `at`)
 * under `limits` with `definitions`, held to the resolver: the page draws
 * whole, and one more of the entry's blocks would not, so the cut is the
 * longest the resolver accepts. Returns the composed page and what it
 * resolved to.
 */
function composedAsTheResolverAllows(
  template: BlockDocument,
  body: BlockDocument,
  at: number,
  definitions: ReadonlyMap<string, BlockDocument>,
  limits: typeof DEFAULT_LIMITS
) {
  const source = {
    valueOf: () => body,
    maxNodes: limits.maxNodes,
    maxDepth: limits.maxDepth,
  };
  const composed = composeEntryContent(template, { ...source, definitions });
  // Every block the stored cut alone keeps, so one past the cut can be put
  // to the resolver.
  const candidates = slotOf(composeEntryContent(template, source), at);
  const kept = slotOf(composed, at);
  const resolved = resolvedUnder(composed, definitions, limits);
  expect(resolved.whole).toBe(true);
  if (kept.length < candidates.length) {
    const oneMore: BlockDocument = {
      ...composed,
      nodes: composed.nodes.map((node, index) =>
        index === at
          ? {
              ...node,
              slots: {
                ...node.slots,
                [ENTRY_CONTENT_SLOT]: candidates.slice(0, kept.length + 1),
              },
            }
          : node
      ),
    };
    expect(resolvedUnder(oneMore, definitions, limits).whole).toBe(false);
  }
  return { composed, kept, candidates, resolved };
}

/** Every text a resolved page draws, in document order. */
function textsIn(page: BlockDocument): unknown[] {
  const found: unknown[] = [];
  walkNodes(page.nodes, node => {
    if (node.props.text !== undefined) found.push(node.props.text);
  });
  return found;
}

const card = documentOf(
  "component",
  text("c1", "Card title"),
  text("c2", "Card body")
);

/** A placement of `componentId`, with `slots` handed to it where given. */
function placed(
  id: string,
  componentId: string,
  slots?: Record<string, unknown[]>
): Record<string, unknown> {
  return {
    id,
    type: COMPONENT_INSTANCE_TYPE,
    version: 1,
    props: { componentId },
    ...(slots === undefined ? {} : { slots }),
  };
}

/** `count` text blocks, `prefix`ed. */
function texts(prefix: string, count: number): unknown[] {
  return Array.from({ length: count }, (_, at) =>
    text(`${prefix}${String(at)}`, `${prefix} ${String(at)}`)
  );
}

describe("an entry beside a template that places a component", () => {
  it("leaves the room the template's placement needs, as the resolver measures it", () => {
    const template = documentOf(
      "template",
      placed("p", "card"),
      entryContent("ec")
    );
    const { kept, candidates, resolved } = composedAsTheResolverAllows(
      template,
      documentOf("page", ...texts("e", 4)),
      1,
      new Map([["card", card]]),
      { ...DEFAULT_LIMITS, maxNodes: 5 }
    );
    expect(resolved.unresolved).toEqual([]);
    // Cut below what the stored nodes alone would allow, but not dropped.
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(candidates.length);
  });

  it("leaves the placement unresolved where no definitions are given (the control)", () => {
    const template = documentOf(
      "template",
      placed("p", "card"),
      entryContent("ec")
    );
    const composed = composeEntryContent(template, {
      valueOf: () => documentOf("page", ...texts("e", 4)),
      maxNodes: 5,
    });
    const resolved = resolvedUnder(composed, new Map([["card", card]]), {
      ...DEFAULT_LIMITS,
      maxNodes: 5,
    });
    expect(resolved.whole).toBe(false);
  });
});

describe("an entry that places a component of its own", () => {
  it("draws the placement at its full size, and the page whole", () => {
    const { kept, resolved } = composedAsTheResolverAllows(
      documentOf("template", entryContent("ec")),
      documentOf("page", placed("own", "card"), ...texts("e", 3)),
      0,
      new Map([["card", card]]),
      { ...DEFAULT_LIMITS, maxNodes: 4 }
    );
    expect(kept[0]?.type).toBe(COMPONENT_INSTANCE_TYPE);
    expect(resolved.unresolved).toEqual([]);
    expect(textsIn(resolved.document)).toEqual(
      expect.arrayContaining(["Card title", "Card body"])
    );
  });
});

describe("the page's own depth", () => {
  it("measures a template placement below the format's default depth under the raised limit", () => {
    // Thirteen boxes deep, past the format's own depth of 12, a placement.
    let deep: unknown = placed("deep", "card");
    for (let level = 12; level >= 0; level -= 1) {
      deep = box(`b${String(level)}`, [deep]);
    }
    const { kept, candidates, resolved } = composedAsTheResolverAllows(
      documentOf("template", deep, entryContent("ec")),
      documentOf("page", ...texts("e", 10)),
      1,
      new Map([["card", card]]),
      { ...DEFAULT_LIMITS, maxNodes: 20, maxDepth: 30 }
    );
    expect(resolved.unresolved).toEqual([]);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(candidates.length);
  });

  it("leaves to the resolver a definition deeper than the depth left below the block", () => {
    // A definition nine boxes deep, placed in the entry two levels down: the
    // resolver's own depth rules decide it, and nothing about it is cut for
    // room the page has.
    let inner: unknown = text("leaf", "Leaf");
    for (let level = 8; level >= 0; level -= 1) {
      inner = box(`d${String(level)}`, [inner]);
    }
    const deepCard = documentOf("component", inner);
    const { kept, candidates } = composedAsTheResolverAllows(
      documentOf("template", entryContent("ec")),
      documentOf("page", placed("own", "deep"), ...texts("e", 3)),
      0,
      new Map([["deep", deepCard]]),
      { ...DEFAULT_LIMITS, maxNodes: 100 }
    );
    // Room for all of it: whatever the resolver makes of the depth, the
    // entry is never cut for it.
    expect(kept).toHaveLength(candidates.length);
  });
});

describe("placements the resolver charges less than they store", () => {
  it("does not charge a one-node expansion for the slots it discards", () => {
    const single = documentOf("component", text("s1", "Single"));
    composedAsTheResolverAllows(
      documentOf("template", entryContent("ec")),
      documentOf(
        "page",
        // Handed blocks for a slot its component does not have.
        placed("own", "single", { nowhere: texts("x", 3) }),
        ...texts("e", 4)
      ),
      0,
      new Map([["single", single]]),
      { ...DEFAULT_LIMITS, maxNodes: 8 }
    );
  });

  it("keeps a page of zero-node placements to the cap", () => {
    const empty = documentOf("component");
    const { kept } = composedAsTheResolverAllows(
      documentOf("template", entryContent("ec")),
      documentOf(
        "page",
        ...Array.from({ length: 50 }, (_, at) =>
          placed(`z${String(at)}`, "empty")
        )
      ),
      0,
      new Map([["empty", empty]]),
      { ...DEFAULT_LIMITS, maxNodes: 10 }
    );
    // Never more than the page stores beside the block itself.
    expect(kept.length).toBeLessThanOrEqual(9);
  });
});

describe("an oversized entry measured against its components", () => {
  it("is never read past the cap, however often the resolver is asked", () => {
    const reads = { past: 0 };
    const nodes: unknown[] = [];
    for (let at = 0; at < 200; at += 1) {
      const node =
        at === 0 ? placed("own", "card") : text(`e${String(at)}`, "x");
      if (at < 9) {
        nodes.push(node);
        continue;
      }
      Object.defineProperty(nodes, at, {
        enumerable: true,
        get: () => {
          reads.past += 1;
          return node;
        },
      });
    }
    const body = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes,
    } as BlockDocument;
    composeEntryContent(documentOf("template", entryContent("ec")), {
      valueOf: () => body,
      maxNodes: 10,
      definitions: new Map([["card", card]]),
    });
    expect(reads.past).toBe(0);
  });
});

describe("how often the resolver measures the page", () => {
  /**
   * The card's definition behind a lookup that counts each time it is read:
   * once per resolution, since a resolution reads a definition once however
   * often the page places it, and the template places it in every probe.
   */
  function counted() {
    const reads = { card: 0 };
    const lookup = {
      has: (id: string) => id === "card",
      get: (id: string) => {
        if (id !== "card") return undefined;
        reads.card += 1;
        return card;
      },
    };
    return { lookup, reads };
  }

  const template = documentOf(
    "template",
    placed("p", "card"),
    entryContent("ec")
  );

  it("resolves the page once where it draws whole", () => {
    const { lookup, reads } = counted();
    const valueOf = vi.fn(() => documentOf("page", ...texts("e", 6)));
    composeEntryContent(template, {
      valueOf,
      maxNodes: 100,
      definitions: lookup,
    });
    expect(reads.card).toBe(1);
    // The entry is read once, before anything is measured.
    expect(valueOf).toHaveBeenCalledTimes(1);
  });

  it("searches only past the cap, in at most 1 + ceil(log2(N + 1)) resolutions", () => {
    const { lookup, reads } = counted();
    const blocks = 16;
    const valueOf = vi.fn(() => documentOf("page", ...texts("e", blocks)));
    const composed = composeEntryContent(template, {
      valueOf,
      // The stored page fits (2 + 16 = 18); expanding the card does not.
      maxNodes: 18,
      definitions: lookup,
    });
    // Over budget: the whole page, then a halving search.
    expect(reads.card).toBeGreaterThan(1);
    expect(reads.card).toBeLessThanOrEqual(
      1 + Math.ceil(Math.log2(blocks + 1))
    );
    expect(valueOf).toHaveBeenCalledTimes(1);
    expect(slotOf(composed, 1).length).toBeLessThan(blocks);
  });
});
