/**
 * What makes `core/card` a preset rather than a second container.
 *
 * Rendering proves nothing here: a card delegates to `renderContainer`, so a
 * test asserting it produces a `div` passes just as well on a `core/box` and
 * would keep passing if the block were deleted and aliased. The property that
 * SEPARATES a preset from a fork is that it differs in what it starts as and in
 * nothing else, so that is what is asserted. Its compiled defaults are covered
 * by `base-styles.test.tsx`, which derives the check from every block that
 * declares them rather than repeating one here.
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PageRenderer } from "../page-renderer";
import type { BlockResolver } from "../resolver";
import { createBlockResolver } from "../resolver";
import { resolvePageStyles } from "../styles";

import { box } from "./box";
import { card, CARD_BLOCK } from "./card";
import { columns } from "./columns";
import { coreBlocks } from "./index";
import { section } from "./section";

describe("core/card", () => {
  describe("relationships and defaults, never capabilities", () => {
    it("shares the container implementation rather than forking it", () => {
      // Two blocks pointing at ONE render function is what keeps a preset from
      // drifting into a second container with its own bugs — the Elementor V3
      // Section/Column failure `container.tsx` cites, whose migration tool
      // broke live sites because the elements had diverged in capability.
      expect(card.render).toBe(box.render);
    });

    it("shares ONE support declaration with every container preset", () => {
      // Asserting identity is what couples them; asserting the VALUES would
      // pass on parallel copies that agree today and diverge on the next
      // addition, silently giving one container different editor controls.
      expect(card.supports).toBe(box.supports);
      expect(card.supports).toBe(section.supports);
      expect(card.supports).toBe(columns.supports);
    });

    it("holds anything a box holds", () => {
      // A card restricting its slot would be the `core/columns` arrangement,
      // and a row restricts its slot because a column is meaningless anywhere
      // else. Nothing about a card's contents is.
      expect(card.slots?.children.allow).toBeUndefined();
    });

    it("is not confined to any parent", () => {
      // The child half of the nesting rule, which a card must NOT declare: a
      // card is placeable anywhere a box is.
      expect(card.parent).toBeUndefined();
    });
  });

  describe("the element it renders", () => {
    it("defaults to a plain div rather than a landmark", () => {
      // `article` is announced as a landmark, which is noise on a card that
      // merely groups a heading and a sentence, and correct on one that is
      // independently distributable. The author knows which theirs is, so the
      // quiet element is the default and the semantic one is offered.
      expect(card.defaultProps?.as).toBe("div");
      expect(card.props?.as?.options).toContain("article");
    });
  });

  describe("what a fresh card starts with", () => {
    it("declares no starting children, unlike a row", () => {
      // A row declares two columns because its slot admits only `core/column`,
      // and that block names the row as its only parent — so an empty row is a
      // container whose one legal child can be placed nowhere else. A card's
      // slot admits every block, so no starting child is more correct than
      // none, and seeding one would put a block on the page to be deleted.
      expect(card.slots?.children.defaultBlock).toBeUndefined();
      expect(card.slots?.children.allow).toBeUndefined();
    });
  });

  describe("registration", () => {
    it("ships in the core library under the name its tests use", () => {
      expect(card.name).toBe(CARD_BLOCK);
      expect(coreBlocks.map(block => block.name)).toContain(CARD_BLOCK);
    });
  });
});

describe("the surface and border it carries", () => {
  /**
   * Asserts the COMPILED CSS, because that is where this block's history lives:
   * it declined a background and a border for as long as no token resolved, and
   * an object assertion would have passed throughout — the declaration was never
   * the missing part.
   */
  function compiledCss(): string {
    const doc: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "c", type: CARD_BLOCK, version: 1, props: {} }],
    };
    const resolver: BlockResolver = {
      get: (name: string) =>
        coreBlocks.find(block => block.name === name) as never,
    };
    return (
      resolvePageStyles(
        doc,
        undefined,
        {
          breakpoints: {
            viewport: [{ id: "base", label: "Desktop" }],
            container: [],
          },
        },
        resolver
      ).css ?? ""
    );
  }

  it("emits a surface colour and a hairline, as token references", () => {
    const css = compiledCss();

    // The VAR, not a hex. A literal colour is wrong in whichever of light and
    // dark it was not chosen for, which is the whole reason the token set exists
    // — so a compiled hex here would mean the token had been abandoned.
    expect(css).toContain("background-color: var(--site-color-surface)");
    expect(css).toContain("border-color: var(--site-color-border)");
  });

  it("emits the hairline on all four LOGICAL sides", () => {
    // Logical rather than physical, so a right-to-left page borders the side an
    // author means rather than the side an English-speaking author assumed.
    const css = compiledCss();

    expect(css).toContain("border-block-start-width: 1px");
    expect(css).toContain("border-inline-start-width: 1px");
    expect(css).toContain("border-style: solid");
  });

  it("still clips, because a border does not remove the reason for the clip", () => {
    // A bordered card with square-cornered image children is the same defect the
    // clip exists for; adding the border must not have displaced it.
    const css = compiledCss();

    expect(css).toContain("overflow: hidden");
    expect(css).toContain("border-radius: 12px");
  });
});

