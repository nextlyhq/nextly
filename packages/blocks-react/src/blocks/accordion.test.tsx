/**
 * What makes `core/accordion` and `core/accordion-item` worth being two blocks.
 *
 * The group delegates to `renderContainer`, so asserting that it draws a `div`
 * would pass equally on a `core/box` and would keep passing if the pair were
 * deleted and aliased. What SEPARATES this pair is the nesting rule's two
 * halves, the native disclosure element the item renders, and the fact that a
 * section's body is a SLOT rather than a string — that last one being the whole
 * reason this is a port rather than a copy of the older repeater block.
 */
import {
  blockPartClassName,
  DISCLOSURE_ICON_CLASS,
  DISCLOSURE_TITLE_CLASS,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PageRenderer } from "../page-renderer";
import { createBlockResolver } from "../resolver";
import { resolvePageStyles } from "../styles";

import { accordion, ACCORDION_BASE_STYLES } from "./accordion";
import {
  accordionItem,
  ACCORDION_BLOCK,
  ACCORDION_ITEM_BLOCK,
  ACCORDION_ITEM_SUPPORTS,
} from "./accordion-item";
import { coreBlocks } from "./index";

/** Render args with only what these blocks read, so a test states its inputs. */
function args(props: Record<string, unknown>, slot = "BODY") {
  return {
    props,
    node: { id: "n1", type: ACCORDION_ITEM_BLOCK, version: 1, props },
    className: "cls",
    // Outside any accordion's render, as a section drawn alone is.
    ctx: {},
    // Required by the render contract; these fixtures declare no parts.
    partClass: () => "",
    renderSlot: (name: string) => (name === "children" ? slot : null),
  } as never;
}

describe("the accordion pair", () => {
  it("states BOTH halves of the nesting rule", () => {
    // Neither half implies the other: `block.ts` is explicit that a slot naming
    // a type does not confine that type to it, so a group that only declared
    // `allow` would still let a section be dropped at the document root.
    expect(accordion.slots?.children?.allow).toEqual([ACCORDION_ITEM_BLOCK]);
    expect(accordionItem.parent).toEqual([ACCORDION_BLOCK]);
  });

  describe("what a fresh accordion starts with", () => {
    it("declares ONE section, by type rather than as a stored node", () => {
      // The same rule the columns pair follows: this slot admits only
      // `core/accordion-item`, and that block names this one as its only
      // parent, so an empty accordion is a container whose single legal child
      // can be placed nowhere else on the page.
      //
      // The declaration names a TYPE and carries no id, which is what lets two
      // accordions on one page expand from it without colliding.
      expect(accordion.slots?.children?.defaultBlock).toEqual([
        { type: ACCORDION_ITEM_BLOCK },
      ]);
    });

    it("starts with one where a row starts with two", () => {
      // A row of one is a box and `core/box` exists, so one column would be a
      // degenerate spelling of a block already available. An accordion of one
      // is not a spelling of anything: a lone section cannot stand on a page,
      // which the parent rule above states, so one section is a finished
      // document rather than half of one.
      expect(accordion.slots?.children?.defaultBlock).toHaveLength(1);
      expect(accordionItem.parent).toEqual([ACCORDION_BLOCK]);
    });

    it("gives the SECTION no default of its own", () => {
      // The child half is unrestricted — a section holds whatever a section
      // holds — so nothing about it says what it should start with.
      expect(accordionItem.slots?.children?.defaultBlock).toBeUndefined();
      expect(accordionItem.slots?.children?.allow).toBeUndefined();
    });
  });

  it("is registered, parent before child", () => {
    // A resolver built by iterating `coreBlocks` should meet the group first,
    // which is the ordering the columns pair records and this one follows.
    const names = coreBlocks.map(block => block.name);
    expect(names).toContain(ACCORDION_BLOCK);
    expect(names).toContain(ACCORDION_ITEM_BLOCK);
    expect(names.indexOf(ACCORDION_BLOCK)).toBeLessThan(
      names.indexOf(ACCORDION_ITEM_BLOCK)
    );
  });

  it("renders a native <details> whose body comes from the SLOT", () => {
    // The property that separates this from the block it replaces. The older
    // page-builder stored section bodies as strings and ran them through a
    // Markdown pass, so no block could live inside one.
    const out = accordionItem.render?.(args({ title: "T", open: false }));
    const el = out as { type: string; props: Record<string, unknown> };

    expect(el.type).toBe("details");
    expect(el.props.className).toBe("cls");
    // The slot's output is placed as a child, not a prop-derived string.
    expect(JSON.stringify(el.props.children)).toContain("BODY");
  });

  it("honours `open`, so a section can start expanded", () => {
    const closed = accordionItem.render?.(args({ title: "T", open: false }));
    const open = accordionItem.render?.(args({ title: "T", open: true }));

    expect((closed as { props: { open: boolean } }).props.open).toBe(false);
    expect((open as { props: { open: boolean } }).props.open).toBe(true);
  });

  it("survives a stored title that is not a string", () => {
    // Validation asks only that props be an object, so the type states what an
    // author may write and the document states what is stored. A stored object
    // reaching React as a child throws and takes the page with it.
    const out = accordionItem.render?.(args({ title: { a: 1 }, open: false }));

    expect(() => JSON.stringify(out)).not.toThrow();
    expect(JSON.stringify(out)).not.toContain('"a":1');
  });

  it("separates sections with spacing, never a hardcoded divider colour", () => {
    // The spacing is the `space.stack` token, the space every container puts
    // between the blocks it holds.
    //
    // That the reference RESOLVES is proved against a rendered page in
    // `columns.test.tsx`. This asserts what this block declares.
    const declared = JSON.stringify(ACCORDION_BASE_STYLES);

    expect(declared).toContain('"$token":"space.stack"');
    // Must-differ: a raw length would pass the check above if the object
    // carried both, and would stop following the site's own spacing.
    expect(declared).not.toContain("1rem");
    // The older block drew its dividers with `var(--nx-color-border)` — the
    // ADMIN namespace, which this renderer never emits, so that rule resolves
    // to nothing on a published page while looking right in an admin preview.
    expect(declared).not.toContain("--nx-");
    expect(declared).not.toContain("border");
  });

  it("offers no `layout` support, since a <details> is not a flex container", () => {
    // Withheld by this block rather than by the engine: `layout` is a real
    // registered support, and granting it here sets the title beside the body.
    expect(ACCORDION_ITEM_SUPPORTS).not.toHaveProperty("layout");
    // Every key must be a STYLE CATALOG group — the registry refuses unknown
    // ones, which is what caught `visibility` copied from the older block.
    expect(ACCORDION_ITEM_SUPPORTS).not.toHaveProperty("visibility");
  });
});

