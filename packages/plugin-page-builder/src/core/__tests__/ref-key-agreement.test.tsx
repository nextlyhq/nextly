/**
 * The compiler and the renderer must name a node the same way.
 *
 * Both derive a class from a KEY — a bare node id for the document's own nodes, a ref-scoped key
 * for anything reached through `core/ref`. Sharing the hash is not proof they agree: the hash is
 * one step, and the step before it composes the key. A site that composes it unscoped keeps the
 * old bug while every other site is fixed, and the symptom is not a crash — the node silently
 * wears another node's class and inherits its styles.
 *
 * So this asserts the property directly, over a corpus of ref shapes: **the set of classes the
 * stylesheet writes is the set of classes the markup carries.** A class in the markup that the
 * sheet never wrote is an unstyled node; a class in the sheet that no element carries is dead CSS.
 * Neither is visible from one side alone, and neither shows up in a test that only checks one
 * nesting depth.
 *
 * The two rows that matter most are a library block placed TWICE — which must resolve to one set
 * of names, because that is what makes editing a reusable block update every placement — and a
 * ref nested inside a ref, because a key composed from the path rather than from the owning block
 * would name the same node differently depending on how it was reached.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { defaultBlockRegistry } from "../registry";
import { RenderNode } from "../../render/RenderNode";
import "../../render/blocks";
import {
  compileDocumentBlockCss,
  compileDocumentCss,
  documentKey,
  documentNodeClasses,
  nodeClass,
  refScopedKey,
} from "../style-compiler";
import { sanitizeBlockCss } from "../css-sanitize";
import { makeNode } from "../tree";

import type { BlockNode } from "../types";

/** Every `nx-pb-*` class the markup actually carries, with the stylesheet sliced off. */
function classesInMarkup(html: string): Set<string> {
  const markup = html.replace(/<style[\s\S]*?<\/style>/g, "");
  return new Set(
    [...markup.matchAll(/class="([^"]*)"/g)]
      .flatMap(match => (match[1] ?? "").split(/\s+/))
      .filter(name => name.startsWith("nx-pb-") && name !== "nx-pb-page")
  );
}

/** Every `nx-pb-*` class the stylesheet writes a rule for. */
function classesInSheet(css: string): Set<string> {
  return new Set(
    [...css.matchAll(/\.(nx-pb-[a-z0-9-]+)/g)]
      .map(match => match[1] as string)
      .filter(name => name !== "nx-pb-page")
  );
}

const styled = (id: string, text: string, colour: string): BlockNode => ({
  ...makeNode("core/heading", { text, level: "h2" }),
  id,
  style: { base: { color: colour } },
});

const ref = (id: string, refId: string): BlockNode => ({
  ...makeNode("core/ref", { refId }),
  id,
});

const container = (id: string, children: BlockNode[]): BlockNode => ({
  ...makeNode("core/container", {}, undefined, { default: children }),
  id,
});

/**
 * Each row declares the keys its STYLED nodes should be named by, written out rather than derived.
 *
 * Derived expectations restate the implementation and agree with it by construction — including
 * when both are wrong. Written out, the row is a claim about what the design SHOULD produce, and a
 * change in key composition has to be defended here rather than silently absorbed.
 *
 * Only styled nodes: an unstyled container legitimately gets no rule, so requiring one for every
 * class in the markup would fail on correct output.
 */
const CORPUS: [
  string,
  BlockNode,
  Record<string, BlockNode>,
  { placed: readonly string[]; onPage: number },
][] = [
  [
    "one placement of one reusable block",
    container("root", [styled("doc", "Doc", "#aa0001"), ref("p1", "r1")]),
    { r1: styled("lib", "Lib", "#aa0002") },
    { placed: ["doc", "2:r1lib"], onPage: 2 },
  ],
  [
    "the SAME block placed twice",
    container("root", [ref("p1", "r1"), ref("p2", "r1")]),
    { r1: styled("lib", "Lib", "#aa0003") },
    // ONE key for two placements: that is what makes editing the block update both.
    { placed: ["2:r1lib"], onPage: 1 },
  ],
  [
    "a library node sharing an id with a document node",
    container("root", [styled("same", "Doc", "#aa0004"), ref("p1", "r1")]),
    { r1: styled("same", "Lib", "#aa0005") },
    // Two DIFFERENT keys for one id. This is the collision the scoping exists to close.
    { placed: ["same", "2:r1same"], onPage: 2 },
  ],
  [
    "a reusable block containing a subtree",
    container("root", [ref("p1", "r1")]),
    { r1: container("libroot", [styled("libchild", "Child", "#aa0006")]) },
    { placed: ["2:r1libchild"], onPage: 1 },
  ],
  [
    "a ref NESTED inside a reusable block",
    container("root", [ref("p1", "r1")]),
    {
      r1: container("outer", [styled("a", "A", "#aa0007"), ref("inner", "r2")]),
      r2: styled("b", "B", "#aa0008"),
    },
    // The nested block is named by the block it LIVES in, not by the path taken to reach it.
    { placed: ["2:r1a", "2:r2b"], onPage: 2 },
  ],
  [
    "a library block the document never places",
    container("root", [styled("doc", "Doc", "#aa0009")]),
    { unused: styled("never", "Never", "#aa0010") },
    // Compiled but not on the page: its rule may exist, and no element carries it.
    { placed: ["doc"], onPage: 1 },
  ],
];