/**
 * The declarations a card's colours resolve against, on the path that has no
 * write access to compile them.
 *
 * A consumer with no write path compiles a page once, stores the CSS and hands
 * it back as `styles`. That artifact still carries every `var(--site-*)` it was
 * compiled with, so the question is whether anything on the rendered page
 * DECLARES them — and a custom property nothing declares makes its whole
 * declaration invalid at computed-value time, dropping the property to its
 * INITIAL value rather than to the site's.
 *
 * Which is why both colours are asserted rather than the background alone. The
 * two initial values differ in kind: `background-color` is `transparent`, so a
 * missing surface reads as no fill, while `border-color` is `currentColor`, so a
 * missing border colour reads as a hairline in the TEXT colour. A card in that
 * state is not an unstyled card, it is a hard box nobody asked for — and a test
 * asserting only the surface passes on it.
 */
describe("the tokens a stored artifact resolves against", () => {
  const DOC: BlockDocument = {
    formatVersion: 1,
    kind: "page",
    nodes: [{ id: "c", type: CARD_BLOCK, version: 1, props: { as: "div" } }],
  };

  /** The page as a consumer stores it: compiled once, with no context kept. */
  function renderFromStoredArtifact(): string {
    const resolver = createBlockResolver([...coreBlocks]);
    const stored = resolvePageStyles(
      DOC,
      undefined,
      {
        breakpoints: {
          viewport: [{ id: "base", label: "Desktop" }],
          container: [],
        },
      },
      resolver
    );
    return renderToStaticMarkup(
      <PageRenderer document={DOC} blocks={resolver} styles={stored} />
    );
  }

  it("REFERENCES both colours, which is what makes the next case meaningful", () => {
    // The precondition, asserted rather than assumed: if the card stopped
    // emitting these references the declarations below would be pointless, and
    // a test that only checked for the declarations would still pass.
    const markup = renderFromStoredArtifact();

    expect(markup).toContain("var(--site-color-surface)");
    expect(markup).toContain("var(--site-color-border)");
  });

  it("DECLARES both colours, so neither falls back to its initial value", () => {
    const markup = renderFromStoredArtifact();

    expect(markup).toContain("--site-color-surface:");
    expect(markup).toContain("--site-color-border:");
  });

  it("declares nothing on a page that emits no css of its own", () => {
    // Must-differ. The token tier accompanies the CSS it exists to resolve, so a
    // render with no stylesheet must stay silent rather than push `--site-*`
    // onto a host that asked this renderer for markup alone. Without this the
    // case above is satisfied by emitting the tier unconditionally, which is a
    // different behaviour that passes the same assertion.
    const markup = renderToStaticMarkup(
      <PageRenderer document={DOC} blocks={createBlockResolver([])} />
    );

    expect(markup).not.toContain("--site-color-surface:");
    expect(markup).not.toContain("<style");
  });
});
