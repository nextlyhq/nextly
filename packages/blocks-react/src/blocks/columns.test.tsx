/**
 * What makes `core/columns` and `core/column` worth being two blocks.
 *
 * Rendering proves nothing here: both delegate to `renderContainer`, so a test
 * that asserts they produce a `div` passes just as well on a `core/box` and
 * would keep passing if the pair were deleted and aliased. The properties that
 * SEPARATE this pair from a box are the nesting rule's two halves and the
 * identity the template gives each column, so those are what is asserted.
 */
import { describe, expect, it } from "vitest";

import { column, COLUMN_BLOCK, COLUMNS_BLOCK } from "./column";
import { columns, TEMPLATE_PLACEHOLDER_ID } from "./columns";
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

  describe("the template", () => {
    it("starts a row with two columns, each of the column type", () => {
      const seeded = columns.slots?.children.template ?? [];

      expect(seeded).toHaveLength(2);
      expect(seeded.map(node => node.type)).toEqual([
        COLUMN_BLOCK,
        COLUMN_BLOCK,
      ]);
    });

    it("gives each seeded column a DISTINCT id", () => {
      // The whole reason the pair exists. Identical ids would collapse both
      // columns onto one scoped CSS class, so styling one would style both —
      // the anonymous-flex-child problem with extra steps, and invisible to a
      // test that only counted the children.
      const ids = (columns.slots?.children.template ?? []).map(node => node.id);

      expect(new Set(ids).size).toBe(ids.length);
    });

    it("marks every seeded id as a PLACEHOLDER", () => {
      // A template describes what to create, not a thing that exists. Two rows
      // on one page seeded from the same literal ids collide, and the engine
      // reports `duplicate-node-id` on the second — so an expansion path must
      // mint a fresh id per node per instance. Asserting the prefix is what
      // lets a future consumer assert these never reach a stored document.
      for (const node of columns.slots?.children.template ?? []) {
        expect(node.id.startsWith(TEMPLATE_PLACEHOLDER_ID)).toBe(true);
      }
    });

    it("seeds columns at the version the column block DECLARES", () => {
      // Restating the version here would let a row seed columns in a schema
      // state the block no longer declares, so a row-seeded column and a
      // directly-inserted one would start differently with nothing reporting
      // it. Asserting equality against the definition is what couples them.
      for (const node of columns.slots?.children.template ?? []) {
        expect(node.version).toBe(column.version);
      }
    });

    it("seeds columns with the column block's OWN defaults", () => {
      // Same divergence one field over. `defaultProps` is the single
      // declaration; the template must not carry a second copy of it.
      for (const node of columns.slots?.children.template ?? []) {
        expect(node.props).toEqual(column.defaultProps);
      }
    });
  });

  describe("no dead default styles", () => {
    it("declares no baseStyles, because nothing would deliver them", () => {
      // `baseStyles` is declared on `BlockDefinition` and read by NOTHING —
      // zero non-test consumers in the repository — and `blocks-react` ships
      // no stylesheet. A declaration here would compile to nothing and render
      // as nothing while reading in review as a working default, which is the
      // capability-that-reaches-nothing shape this package already carries
      // seven instances of.
      //
      // This assertion is a RATCHET, not a preference: when a delivery path
      // exists, this test fails and forces whoever adds it to state the
      // default deliberately rather than reviving a declaration that was dead
      // when it was written.
      expect(columns.baseStyles).toBeUndefined();
      expect(column.baseStyles).toBeUndefined();
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
