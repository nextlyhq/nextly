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
      },
      {
        id: "hx-text-tall",
        type: "core/text",
        version: 1,
        props: {
          text: "A deliberately tall block, so the blocks above and below it differ in height. Ranking a drop by distance to a zone's MIDDLE puts the switch boundary at each child's centre whatever the children's sizes are, which is exactly what goes wrong once adjacent blocks differ — so the fixture has to contain that difference or the rule under test is never exercised.",
        },
      },
      // A hairline. Any rule that reads a block's height as a threshold makes
      // this one impossible to drop beside.
      { id: "hx-divider", type: "core/divider", version: 1, props: {} },
      {
        id: "hx-text-short",
        type: "core/text",
        version: 1,
        props: { text: "Short." },
      },
      // No props at all by declaration: the spacer's height comes from the
      // style system (`supports.dimensions`), which is the other end of the
      // same problem as the divider — a block whose size is authored, with no
      // floor a drop rule could rely on.
      { id: "hx-spacer", type: "core/spacer", version: 1, props: {} },
      {
        id: "hx-text-last",
        type: "core/text",
        version: 1,
        props: {
          text: "The last sibling at the root, so a drop AFTER the final child is reachable and distinguishable from a drop into nothing.",
        },
      },
    ],
  };
}
