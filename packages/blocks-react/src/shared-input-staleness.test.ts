/**
 * Whether a stored sheet survives a change to the SITE's shared style inputs.
 *
 * `shared-style-inputs.test.ts` asserts that the stamp moves when an input
 * does. This file asserts the half that actually protects a page: that
 * `resolvePageStyles` refuses an artifact whose stamp disagrees, and reuses one
 * whose stamp matches. A correct stamp nobody compares is worth nothing.
 *
 * The compile context is what carries the shared inputs, so every case here
 * supplies one — which is also the only state in which a refusal can be acted
 * on. Without a context there is nothing to recompile with, and that case is
 * asserted last precisely because it is the one where refusing would cost the
 * page its styling rather than a recompile.
 *
 * @module shared-input-staleness.test
 */
import { describe, expect, it } from "vitest";

import type {
  BlockDocument,
  BlockNode,
  NodeStyles,
  StyleCompileContext,
} from "@nextlyhq/blocks-engine";

import { defineBlock } from "./context";
import { createBlockResolver } from "./resolver";
import { resolvePageStyles, type PageStyles } from "./styles";

/**
 * A block whose TYPE carries defaults, so the resolver has some to derive.
 *
 * An empty resolver makes `blockBasesFor` return `{}`, which stamps identically
 * to the `undefined` a caller's own context holds — so every assertion about
 * derived defaults would pass against an implementation that never derived
 * them. The fixture has to be able to tell the two apart before it can test
 * which one is used.
 */
const styledBlock = defineBlock({
  // `name`, because `createBlockResolver` keys its map on `definition.name` —
  // a fixture keyed on `type` resolves to nothing and its defaults never reach
  // `blockBasesFor`, which is silent and looks like the derivation not running.
  name: "test/text",
  version: 1,
  description: "Declares shared defaults for its type.",
  example: { props: {} },
  baseStyles: { base: { base: { color: "#010101" } } },
  render: () => null,
});

const blocks = createBlockResolver([styledBlock]);

const node = (id: string): BlockNode => ({
  id,
  type: "test/text",
  version: 1,
  props: {},
});

const doc = (): BlockDocument => ({
  formatVersion: 1,
  kind: "page",
  nodes: [node("a")],
});

/** The site's shared inputs, as a render carries them. */
const context = (slug = "hero"): StyleCompileContext => ({
  breakpoints: { viewport: [{ id: "base", label: "Base" }], container: [] },
  tokenPrefix: "--site-",
  namedClasses: [
    {
      id: "c1",
      slug,
      orderIndex: 0,
      styles: { base: { base: { color: "#111111" } } },
    },
  ],
});

/** A stored sheet whose text is recognisable, stamped or not. */
const stored = (sharedInputsId?: string): PageStyles => ({
  css: ".nx-a { color: teal }",
  classes: { a: "nx-a" },
  ...(sharedInputsId === undefined ? {} : { sharedInputsId }),
});

/** What a render decides, given an artifact and the inputs now in force. */
function resolve(styles: PageStyles, now: StyleCompileContext): PageStyles {
  return resolvePageStyles(doc(), styles, now, blocks, false, {});
}

/**
 * The stamp a render under these inputs actually writes.
 *
 * Taken from a real compile rather than computed here. The resolver derives the
 * identity from the context it COMPILES, which is not the context handed in —
 * it fills in block defaults from the resolver first — so a stamp built in the
 * test would be a second answer to the same question and would agree only by
 * coincidence.
 */
function stampWritten(now: StyleCompileContext): string | undefined {
  return resolvePageStyles(doc(), undefined, now, blocks, false, {})
    .sharedInputsId;
}

