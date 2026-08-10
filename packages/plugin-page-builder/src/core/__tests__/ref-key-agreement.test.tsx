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

describe("styling a core/ref PLACEMENT", () => {
  const doc = (root: BlockNode) => ({ root }) as never;

  it("puts the placement's class on the element the target renders", () => {
    // A resolved ref renders its target IN ITS PLACE and emits no element of its own, so a rule
    // written for the placement's class had nothing to match. Both classes land on one element
    // rather than the target being wrapped, because a block renders a single element and an extra
    // wrapper would change the layout around every reusable block on the page.
    const root = container("root", [ref("p1", "r1")]);
    const refs = { r1: styled("lib", "Lib", "#ee0001") };
    const classes = documentNodeClasses(doc(root), refs);
    const html = renderToStaticMarkup(
      <RenderNode
        node={root}
        registry={defaultBlockRegistry}
        refs={refs}
        classes={classes}
      />
    );
    const markup = html.replace(/<style[\s\S]*?<\/style>/g, "");

    const placement = classes.get(documentKey("p1")) ?? nodeClass("p1");
    const target = classes.get(refScopedKey("r1", "lib")) as string;

    // Positive control: the target's own class is there, so a fixture that rendered nothing could
    // not satisfy the assertion below.
    expect(markup).toContain(target);
    // The placement's class is on the SAME element, not on a wrapper around it.
    expect(markup).toMatch(
      new RegExp(`class="[^"]*${target}[^"]*${placement}[^"]*"`)
    );
  });

  it("emits the library BEFORE the document, so a placement overrides the block", () => {
    // Everything is emitted at one specificity, so precedence is source order and the later rule
    // wins. The placement is a document node; the block it places is a library node. Emitting the
    // library second would let the shared block override the customisation applied to one
    // placement of it, which is backwards.
    const root = container("root", [
      { ...ref("p1", "r1"), style: { base: { color: "#ee0002" } } },
    ]);
    const refs = { r1: styled("lib", "Lib", "#ee0003") };
    const css = compileDocumentCss(doc(root), {
      classes: documentNodeClasses(doc(root), refs),
      refs,
    });

    // Positive control: both rules are present, so an ordering assertion is not comparing -1s.
    expect(css).toContain("#ee0002");
    expect(css).toContain("#ee0003");
    expect(css.indexOf("#ee0003")).toBeLessThan(css.indexOf("#ee0002"));
  });

  it("does not carry the placement's class into the target's own slots", () => {
    // The placement names the block it places, not that block's children. Carrying it down would
    // restyle nodes the author never addressed.
    const root = container("root", [ref("p1", "r1")]);
    const refs = {
      r1: container("libroot", [styled("libchild", "Child", "#ee0004")]),
    };
    const classes = documentNodeClasses(doc(root), refs);
    const html = renderToStaticMarkup(
      <RenderNode
        node={root}
        registry={defaultBlockRegistry}
        refs={refs}
        classes={classes}
      />
    );
    const markup = html.replace(/<style[\s\S]*?<\/style>/g, "");
    const placement = classes.get(documentKey("p1")) ?? nodeClass("p1");

    // Exactly one element carries it: the target's root.
    expect(markup.split(placement).length - 1).toBe(1);
  });

  it("emits a nested target before the block that places it", () => {
    // Library-first is not enough on its own once a reusable block places another one: the inner
    // block is library too, and ordering the library by ref id would decide which of two library
    // blocks wins by their names. `outer` places `inner`, so `inner`'s rule has to come first for
    // the placement inside `outer` to override it — the same reason the document comes last.
    // The ref ids are chosen so that alphabetical order is the WRONG order: the block doing the
    // placing sorts first. Names where sorting happens to agree with dependency order would pass
    // against either implementation.
    const root = container("root", [ref("p1", "aaa-places")]);
    const refs = {
      // The placement of `zzz-placed` lives inside `aaa-places`, and is styled.
      "aaa-places": container("outerroot", [
        { ...ref("p2", "zzz-placed"), style: { base: { color: "#ee0005" } } },
      ]),
      "zzz-placed": styled("innerroot", "Inner", "#ee0006"),
    };
    const css = compileDocumentCss(doc(root), {
      classes: documentNodeClasses(doc(root), refs),
      refs,
    });

    // Positive control: both rules are present, so an ordering assertion is not comparing -1s.
    expect(css).toContain("#ee0005");
    expect(css).toContain("#ee0006");
    expect(css.indexOf("#ee0006")).toBeLessThan(css.indexOf("#ee0005"));
  });

  it("emits library custom CSS before the document's, like the generated tier", () => {
    // Custom CSS is anchored at one specificity too, so ordering this tier the other way round
    // would let the block's own custom CSS beat a placement's while its generated styles lost to
    // the same placement — two tiers disagreeing about which of them is the override.
    const root = container("root", [
      { ...ref("p1", "r1"), customCss: "selector { color: #ee0007 }" },
    ]);
    const refs = {
      r1: {
        ...styled("lib", "Lib", "#000000"),
        customCss: "selector { color: #ee0008 }",
      },
    };
    const css = compileDocumentBlockCss(
      doc(root),
      documentNodeClasses(doc(root), refs),
      refs,
      "nx-pb-scope"
    );

    expect(css).toContain("#ee0007");
    expect(css).toContain("#ee0008");
    expect(css.indexOf("#ee0008")).toBeLessThan(css.indexOf("#ee0007"));
  });

  it("withholds a target's hide from a placement that turns it back on", () => {
    // `display: none` is the one thing a later declaration cannot undo: no CSS value means "the
    // display you would otherwise have had". So the placement is excluded from the hide instead,
    // which is reachable state — unchecking "Hide on mobile" stores `true` rather than deleting
    // the key.
    const root = container("root", [
      { ...ref("p1", "r1"), visibility: { mobile: true } },
    ]);
    const refs = {
      r1: {
        ...container("lib", [
          {
            ...styled("libchild", "Child", "#ee0009"),
            visibility: { mobile: false },
          },
        ]),
        visibility: { mobile: false },
      },
    };
    const classes = documentNodeClasses(doc(root), refs);
    const css = compileDocumentCss(doc(root), { classes, refs });

    const placement = classes.get(documentKey("p1")) ?? nodeClass("p1");
    const target = classes.get(refScopedKey("r1", "lib")) as string;
    const child = classes.get(refScopedKey("r1", "libchild")) as string;

    // Positive control: the hide is emitted at all, so the assertion below is about its SHAPE.
    expect(css).toContain("display: none");
    expect(css).toContain(`.${target}:not(.${placement})`);
    // The target's descendants never carry the placement's class, so exempting them would only
    // add a selector that matches whatever it already matched.
    expect(css).toContain(`.${child} {`);
    expect(css).not.toContain(`.${child}:not(`);
  });

  it("answers each placement separately, and only the one that asked is shown", () => {
    // Every placement that speaks about visibility leaves the shared rule and gets its own, so
    // what has to be asserted is the OUTCOME per placement rather than who is exempted. At mobile
    // the target hides: `p1` overrode that, `p2` agreed with it, and `p3` spoke about a different
    // breakpoint entirely — so only `p1` shows.
    const root = container("root", [
      { ...ref("p1", "r1"), visibility: { mobile: true } },
      { ...ref("p2", "r1"), visibility: { mobile: false } },
      { ...ref("p3", "r1"), visibility: { tablet: true } },
    ]);
    const refs = {
      r1: { ...styled("lib", "Lib", "#ee0010"), visibility: { mobile: false } },
    };
    const classes = documentNodeClasses(doc(root), refs);
    const css = compileDocumentCss(doc(root), { classes, refs });

    const target = classes.get(refScopedKey("r1", "lib")) as string;
    const shown = classes.get(documentKey("p1")) ?? nodeClass("p1");
    const agreed = classes.get(documentKey("p2")) ?? nodeClass("p2");
    const elsewhere = classes.get(documentKey("p3")) ?? nodeClass("p3");
    const hiddenAtMobile = (placement: string) =>
      `@media (max-width: 640px) { .${target}.${placement} { display: none; } }`;

    // Positive control: the mechanism produced rules of this exact shape for someone.
    expect(css).toContain(hiddenAtMobile(agreed));
    expect(css).toContain(hiddenAtMobile(elsewhere));
    expect(css).not.toContain(hiddenAtMobile(shown));
    // And none of the three is left to the shared rule, which cannot distinguish them.
    for (const placement of [shown, agreed, elsewhere]) {
      expect(css).toContain(`:not(.${placement})`);
    }
  });

  it("clears a hide declared at a BROADER breakpoint than the placement overrode", () => {
    // The stored breakpoints are open-ended, so a `tablet` hide is still in force at mobile widths.
    // Exempting the placement only from the rule for the breakpoint it named would leave the
    // broader rule hiding it anyway — the fix has to reach every rule that covers those widths.
    const root = container("root", [
      { ...ref("p1", "r1"), visibility: { mobile: true } },
    ]);
    const refs = {
      r1: { ...styled("lib", "Lib", "#ee0011"), visibility: { tablet: false } },
    };
    const classes = documentNodeClasses(doc(root), refs);
    const css = compileDocumentCss(doc(root), { classes, refs });

    const placement = classes.get(documentKey("p1")) ?? nodeClass("p1");
    const target = classes.get(refScopedKey("r1", "lib")) as string;

    // The tablet hide no longer reaches this placement at all...
    expect(css).toContain(
      `@media (max-width: 1024px) { .${target}:not(.${placement}) { display: none; } }`
    );
    // ...and comes back closed at both ends, so it covers tablet widths WITHOUT covering mobile.
    expect(css).toContain(
      `@media (min-width: 640.02px) and (max-width: 1024px) { .${target}.${placement} { display: none; } }`
    );
  });

  it("follows a chain of root aliases when deciding which hide to clear", () => {
    // A reusable block whose ROOT is itself a ref renders its own target in its place, so one
    // element carries the classes of every block in the chain and the placement's class rides down
    // with them. Registering the placement against the block it names alone leaves the block at the
    // end of the chain hiding the element the placement is styling.
    const root = container("root", [
      { ...ref("p1", "alias"), visibility: { mobile: true } },
    ]);
    const refs = {
      alias: ref("aliasroot", "final"),
      final: {
        ...styled("lib", "Lib", "#ee0012"),
        visibility: { mobile: false },
      },
    };
    const classes = documentNodeClasses(doc(root), refs);
    const css = compileDocumentCss(doc(root), { classes, refs });

    const placement = classes.get(documentKey("p1")) ?? nodeClass("p1");
    const final = classes.get(refScopedKey("final", "lib")) as string;

    // The hide belongs to the block at the END of the chain, which the placement never named.
    expect(css).toContain(`.${final}:not(.${placement})`);
    expect(css).not.toContain(
      `@media (max-width: 640px) { .${final}.${placement} { display: none; } }`
    );
  });

  it("gives an element ONE verdict, not one per tier sharing it", () => {
    // An alias root is not a placement of its own: it renders only because something placed the
    // block it belongs to. Letting it reach a verdict independently produces a rule that matches
    // the outer placement's element too and contradicts it there — the outer setting is simply
    // overruled by a rule that never knew about it.
    const root = container("root", [
      { ...ref("p1", "alias"), visibility: { mobile: true } },
    ]);
    const refs = {
      alias: { ...ref("aliasroot", "final"), visibility: { mobile: false } },
      final: {
        ...styled("lib", "Lib", "#ee0013"),
        visibility: { tablet: false },
      },
    };
    const classes = documentNodeClasses(doc(root), refs);
    const css = compileDocumentCss(doc(root), { classes, refs });

    const placement = classes.get(documentKey("p1")) ?? nodeClass("p1");
    const aliasRoot = classes.get(refScopedKey("alias", "aliasroot")) as string;
    const final = classes.get(refScopedKey("final", "lib")) as string;

    // Positive control: the alias's own hide is still emitted, exempting the placement — so the
    // assertion below is about the alias reaching a SEPARATE verdict, not about it going silent.
    expect(css).toContain(
      `@media (max-width: 640px) { .${aliasRoot}:not(.${placement}) { display: none; } }`
    );
    expect(css).not.toContain(`.${final}.${aliasRoot}`);
    // The one verdict: the placement showed itself at mobile, and the block it reaches is hidden
    // at tablet, so tablet widths are the only ones it is hidden at.
    expect(css).toContain(
      `@media (min-width: 640.02px) and (max-width: 1024px) { .${final}.${placement} { display: none; } }`
    );
    expect(css).not.toContain(
      `@media (max-width: 640px) { .${final}.${placement} { display: none; } }`
    );
  });

  it("starts a band just above the breakpoint below, not a whole pixel above", () => {
    // A whole pixel leaves fractional widths in no band at all: at 640.5px neither `max-width:
    // 640px` nor `min-width: 641px` matches, and the element the band exists to hide appears. Page
    // zoom and display scaling both produce fractional widths.
    const root = container("root", [
      { ...ref("p1", "r1"), visibility: { mobile: true } },
    ]);
    const refs = {
      r1: { ...styled("lib", "Lib", "#ee0014"), visibility: { tablet: false } },
    };
    const css = compileDocumentCss(doc(root), {
      classes: documentNodeClasses(doc(root), refs),
      refs,
    });

    expect(css).toContain("(min-width: 640.02px)");
    expect(css).not.toContain("(min-width: 641px)");
  });

  it("does not let a placement's own open-ended rule outlive its resolution", () => {
    // A placement's class is on the element its target renders, so its ordinary rules land there
    // beside the band rules. `{ base: false, tablet: true }` compiles by the ordinary path to one
    // unconditional hide and nothing for the `true` — which hides at every width and overrules the
    // per-band answer the compiler just worked out. Once a placement is resolved into bands, the
    // bands are its only answer.
    const root = container("root", [
      { ...ref("p1", "r1"), visibility: { base: false, tablet: true } },
    ]);
    const refs = {
      r1: { ...styled("lib", "Lib", "#ee0015"), visibility: { mobile: false } },
    };
    const classes = documentNodeClasses(doc(root), refs);
    const css = compileDocumentCss(doc(root), { classes, refs });

    const placement = classes.get(documentKey("p1")) ?? nodeClass("p1");
    const target = classes.get(refScopedKey("r1", "lib")) as string;

    // Hidden above the widest breakpoint, and at mobile where the target hides it...
    expect(css).toContain(
      `@media (min-width: 1024.02px) { .${target}.${placement} { display: none; } }`
    );
    expect(css).toContain(
      `@media (max-width: 640px) { .${target}.${placement} { display: none; } }`
    );
    // ...and nowhere unconditionally, which is what would hide it at tablet too.
    //
    // Compared line by line, not as a substring: the band rules above compound both classes, so
    // `.target.placement { display: none; }` CONTAINS the text of the unconditional rule and a
    // substring check would pass against code that still emits it.
    expect(css.split("\n")).not.toContain(`.${placement} { display: none; }`);
  });

  it("still answers a resolved placement when its target says nothing about visibility", () => {
    // The band rules belong to the placement, not to the target, so gating them on the target's own
    // settings would drop them entirely — and suppressing the placement's ordinary rules on top of
    // that leaves nothing hiding it at all. The failure direction is OPEN, so it is the one to pin.
    const root = container("root", [
      { ...ref("p1", "r1"), visibility: { base: false, tablet: true } },
    ]);
    const refs = { r1: styled("lib", "Lib", "#ee0016") };
    const classes = documentNodeClasses(doc(root), refs);
    const css = compileDocumentCss(doc(root), { classes, refs });

    const placement = classes.get(documentKey("p1")) ?? nodeClass("p1");
    const target = classes.get(refScopedKey("r1", "lib")) as string;

    expect(css).toContain(
      `@media (min-width: 1024.02px) { .${target}.${placement} { display: none; } }`
    );
    // Visible below that, because the placement asked to be seen from tablet down.
    expect(css).not.toContain(
      `@media (max-width: 640px) { .${target}.${placement} { display: none; } }`
    );
  });
});
