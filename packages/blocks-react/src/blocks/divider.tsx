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
  render: renderDivider,
});
