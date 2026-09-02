/**
 * What makes `core/columns` and `core/column` worth being two blocks.
 *
 * Rendering proves nothing here: both delegate to `renderContainer`, so a test
 * that asserts they produce a `div` passes just as well on a `core/box` and
 * would keep passing if the pair were deleted and aliased. The properties that
 * SEPARATE this pair from a box are the nesting rule's two halves and the
 * identity the template gives each column, so those are what is asserted.
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import type { BlockResolver } from "../resolver";
import { resolvePageStyles } from "../styles";

import { column, COLUMN_BLOCK, COLUMNS_BLOCK } from "./column";
import { columns } from "./columns";
import { box } from "./box";
import { coreBlocks } from "./index";
import { section } from "./section";

describe("the columns pair", () => {
  describe("the nesting rule, both halves", () => {
    it("restricts the row's slot to columns only", () => {
      // The PARENT half. Without it a row accepts any block and the column is
      // decoration; `canDrop`'s not-allowed-in-slot reason also becomes
      // unreachable, which is how it went untested before #795.
      expect(columns.slots?.children.allow).toEqual([COLUMN_BLOCK]);
    });

    it("confines a column to a row", () => {
      // The CHILD half, and the one the editor needs. `block.ts` is explicit
      // that neither half implies the other, so asserting only the allow-list
      // would leave a column insertable at the page root — a container that
      // looks like a box and is governed by a row that is not there.
      expect(column.parent).toEqual([COLUMNS_BLOCK]);
    });

    it("does NOT restrict what a column may hold", () => {
      // A row says what may be a COLUMN. It says nothing about what a column
      // holds, and confusing the two would make the pair useless for layout.
      expect(column.slots?.children.allow).toBeUndefined();
    });
  });

  describe("what a fresh row starts with", () => {
    it("declares two columns, by TYPE rather than as stored nodes", () => {
      // The declaration names a type and carries no id, which is what makes it
      // safe to expand more than once: `expandSlotDefaults` mints a fresh id
      // per child per instance, so two rows on a page cannot repeat each
      // other's ids. A stored node list would carry literal ids and collide on
      // `duplicate-node-id` the second time it was used.
      expect(columns.slots?.children.defaultBlock).toEqual([
        { type: COLUMN_BLOCK },
        { type: COLUMN_BLOCK },
      ]);
    });

    it("starts with two, because a row of one is a box", () => {
      // The count lives in the declaration above and nowhere else — it was
      // previously also spelled as an `INITIAL_COLUMNS` constant, which was a
      // second answer to one question. Read it from the list.
      expect(columns.slots?.children.defaultBlock).toHaveLength(2);
    });
  });

  describe("the default layout REACHES the compiled stylesheet", () => {
    // Asserting `baseStyles` as an object proves only that a declaration was
    // written. The compiler REJECTS properties absent from `STYLE_CATALOG`
    // rather than passing them through, so a declaration naming one compiles
    // to nothing while the object assertion stays green — which is exactly
    // how an unsupported `flex` shipped here and had to be withdrawn. These
    // assert the emitted CSS.
    function compiledCss(): string {
      const doc: BlockDocument = {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "row",
            type: COLUMNS_BLOCK,
            version: 1,
            props: {},
            slots: {
              children: [
                { id: "c1", type: COLUMN_BLOCK, version: 1, props: {} },
              ],
            },
          },
        ],
      };
      const resolver: BlockResolver = {
        get: (name: string) =>
          coreBlocks.find(block => block.name === name) as never,
      };
      // A context is REQUIRED: `resolvePageStyles` compiles only under
      // `if (styleContext)`, and returns empty css otherwise — which is how
      // the first version of this test reported a working default as missing.
      //
      // `blockBases` is deliberately OMITTED so `blockBasesFor` derives it
      // from the definitions. Supplying it would hand the compiler the answer
      // and assert this file's own literal instead of the block's declaration.
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

    it("emits the row as a grid with equal, wrapping tracks", () => {
      const css = compiledCss();

      expect(css).toContain("display: grid");
      // The track list is what makes columns share the row. Asserting only
      // `display:grid` passes on a grid with one implicit column, which looks
      // identical to the stacked <div>s this block exists to replace.
      expect(css).toContain("minmax(min(240px, 100%), 1fr)");
    });

    it("emits a GAP, so the columns do not touch", () => {
      /*
       * `gap` on a grid defaults to `normal`, which computes to zero — so the
       * one block whose whole purpose is side-by-side content rendered its
       * columns flush against each other. Measured on a published page before
       * this: three tracks of 427px with nothing between them.
       *
       * Asserted on the compiled CSS rather than on the declaration, because a
       * declaration the catalog does not carry is dropped silently and would
       * leave a property that reads correct in the source and never reaches a
       * page.
       */
      const css = compiledCss();

      expect(css).toContain("gap: 1rem");
      // Must-differ: the row is still a grid, so this is about the gutter and
      // not about the layout having been replaced by something simpler.
      expect(css).toContain("display: grid");
    });

    it("emits the column's min-width so a long child cannot force overflow", () => {
      // Separate from the row assertion because it is a different node type
      // and a different failure: the row can size correctly while one
      // unbreakable child still pushes the page sideways.
      expect(compiledCss()).toContain("min-width: 0");
    });
  });

  describe("registration", () => {
    it("ships both halves, because one without the other is broken", () => {
      // A row whose column type is unregistered cannot expand its own
      // template; a column with no row can never be legally placed. Shipping
      // either alone is worse than shipping neither.
      const names = coreBlocks.map(block => block.name);

      expect(names).toContain(COLUMNS_BLOCK);
      expect(names).toContain(COLUMN_BLOCK);
    });

    it("names the row's allowed type as a type that actually exists", () => {
      // An allow-list naming a block nobody registered refuses everything, and
      // reads in review exactly like one that works.
      const names = coreBlocks.map(block => block.name);

      for (const allowed of columns.slots?.children.allow ?? []) {
        expect(names).toContain(allowed);
      }
    });
  });

  describe("relationships, never capabilities", () => {
    it("shares ONE support declaration with every container preset", () => {
      // The pair promises to differ from a box in relationships, never in
      // capabilities. Four parallel supports lists would let a later addition
      // reach some presets and not others, silently giving one container
      // different editor controls from the rest — and each list would read as
      // correct on its own. Asserting identity against `box` is what couples
      // them; asserting the VALUES would pass on four copies that agree today.
      expect(columns.supports).toBe(box.supports);
      expect(column.supports).toBe(box.supports);
      expect(section.supports).toBe(box.supports);
    });

    it("shares the container implementation rather than forking it", () => {
      // The pair must differ from a box in RELATIONSHIPS, never in
      // capabilities — that is the Elementor V3 Section/Column failure
      // `container.tsx` cites. Two blocks pointing at one render function is
      // what keeps that true.
      expect(column.render).toBe(columns.render);
    });
  });
});
