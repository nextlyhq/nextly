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

import { coreBlocks } from "./index";
import { column } from "./column";
import { columns, COLUMN_BLOCK, COLUMNS_BLOCK } from "./columns";

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

    it("gives each seeded column a STABLE id across expansions", () => {
      // A template is expanded on read as well as on insert, and the id drives
      // the scoped class. A non-deterministic id renders differently on the
      // server and the client, so the page hydrates with the two disagreeing
      // about which rules apply. `normalizeLegacySlots` shipped exactly this
      // defect with `crypto.randomUUID()`.
      const first = (columns.slots?.children.template ?? []).map(n => n.id);
      const second = (columns.slots?.children.template ?? []).map(n => n.id);

      expect(second).toEqual(first);
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

  describe("layout is a default, not a rule", () => {
    it("carries the row layout as overridable baseStyles", () => {
      // `container.tsx` establishes that display is a style rather than a
      // block. A hardcoded row in the renderer would be the Elementor V4
      // padding complaint again: a default every project starts by removing.
      expect(columns.baseStyles?.base?.base).toEqual({ display: "flex" });
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