/** The title's part class, which carries its typography reset. */
const TITLE_PART = blockPartClassName(ACCORDION_ITEM_BLOCK, "title");

describe("an accordion's titles and icon, on a rendered page", () => {
  /** An accordion of one section, with what the accordion is given. */
  const page = (
    accordionProps: Record<string, unknown>,
    body: unknown[] = []
  ): BlockDocument =>
    ({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "acc",
          type: ACCORDION_BLOCK,
          version: 1,
          props: { as: "div", contained: false, ...accordionProps },
          slots: {
            children: [
              {
                id: "s1",
                type: ACCORDION_ITEM_BLOCK,
                version: 1,
                props: { title: "What is included?", open: false },
                slots: { children: body },
              },
            ],
          },
        },
      ],
    }) as unknown as BlockDocument;
  const resolver = createBlockResolver([...coreBlocks]);
  const CONTEXT = {
    breakpoints: {
      viewport: [{ id: "base", label: "Desktop" }],
      container: [],
    },
  };
  const markup = (
    document: BlockDocument,
    spacingMode?: "classic" | "gaps"
  ): string =>
    renderToStaticMarkup(
      <PageRenderer
        document={document}
        blocks={resolver}
        styles={resolvePageStyles(
          document,
          undefined,
          { ...CONTEXT, ...(spacingMode === undefined ? {} : { spacingMode }) },
          resolver
        )}
      />
    );
  const summaryOf = (html: string): string =>
    /<summary>(.*?)<\/summary>/.exec(html)?.[1] ?? "";

  it("draws each title as the heading Titles as names, inside its summary", () => {
    expect(summaryOf(markup(page({ titlesAs: "h3" })))).toBe(
      `<span class="${DISCLOSURE_ICON_CLASS}" aria-hidden="true"></span><h3 class="${DISCLOSURE_TITLE_CLASS} ${TITLE_PART}">What is included?</h3>`
    );
  });

  it("draws a title as text by default, and for a level it does not offer", () => {
    for (const props of [{}, { titlesAs: "h1" }, { titlesAs: "div" }]) {
      expect(summaryOf(markup(page(props)))).toBe(
        `<span class="${DISCLOSURE_ICON_CLASS}" aria-hidden="true"></span><span class="${DISCLOSURE_TITLE_CLASS} ${TITLE_PART}">What is included?</span>`
      );
    }
  });

  it("gives a nested accordion its own titles, not its parent's", () => {
    const nested = {
      id: "inner",
      type: ACCORDION_BLOCK,
      version: 1,
      props: { as: "div", contained: false },
      slots: {
        children: [
          {
            id: "s2",
            type: ACCORDION_ITEM_BLOCK,
            version: 1,
            props: { title: "Inner", open: false },
            slots: { children: [] },
          },
        ],
      },
    };
    const html = markup(page({ titlesAs: "h2" }, [nested]));
    expect(html).toContain(
      `<h2 class="${DISCLOSURE_TITLE_CLASS} ${TITLE_PART}">What is included?</h2>`
    );
    expect(html).toContain(
      `<span class="${DISCLOSURE_TITLE_CLASS} ${TITLE_PART}">Inner</span>`
    );
  });

  it("draws a chevron after the title on a new site", () => {
    const html = markup(page({}));
    expect(html).toContain(`> details > summary > .${DISCLOSURE_ICON_CLASS}`);
    expect(html).toContain("list-style: none");
    expect(html).toContain("rotate(180deg)");
    expect(html).toContain("margin-inline-start: auto");
  });

  it("puts an icon chosen on a classic site after the title, as on a new one", () => {
    const chosen = {
      ...page({}),
      nodes: [
        {
          ...(page({}).nodes[0] as object),
          styles: { base: { base: { disclosureIcon: "chevron" } } },
        },
      ],
    } as unknown as BlockDocument;
    const html = markup(chosen, "classic");
    expect(html).toContain("rotate(180deg)");
    expect(html).toContain("margin-inline-start: auto");
  });

  it("keeps the browser's marker on a site built before icons were offered", () => {
    const html = markup(page({}), "classic");
    expect(html).toContain(`> details > summary > .${DISCLOSURE_ICON_CLASS}`);
    expect(html).not.toContain("list-style: none");
    expect(html).not.toContain("rotate(180deg)");
  });
});

