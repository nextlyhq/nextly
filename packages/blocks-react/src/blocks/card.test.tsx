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
import { describe, expect, it } from "vitest";

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

  describe("the template", () => {
    it("is EMPTY, because nothing can mint per-instance ids yet", () => {
      // A seeded template needs its ids minted per INSTANCE: two cards expanded
      // from one literal template carry the same node ids, and the engine
      // reports `duplicate-node-id` on the second. Nothing reads
      // `SlotSpec.template`, so no expansion path exists to do that minting.
      //
      // A RATCHET: whoever adds an expander fails here and has to seed the card
      // deliberately rather than inheriting literal ids that were only ever
      // safe because nothing read them.
      expect(card.slots?.children.template).toEqual([]);
    });
  });

  describe("registration", () => {
    it("ships in the core library under the name its tests use", () => {
      expect(card.name).toBe(CARD_BLOCK);
      expect(coreBlocks.map(block => block.name)).toContain(CARD_BLOCK);
    });
  });
});