describe("what the sheet writes and what the markup carries", () => {
  it.each(CORPUS)("%s", (_label, root, refs, expected) => {
    const document = { root } as never;
    const classes = documentNodeClasses(document, refs);
    const css = [
      compileDocumentCss(document, { classes, refs }),
      compileDocumentBlockCss(document, classes, refs),
    ].join("\n");
    const html = renderToStaticMarkup(
      <RenderNode
        node={root}
        registry={defaultBlockRegistry}
        refs={refs}
        classes={classes}
      />
    );

    const inMarkup = classesInMarkup(html);
    const inSheet = classesInSheet(css);

    // Positive control: a fixture that rendered nothing, or compiled nothing, would satisfy every
    // comparison below vacuously.
    expect(inMarkup.size).toBeGreaterThan(0);
    expect(inSheet.size).toBeGreaterThan(0);

    const expectedClasses = expected.placed.map(
      key => classes.get(key) ?? nodeClass(key)
    );

    for (const cls of expectedClasses) {
      // Written by the compiler...
      expect(inSheet.has(cls), `sheet never wrote ${cls}`).toBe(true);
    }
    // ...and carried by exactly the elements that should carry it. A node whose class the sheet
    // wrote but the markup does not carry is dead CSS; the reverse is an unstyled node.
    const onPage = expectedClasses.filter(cls => inMarkup.has(cls));
    expect(onPage).toHaveLength(expected.onPage);
  });

  it("gives two placements of one block the SAME class", () => {
    // This is what makes a reusable block reusable: one rule, every placement. Two classes here
    // would mean editing the block updates one placement and not the other.
    const root = container("root", [ref("p1", "r1"), ref("p2", "r1")]);
    const refs = { r1: styled("lib", "Lib", "#bb0001") };
    const document = { root } as never;
    const classes = documentNodeClasses(document, refs);
    const html = renderToStaticMarkup(
      <RenderNode
        node={root}
        registry={defaultBlockRegistry}
        refs={refs}
        classes={classes}
      />
    );
    const markup = html.replace(/<style[\s\S]*?<\/style>/g, "");

    expect(markup.match(/Lib/g)).toHaveLength(2);
    const libClass = classes.get(`${"r1".length}:r1lib`) as string;
    expect(libClass).toBeDefined();
    // Both placements carry it, so one rule serves both.
    expect(markup.split(libClass).length - 1).toBe(2);
  });
});

describe("boundaries the key space and the sheet have to hold", () => {
  const doc = (root: BlockNode) => ({ root }) as never;

  it("keeps a document id shaped like a ref key from colliding with one", () => {
    // A node id is any non-empty string, so a document can literally carry the string a ref key
    // generates. Prefixing only the ref side would put both in the key set as one entry, and
    // nodeClassNames would hand them a single class.
    const generated = refScopedKey("r1", "same");
    const root = container("root", [
      styled(generated, "Doc", "#cc0001"),
      ref("p1", "r1"),
    ]);
    const refs = { r1: styled("same", "Lib", "#cc0002") };
    const classes = documentNodeClasses(doc(root), refs);

    // Two distinct entries, not one.
    expect(classes.get(documentKey(generated))).toBeDefined();
    expect(classes.get(generated)).toBeDefined();
    expect(classes.get(documentKey(generated))).not.toBe(
      classes.get(generated)
    );
  });

  it("emits no CSS for a library block the document never places", () => {
    // The whole library is in the KEY set so names stay stable across pages, but a page should
    // ship only the rules it can use — otherwise every page carries the whole library's CSS.
    const root = container("root", [styled("doc", "Doc", "#cc0003")]);
    const refs = { unused: styled("never", "Never", "#cc0004") };
    const css = compileDocumentCss(doc(root), {
      classes: documentNodeClasses(doc(root), refs),
      refs,
    });

    expect(css).toContain("#cc0003");
    expect(css).not.toContain("#cc0004");
  });

  it("nests a block's custom CSS under the document scope when there is one", () => {
    // A node class is a hash of a key, not of a document, so the same reusable block on two pages
    // resolves to the same node class. Without the document class in front, the later stylesheet
    // restyles both.
    const withCss: BlockNode = {
      ...styled("doc", "Doc", "#cc0005"),
      customCss: "selector { color: red }",
    };
    const root = container("root", [withCss]);
    const scoped = compileDocumentBlockCss(
      doc(root),
      documentNodeClasses(doc(root)),
      undefined,
      "nx-pb-d-abc"
    );
    const unscoped = compileDocumentBlockCss(
      doc(root),
      documentNodeClasses(doc(root))
    );

    expect(scoped).toContain(".nx-pb-d-abc");
    // Nested, not substituted: the block boundary still has to be there.
    expect(scoped).toContain(nodeClass("doc"));
    // Positive control: without a scope the rule is emitted, just unnested.
    expect(unscoped).toContain(nodeClass("doc"));
    expect(unscoped).not.toContain(".nx-pb-d-abc");
  });
});