describe("a stored sheet against the site's shared inputs", () => {
  it("is REUSED when the inputs have not moved", () => {
    // The control. Everything below asserts a refusal, and a resolver that
    // refused unconditionally would pass all of them while recompiling every
    // page on every render — which is the cost the whole stamp exists to avoid.
    const now = context();

    expect(resolve(stored(stampWritten(now)), now).css).toContain(
      "color: teal"
    );
  });

  it("is REFUSED when a class was renamed under it", () => {
    // The case this exists for. A document references classes by id, so the
    // rename needs no document migration — but the selector is `nx-c-<slug>`,
    // so the stored sheet still carries the old one and the page silently
    // loses that styling.
    const before = stampWritten(context("hero"));

    const styles = resolve(stored(before), context("banner"));

    expect(styles.css).not.toContain("color: teal");
  });

  it("is REFUSED when the token prefix moved", () => {
    const before = stampWritten(context());
    const moved: StyleCompileContext = { ...context(), tokenPrefix: "--acme-" };

    expect(resolve(stored(before), moved).css).not.toContain("color: teal");
  });

  it("is REFUSED when the breakpoints moved", () => {
    const before = stampWritten(context());
    const moved: StyleCompileContext = {
      ...context(),
      breakpoints: {
        viewport: [
          { id: "base", label: "Base" },
          { id: "md", label: "Medium", maxWidth: 768 },
        ],
        container: [],
      },
    };

    expect(resolve(stored(before), moved).css).not.toContain("color: teal");
  });

  it("is REFUSED when it carries NO stamp and the render has inputs", () => {
    // The migration, and the reason an unstamped artifact is not simply
    // trusted: every sheet written before this field existed is in this state,
    // and each is stale against whatever the site has done since. It recompiles
    // once and is stamped on the way out.
    const styles = resolve(stored(undefined), context());

    expect(styles.css).not.toContain("color: teal");
    expect(styles.sharedInputsId).toBe(stampWritten(context()));
  });

  it("keeps a STAMPED sheet when the render states no inputs at all", () => {
    // The case a refusal cannot help. With no compile context the render cannot
    // derive an identity to compare against and has nothing to recompile with,
    // so treating the artifact's own stamp as a mismatch would withhold the
    // sheet and render the page UNSTYLED — worse than the staleness it guards.
    // The question is not asked where it cannot be answered.
    const styles = resolvePageStyles(
      doc(),
      stored(stampWritten(context())),
      undefined,
      blocks,
      false,
      {}
    );

    expect(styles.css).toContain("color: teal");
  });

  it("REFUSES when only the derived block defaults moved", () => {
    // The identity is taken from the context that is COMPILED, not the one
    // handed in — the resolver fills block defaults from the resolver itself,
    // and a stamp read before that step describes a compile that never happens.
    const withDefaults = stampWritten(context());
    const bare = resolvePageStyles(
      doc(),
      undefined,
      context(),
      createBlockResolver([]),
      false,
      {}
    ).sharedInputsId;

    // The two renders differ ONLY in what the resolver derived, so equal stamps
    // here would mean the derivation never reached the identity.
    expect(withDefaults).not.toBe(bare);
    expect(resolve(stored(bare), context()).css).not.toContain("color: teal");
  });

  it("keeps an UNSTAMPED sheet when the render states no inputs at all", () => {
    // The case where refusing would cost more than it protects. With no compile
    // context there is nothing to recompile WITH, so refusing does not produce a
    // correct sheet — it produces no sheet, and the page renders unstyled.
    //
    // Safe because the two agree: an artifact with no stamp and a render that
    // states no inputs describe the same absence. The moment a render DOES state
    // them, the test above applies instead.
    const styles = resolvePageStyles(
      doc(),
      stored(undefined),
      undefined,
      blocks,
      false,
      {}
    );

    expect(styles.css).toContain("color: teal");
  });
});

