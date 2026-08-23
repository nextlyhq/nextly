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
  StyleCompileContext,
} from "@nextlyhq/blocks-engine";

import { createBlockResolver } from "./resolver";
import { sharedStyleInputsId } from "./shared-style-inputs";
import { resolvePageStyles, type PageStyles } from "./styles";

const blocks = createBlockResolver([]);

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
  return resolvePageStyles(doc(), styles, now, blocks, false, {
    sharedInputsId: sharedStyleInputsId(now),
  });
}

describe("a stored sheet against the site's shared inputs", () => {
  it("is REUSED when the inputs have not moved", () => {
    // The control. Everything below asserts a refusal, and a resolver that
    // refused unconditionally would pass all of them while recompiling every
    // page on every render — which is the cost the whole stamp exists to avoid.
    const now = context();

    expect(resolve(stored(sharedStyleInputsId(now)), now).css).toContain(
      "color: teal"
    );
  });

  it("is REFUSED when a class was renamed under it", () => {
    // The case this exists for. A document references classes by id, so the
    // rename needs no document migration — but the selector is `nx-c-<slug>`,
    // so the stored sheet still carries the old one and the page silently
    // loses that styling.
    const before = sharedStyleInputsId(context("hero"));

    const styles = resolve(stored(before), context("banner"));

    expect(styles.css).not.toContain("color: teal");
  });

  it("is REFUSED when the token prefix moved", () => {
    const before = sharedStyleInputsId(context());
    const moved: StyleCompileContext = { ...context(), tokenPrefix: "--acme-" };

    expect(resolve(stored(before), moved).css).not.toContain("color: teal");
  });

  it("is REFUSED when the breakpoints moved", () => {
    const before = sharedStyleInputsId(context());
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
    expect(styles.sharedInputsId).toBe(sharedStyleInputsId(context()));
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