describe("custom CSS boundaries a shared reusable block depends on", () => {
  const NODE = "nx-pb-node";
  const DOC_A = "nx-pb-d-aaa";
  const DOC_B = "nx-pb-d-bbb";

  it("keeps the block boundary when the author already wrote the document class", () => {
    // `.<document> p` is under the document but NOT under the block, so it reaches every sibling
    // block on the page. Treating "starts with the outer class" as fully scoped skips the
    // boundary that stops one block's CSS restyling another.
    const { css } = sanitizeBlockCss(`.${DOC_A} p { color: red }`, NODE, DOC_A);

    // The property is that every emitted selector BEGINS with the anchor, in document-then-block
    // order. Asserting that both names merely occur passes on `.<block> .<document> p`, which asks
    // for a document root nested inside a block and matches nothing; asserting the anchor appears
    // somewhere passes on a selector that reaches outside the block before coming back.
    expect(css.startsWith(`.${DOC_A} .${NODE} `)).toBe(true);
  });

  it("anchors a compound document selector without splitting the compound", () => {
    // `.doc.page p` is one compound naming the document root. Inserting the block class after the
    // first class of that compound moves the root's other classes onto the block, and the rule
    // stops matching. Prepending the whole anchor cannot do that.
    const { css } = sanitizeBlockCss(
      `.${DOC_A}.nx-pb-page p { color: red }`,
      NODE,
      DOC_A
    );

    expect(css.startsWith(`.${DOC_A} .${NODE} `)).toBe(true);
    expect(css).toContain(`.${DOC_A}.nx-pb-page`);
  });

  it("contains a selector that reaches a sibling of the block", () => {
    // `.wrapper selector ~ p` carries the block class and still targets a sibling OUTSIDE it, so
    // "the block class appears somewhere" is not evidence the selected element is inside. With the
    // anchor prepended the sibling is a sibling of an INNER copy, still inside the outer block.
    const { css } = sanitizeBlockCss(
      `.wrapper selector ~ p { color: red }`,
      NODE,
      DOC_A
    );

    expect(css.startsWith(`.${DOC_A} .${NODE} `)).toBe(true);
  });

  it.each(["+", "~"])(
    "does not accept %s as the document-to-block boundary",
    combinator => {
      // The anchor is `.<doc> .<block>` — a DESCENDANT relationship. `.doc + .block` names a
      // sibling of the document root that happens to carry the block class, which is outside the
      // document entirely. Comparing the combinator by node type alone accepts it and skips the
      // prefix, so the rule escapes.
      const { css } = sanitizeBlockCss(
        `.${DOC_A} ${combinator} .${NODE} p { color: red }`,
        NODE,
        DOC_A
      );

      expect(css.startsWith(`.${DOC_A} .${NODE} `)).toBe(true);
    }
  );

  it("leaves a selector the author anchored correctly exactly as written", () => {
    // The `selector` keyword rewrites to the FULL anchor, so it lands already anchored rather than
    // being prefixed into a descendant of itself.
    const { css } = sanitizeBlockCss(`selector { color: red }`, NODE, DOC_A);

    expect(css).toBe(`.${DOC_A} .${NODE}{color:red}`);
  });

  it("namespaces a keyframe name per DOCUMENT, not only per node", () => {
    // Two documents rendering the same reusable block share its node class, so a name derived
    // from the node class alone is the same string in both — and the later stylesheet's
    // definition wins for both pages.
    const authored =
      "@keyframes fade { from { opacity: 0 } } .x { animation: fade 1s }";
    const a = sanitizeBlockCss(authored, NODE, DOC_A).css;
    const b = sanitizeBlockCss(authored, NODE, DOC_B).css;

    // Positive control: each document really did emit a keyframes block.
    expect(a).toContain("@keyframes");
    expect(b).toContain("@keyframes");
    // ...under names that cannot collide across documents.
    const nameOf = (css: string) =>
      /@keyframes\s+([\w-]+)/.exec(css)?.[1] ?? "";
    expect(nameOf(a)).not.toBe("");
    expect(nameOf(a)).not.toBe(nameOf(b));
  });
});

describe("what a consumer of the class map has to compose", () => {
  it("does NOT answer a lookup by bare node id", () => {
    // The contract every reader of this map depends on. The editor canvas read `classes.get(id)`
    // and silently missed on every node — falling back to the undisambiguated class while the
    // compiled sheet targeted the suffixed one, so a collided block lost its styling in the
    // preview only.
    //
    // Asserted here rather than by rendering the canvas, because the canvas needs editor context
    // this suite does not build. That makes it a test of the CONTRACT, not of that component: it
    // pins the thing that would break the component, and would not catch a future consumer
    // written against the bare id.
    const root = container("root", [styled("n1", "One", "#dd0001")]);
    const classes = documentNodeClasses({ root } as never);

    expect(classes.get(documentKey("n1"))).toBeDefined();
    expect(classes.get("n1")).toBeUndefined();
  });
});