describe("an accordion's title levels, as offered and as drawn", () => {
  const resolver = createBlockResolver([...coreBlocks]);
  const CONTEXT = {
    breakpoints: {
      viewport: [{ id: "base", label: "Desktop" }],
      container: [],
    },
  };
  const withTitles = (titlesAs: string, itemStyles?: unknown): BlockDocument =>
    ({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "acc",
          type: ACCORDION_BLOCK,
          version: 1,
          props: { as: "div", contained: false, titlesAs },
          slots: {
            children: [
              {
                id: "s1",
                type: ACCORDION_ITEM_BLOCK,
                version: 1,
                props: { title: "Q", open: false },
                ...(itemStyles === undefined ? {} : { styles: itemStyles }),
                slots: { children: [] },
              },
            ],
          },
        },
      ],
    }) as unknown as BlockDocument;
  const html = (document: BlockDocument) =>
    renderToStaticMarkup(
      <PageRenderer
        document={document}
        blocks={resolver}
        styles={resolvePageStyles(document, undefined, CONTEXT, resolver)}
      />
    );

  it("draws every level the select offers as that element", () => {
    const offered = accordion.props?.titlesAs?.options as string[];
    expect(offered.length).toBeGreaterThan(1);
    for (const level of offered) {
      const tag = level === "text" ? "span" : level;
      expect(html(withTitles(level))).toMatch(
        new RegExp(
          `<${tag} class="[^"]*${DISCLOSURE_TITLE_CLASS}[^"]*">Q</${tag}>`
        )
      );
    }
  });

  it("gives a heading title the section's own typography, not the site's heading look", () => {
    // The site's baseline styles h3 directly; the title resets it after, so
    // the item's weight and size (on <details>) reach it by inheritance.
    const out = html(
      withTitles("h3", {
        base: { base: { fontWeight: 400, fontSize: "1rem" } },
      })
    );
    const baseline = out.indexOf(":where(h3)");
    const reset = out.search(
      /accordion-item--title\)? \{[^}]*font-weight: inherit/
    );
    expect(baseline).toBeGreaterThan(-1);
    expect(reset).toBeGreaterThan(baseline);
    expect(out).toMatch(/accordion-item--title\)? \{[^}]*font-size: inherit/);
    expect(out).toMatch(
      /accordion-item--title\)? \{[^}]*margin-block-start: 0/
    );
  });
});
