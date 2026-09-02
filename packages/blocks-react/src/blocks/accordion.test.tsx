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
import { describe, expect, it } from "vitest";

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
    // The divider reasoning below is unchanged and was right. What changed is
    // the SPACING: this required `space.4`, and a token resolves to nothing.
    //
    // `defaultSiteTokens()` guarantees nothing today — `compileSiteSheet` has
    // zero consumers outside `blocks-engine` and `--site-` appears in no source
    // file outside it, so `gap: { $token: "space.4" }` compiled to
    // `var(--site-space-4)`, nothing defined it, and the gap fell back to
    // `normal`: zero for a grid. The sections touched, which is precisely the
    // separation this test exists to guarantee.
    const declared = JSON.stringify(ACCORDION_BASE_STYLES);

    expect(declared).toContain("1rem");
    expect(declared).not.toContain("$token");
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
