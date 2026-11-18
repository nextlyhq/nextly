/**
 * The links inside a container that sets a text colour take that colour,
 * while the site's Links row sets none; once the row sets a colour, it is the
 * only rule colouring links.
 *
 * Asserted on the compiled sheet. The cascade these rules rely on (an author
 * rule beating the browser's own link colour, zero specificity losing to a
 * colour set on the link) is measured in a browser by the e2e suite's
 * container text spec.
 */
import { describe, expect, it } from "vitest";

import type { BlockDocument, BlockNode } from "../document";
import { FIXTURE_BREAKPOINTS } from "../validation.fixtures";

import { compilePageCss, type StyleCompileContext } from "./compile-page";
import { nodeClassName, PAGE_ROOT_SELECTOR } from "./node-class";
import type { NamedClass } from "./named-class";

const CTX: StyleCompileContext = { breakpoints: FIXTURE_BREAKPOINTS };

const page = (nodes: unknown[]): BlockDocument =>
  ({ formatVersion: 1, kind: "page", nodes }) as unknown as BlockDocument;

const white = { base: { base: { color: "#ffffff" } } };

/** A Section holding the given blocks, with its own styles if any. */
function section(
  id: string,
  children: unknown[],
  extra: Record<string, unknown> = {}
): BlockNode {
  return {
    id,
    type: "core/section",
    version: 1,
    props: {},
    slots: { children },
    ...extra,
  } as unknown as BlockNode;
}

/** A Text block, which holds no blocks. */
function text(id: string, extra: Record<string, unknown> = {}): BlockNode {
  return {
    id,
    type: "core/text",
    version: 1,
    props: { text: "Words" },
    ...extra,
  } as unknown as BlockNode;
}

const css = (document: BlockDocument, ctx: StyleCompileContext = CTX) =>
  compilePageCss(document, ctx).css;

/** The rule that makes links inside `element` inherit, as the sheet writes it. */
const inherits = (element: string) => `:where(${element} a) { color: inherit }`;

const own = (id: string) => `${PAGE_ROOT_SELECTOR} .${nodeClassName(id)}`;

describe("a container's own text colour", () => {
  it("makes the links inside it take the colour, at zero specificity", () => {
    const out = css(page([section("s1", [text("t1")], { styles: white })]));
    expect(out).toContain(`${own("s1")} { color: #ffffff }`);
    expect(out).toContain(inherits(`${own("s1")}`));
  });

  it("writes nothing for links while the container sets no colour", () => {
    const out = css(
      page([
        section("s1", [text("t1")], {
          styles: { base: { base: { backgroundColor: "#111111" } } },
        }),
      ])
    );
    expect(out).not.toContain(" a) { color: inherit }");
  });

  it("writes nothing for links in a block that holds none, coloured or not", () => {
    // A paragraph with a colour of its own keeps the browser's link colour,
    // as it does today.
    const out = css(page([text("t1", { styles: white })]));
    expect(out).toContain(`${own("t1")} { color: #ffffff }`);
    expect(out).not.toContain(" a) { color: inherit }");
  });

  it("follows the colour's breakpoint and state", () => {
    const out = css(
      page([
        section("s1", [text("t1")], {
          styles: {
            base: { mobile: { color: "#ffffff" } },
            hover: { base: { color: "#eeeeee" } },
          },
        }),
      ])
    );
    expect(out).toContain(
      [
        "@media (max-width: 640px) {",
        `  ${own("s1")} { color: #ffffff }`,
        `  ${inherits(own("s1"))}`,
        "}",
      ].join("\n")
    );
    expect(out).toContain(inherits(`${own("s1")}:where(:hover)`));
  });
});

describe("the site's Links row", () => {
  it("is the only rule colouring links once it sets a colour", () => {
    const document = page([section("s1", [text("t1")], { styles: white })]);
    for (const link of [{ color: "#cc0000" }, { hoverColor: "#cc0000" }]) {
      const out = css(document, { ...CTX, siteText: { link } });
      expect(out).toContain(`${own("s1")} { color: #ffffff }`);
      expect(out).not.toContain(" a) { color: inherit }");
    }
  });

  it("leaves containers making their links inherit while it sets only the underline", () => {
    const out = css(page([section("s1", [text("t1")], { styles: white })]), {
      ...CTX,
      siteText: { link: { underline: "hover" } },
    });
    expect(out).toContain(inherits(`${own("s1")}`));
  });
});

describe("a container's colour from the site's Design", () => {
  const look: NamedClass = {
    id: "look:core/section:dark",
    slug: "section-dark",
    orderIndex: 0,
    blockType: "core/section",
    styles: white,
  } as NamedClass;
  const shared: NamedClass = {
    id: "c-inverse",
    slug: "inverse",
    orderIndex: 1,
    styles: white,
  } as NamedClass;

  it("makes the links inside a container wearing a look take its colour", () => {
    const out = css(
      page([section("s1", [text("t1")], { classes: [look.id] })]),
      { ...CTX, namedClasses: [look] }
    );
    expect(out).toContain(inherits(`${PAGE_ROOT_SELECTOR} .nx-l-section-dark`));
  });

  it("narrows a shared style to the containers wearing it", () => {
    const out = css(
      page([
        section("s1", [text("t1", { classes: [shared.id] })], {
          classes: [shared.id],
        }),
      ]),
      { ...CTX, namedClasses: [shared] }
    );
    expect(out).toContain(
      inherits(
        `${PAGE_ROOT_SELECTOR} .nx-c-inverse:is(.${nodeClassName("s1")})`
      )
    );
  });

  it("writes nothing for links under a shared style no container wears", () => {
    const out = css(page([text("t1", { classes: [shared.id] })]), {
      ...CTX,
      namedClasses: [shared],
    });
    expect(out).not.toContain(" a) { color: inherit }");
  });

  it("makes the links inside a container reached by its type's ★ look take its colour", () => {
    const starred = { ...look, starred: true } as NamedClass;
    const out = css(page([section("s1", [text("t1")])]), {
      ...CTX,
      namedClasses: [starred],
    });
    expect(out).toContain(
      inherits(`${PAGE_ROOT_SELECTOR} :is(.${nodeClassName("s1")})`)
    );
  });

  it("makes the links inside a container type whose defaults colour it take the colour, weightless", () => {
    const out = css(page([section("s1", [text("t1")])]), {
      ...CTX,
      blockBases: { "core/section": white as never },
    });
    expect(out).toContain(inherits(".nx-pb-page .nx-bt-core--section"));
  });
});
