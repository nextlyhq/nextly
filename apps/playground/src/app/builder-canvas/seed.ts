import type { BlockDocument } from "@nextlyhq/blocks-engine";

/**
 * The document the canvas harness opens with.
 *
 * Hand-authored rather than generated, because every property the acceptance
 * suite checks is a statement about SPECIFIC neighbours: which region owns a
 * point, where a switch boundary falls between two blocks, whether an indicator
 * leads the pointer into the gap between them. A generated tree makes those
 * assertions depend on the generator, and a change to it would move the
 * boundaries the tests pin without any test naming the change.
 *
 * Ids are literal and stable for the same reason. The suite addresses nodes by
 * id, so a fresh uuid per render would make every selector a guess.
 *
 * The MIX of heights is the point of the fixture, not decoration. `core/divider`
 * renders a hairline and `core/spacer` takes its height from the style system
 * with no lower bound — the two shapes that refuted every size-based drop rule
 * this engine was built to replace, in the author's own words: "any minimum size
 * excludes some authored block and makes it impossible to drop beside." A
 * fixture of uniformly-sized text blocks would let a height-thresholded
 * implementation pass the suite it is supposed to fail.
 *
 * `version` is required on every node and is the block definition's schema
 * version — 1 for every core block today. Forgiving rendering and the manifest
 * version stamp both read it unconditionally.
 */
/**
 * The gap between siblings, in CSS pixels.
 *
 * Real gaps are not decoration. Acceptance property 6 is "the indicator leads
 * the pointer into a 6px gap" and property 4 is "zero layout shift when drop
 * zones appear" — neither is expressible on a document whose blocks are flush,
 * and an unstyled document is exactly that: every block's top equals the
 * previous block's bottom, to the pixel.
 */
const GAP_PX = "24px";

/**
 * Applied to every sibling.
 *
 * `margin: { blockEnd }`, not `marginBottom`. The catalog is LOGICAL and
 * structured (`catalog.ts:282-285`, `logicalSides`); a physical `marginBottom`
 * is rejected outright as `unknown-style-property`. Measured by compiling this
 * document rather than guessed.
 */
const GAP = { base: { base: { margin: { blockEnd: GAP_PX } } } } as const;

export function canvasHarnessDocument(): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      // `level` is a select over HEADING_LEVELS and its values are strings:
      // `defaultProps` is `{ text: "", level: "h2" }`, not a number.
      {
        id: "hx-heading",
        type: "core/heading",
        version: 1,
        props: { text: "Canvas harness", level: "h1" },
        styles: GAP,
      },
      {
        id: "hx-text-tall",
        type: "core/text",
        version: 1,
        props: {
          text: "A deliberately tall block, so the blocks above and below it differ in height. Ranking a drop by distance to a zone's MIDDLE puts the switch boundary at each child's centre whatever the children's sizes are, which is exactly what goes wrong once adjacent blocks differ — so the fixture has to contain that difference or the rule under test is never exercised.",
        },
        styles: GAP,
      },
      // A hairline. Any rule that reads a block's height as a threshold makes
      // this one impossible to drop beside.
      {
        id: "hx-divider",
        type: "core/divider",
        version: 1,
        props: {},
        styles: GAP,
      },
      {
        id: "hx-text-short",
        type: "core/text",
        version: 1,
        props: { text: "Short." },
        styles: GAP,
      },
      /*
       * A NESTED container, so the tree has more than one depth.
       *
       * Collision resolving "by tree depth" cannot be distinguished from no
       * rule at all on a flat document: every point resolves at the root, and a
       * canvas that ignored depth entirely would pass. The section holds a text
       * block so a pointer over that text is simultaneously over the section
       * and over the root, which is the ambiguity the rule exists to settle.
       */
      {
        id: "hx-section",
        type: "core/section",
        version: 1,
        props: { as: "section", contained: true },
        styles: GAP,
        slots: {
          children: [
            {
              id: "hx-nested-text",
              type: "core/text",
              version: 1,
              props: {
                text: "Nested inside a section, so a point here is over two containers at once.",
              },
            },
          ],
        },
      },
      /*
       * A container with a RESTRICTIVE slot: `core/columns` accepts only
       * `core/column`.
       *
       * An invalid-target state shown nowhere passes the same assertion as one
       * shown everywhere, so the suite needs a container that refuses something
       * and accepts something else. This is the only pair in the core set where
       * the refusal is structural rather than a matter of taste.
       */
      {
        id: "hx-columns",
        type: "core/columns",
        version: 1,
        props: {},
        // Taller than the column inside it, ON PURPOSE. `core/column` accepts a
        // text block, so a pointer anywhere over the column resolves to the
        // COLUMN's slot and never meets the restriction. The band below the
        // column is inside `core/columns` — whose slot accepts only
        // `core/column` — and is the only place the refusal is reachable.
        styles: {
          base: {
            base: {
              padding: { blockEnd: "120px" },
              margin: { blockEnd: GAP_PX },
            },
          },
        },
        slots: {
          children: [
            {
              id: "hx-column",
              type: "core/column",
              version: 1,
              props: { as: "div" },
              // An EMPTY column renders zero pixels tall, and a region with no
              // height contains no pointer — measured: top 337, height 0. The
              // refusal this container exists to demonstrate is unreachable
              // until something gives it a box.
              slots: {
                children: [
                  {
                    id: "hx-column-text",
                    type: "core/text",
                    version: 1,
                    props: { text: "Inside a column." },
                  },
                ],
              },
            },
          ],
        },
      },
      {
        id: "hx-text-last",
        type: "core/text",
        version: 1,
        props: {
          text: "The last sibling at the root, so a drop AFTER the final child is reachable and distinguishable from a drop into nothing.",
        },
        styles: GAP,
      },
      // LAST on purpose. It is 900px tall so the canvas overflows and autoscroll
      // is askable — placed anywhere earlier it pushes the nested containers
      // below the fold, where a pointer cannot reach them and a drop over a
      // nested block resolves to nothing at all.
      // No props at all by declaration: the spacer's height comes from the
      // style system (`supports.dimensions`), which is the other end of the
      // same problem as the divider — a block whose size is authored, with no
      // floor a drop rule could rely on.
      {
        id: "hx-spacer",
        type: "core/spacer",
        version: 1,
        props: {},
        // Its height is AUTHORED, with no floor a drop rule could lean on.
        // Unstyled it renders zero pixels tall and shares a `top` with the
        // block after it, which makes it unhittable and silently deletes the
        // case this fixture exists to cover.
        // Tall enough that the document OVERFLOWS its box. Measured before:
        // scrollHeight equalled clientHeight, so "it did not autoscroll" and
        // "there was nowhere to scroll" were the same observation.
        styles: {
          base: { base: { height: "900px", margin: { blockEnd: GAP_PX } } },
        },
      },
    ],
  };
}
