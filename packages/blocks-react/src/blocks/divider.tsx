/**
 * `core/divider` — a thematic break.
 *
 * An `<hr>` rather than a styled empty div, because the break is part of the
 * content's meaning: it separates one topic from the next, and the element says
 * so to a reader who cannot see the line. A divider used purely for decoration
 * should be a `core/spacer` with a border instead.
 *
 * @module blocks/divider
 */
import { defineBlock } from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";

import type { BlockRenderArgs, PageContext } from "../context";

import { CONTENT } from "./categories";

export type DividerProps = Record<string, never>;

export function renderDivider({
  className,
}: BlockRenderArgs<DividerProps>): ReactElement {
  return <hr className={className} />;
}

/**
 * The rule itself, and the air around it.
 *
 * A user agent draws `<hr>` with an inset 3D border that no design system wants
 * and a reset removes entirely — so the element is either wrong or invisible
 * depending on the host. All four sides are stated so neither outcome survives:
 * three at zero, one hairline in the border token, which is a token because it
 * is a COLOUR and a literal would be wrong in one of the two themes.
 */
const DIVIDER_BASE_STYLES = {
  base: {
    base: {
      margin: { blockStart: "1.5em", blockEnd: "1.5em" },
      border: {
        width: {
          blockStart: "1px",
          blockEnd: "0",
          inlineStart: "0",
          inlineEnd: "0",
        },
        style: "solid",
        color: { $token: "color.border" },
      },
    },
  },
} as const;

// Defined against the ENGINE's `defineBlock`, not the plugin SDK's: the engine
// declares the contract and the SDK re-exports it for third parties. The
// context is named rather than augmented, so a block compiled against the
// published types is typed the same as one compiled here. See `./index.ts`.
export const divider = defineBlock<DividerProps, PageContext>({
  name: "core/divider",
  version: 1,
  description:
    "A thematic break between sections, announced as a separator rather than drawn as a decorative line.",
  // Palette metadata. The category is imported rather than spelled here so
  // nineteen blocks cannot drift into nineteen headings; keywords are what
  // let a search for a word the description never uses still find this.
  editor: {
    label: "Divider",
    icon: "divider",
    category: CONTENT,
    keywords: ["hr", "rule", "separator", "break"],
  },
  props: {},
  defaultProps: {},
  example: { props: {} },
  supports: {
    border: true,
    color: true,
    spacing: true,
    dimensions: true,
    effects: true,
  },
  baseStyles: DIVIDER_BASE_STYLES,
  render: renderDivider,
});