describe("the exported resolver, handed a site-wide block library", () => {
  // The renderer is not the only door. `resolvePageStyles` is exported and
  // `preparePageForRead` calls it, so a consumer that puts the site's whole
  // `blockBases` on its context reaches the identity through a path the
  // renderer's own narrowing never touches.
  const base = (colour: string) => ({ base: { base: { color: colour } } });

  const contextWithLibrary = (unusedColour: string): StyleCompileContext => ({
    ...context(),
    blockBases: {
      "test/text": base("#010101"),
      // Installed and absent from this document, so `compilePageCss` reads no
      // base for it and emits nothing from it.
      "test/never-used": base(unusedColour),
    },
  });

  const stampWith = (unusedColour: string) =>
    resolvePageStyles(
      doc(),
      undefined,
      contextWithLibrary(unusedColour),
      blocks,
      false,
      {}
    ).sharedInputsId;

  it("does not move when a default changes for a type the page never draws", () => {
    expect(stampWith("#040404")).toBe(stampWith("#eeeeee"));
  });

  it("CONTROL: still moves when a default changes for a type it DOES draw", () => {
    // The separating property. A resolver that dropped every stated base — or
    // one that stopped reading them at all — would satisfy the assertion above
    // while going blind to the change that actually reaches the sheet.
    const drawn = (colour: string): StyleCompileContext => ({
      ...context(),
      blockBases: { "test/text": base(colour) },
    });

    expect(
      resolvePageStyles(doc(), undefined, drawn("#010101"), blocks, false, {})
        .sharedInputsId
    ).not.toBe(
      resolvePageStyles(doc(), undefined, drawn("#020202"), blocks, false, {})
        .sharedInputsId
    );
  });
});

describe("an INHERITED block base is not turned into an emitted one", () => {
  // `compilePageCss` emits a base for a used type only when
  // `Object.hasOwn(bases, type)` succeeds, and its comment says why the boundary
  // is drawn there: a node type reaches a SELECTOR, and this compiler reads
  // persisted data whether or not anything validated it.
  //
  // Narrowing a stated record walks the document and copies what it finds, so a
  // lookup that answered from the prototype would make an inherited value an OWN
  // property of the narrowed record — and the compiler, seeing an own property,
  // would emit a rule it had deliberately declined to emit.
  const inherited = (colour: string): Record<string, NodeStyles> =>
    Object.create({
      "test/text": { base: { base: { color: colour } } },
    }) as Record<string, NodeStyles>;

  it("emits nothing for a base reachable only through the prototype", () => {
    const css = resolvePageStyles(
      doc(),
      undefined,
      { ...context(), blockBases: inherited("#abcdef") },
      blocks,
      false,
      {}
    ).css;

    expect(css).not.toContain("#abcdef");
  });

  it("CONTROL: emits it when the record owns the entry", () => {
    // The separating property. A narrowing that dropped every stated base would
    // satisfy the assertion above while going blind to the ordinary case.
    const css = resolvePageStyles(
      doc(),
      undefined,
      {
        ...context(),
        blockBases: { "test/text": { base: { base: { color: "#abcdef" } } } },
      },
      blocks,
      false,
      {}
    ).css;

    expect(css).toContain("#abcdef");
  });
});

describe("a block that changes one of its own parts", () => {
  // A block adding or changing a part changes the CSS `compilePageCss` emits.
  // If the identity cannot see it, the `styles && !untrusted` path reuses the
  // artifact compiled before the change and the new rules never appear — a
  // stale sheet served as a fresh one, which nothing downstream can detect.
  const withPart = (colour: string): StyleCompileContext => ({
    ...context(),
    blockParts: {
      "test/text": {
        caption: { baseStyles: { base: { base: { color: colour } } } },
      },
    },
  });

  const stampWith = (ctx: StyleCompileContext) =>
    resolvePageStyles(doc(), undefined, ctx, blocks).sharedInputsId;

  it("moves the identity when a part's value changes", () => {
    expect(stampWith(withPart("#010101"))).not.toBe(
      stampWith(withPart("#020202"))
    );
  });

  it("moves the identity when a part is added at all", () => {
    expect(stampWith(context())).not.toBe(stampWith(withPart("#010101")));
  });

  it("leaves the identity alone when no block declares a part", () => {
    // The control the two above need. Without it, an identity that changed on
    // EVERY compile would satisfy both while seeing nothing — and it also pins
    // the reason the tier is spread rather than slotted: while nothing declares
    // a part, every artifact already stored keeps its stamp.
    expect(stampWith(context())).toBe(
      stampWith({ ...context(), blockParts: { "test/text": {} } })
    );
  });
});
