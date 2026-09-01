/**
 * `core/spacer` — deliberate empty space.
 *
 * Hidden from assistive technology, because it carries no content: a screen
 * reader announcing an empty element is noise, and the space it creates is
 * visual only.
 *
 * The height is a style rather than a prop. Spacing is per-breakpoint in this
 * system, and a stored number could only ever be one value, so a spacer sized
 * by a prop would be the one element on the page that cannot respond to the
 * viewport. The block exists to give that style something to attach to.
 *
 * @module blocks/spacer
 */
import { defineBlock } from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";

import type { BlockRenderArgs, PageContext } from "../context";

import { LAYOUT } from "./categories";

export type SpacerProps = Record<string, never>;

export function renderSpacer({
  className,
}: BlockRenderArgs<SpacerProps>): ReactElement {
  return <div className={className} aria-hidden="true" />;
}

/**
 * A starting height, so the block exists before it is styled.
 *
 * A spacer renders an empty `<div>`, which is zero-high with nothing declared —
 * so inserting one produced no space and nothing to select, and the block read
 * as broken rather than as unstyled. This is a DEFAULT rather than a fixed size:
 * height stays a style, per this module's note on why it is not a prop, so any
 * breakpoint may override it.
 */
const SPACER_BASE_STYLES = {
  base: {
    base: {
      height: "2rem",
    },
  },
} as const;

// Defined against the ENGINE's `defineBlock`, not the plugin SDK's: the engine
// declares the contract and the SDK re-exports it for third parties. The
// context is named rather than augmented, so a block compiled against the
// published types is typed the same as one compiled here. See `./index.ts`.
export const spacer = defineBlock<SpacerProps, PageContext>({
  name: "core/spacer",
  version: 1,
  description:
    "Deliberate empty space, sized by the style system so it can differ per breakpoint. Hidden from assistive technology.",
  // Palette metadata. The category is imported rather than spelled here so
  // nineteen blocks cannot drift into nineteen headings; keywords are what
  // let a search for a word the description never uses still find this.
  editor: {
    label: "Spacer",
    icon: "spacer",
    category: LAYOUT,
    keywords: ["gap", "space", "whitespace"],
  },
  props: {},
  defaultProps: {},
  example: { props: {} },
  supports: { dimensions: true, spacing: true },
  baseStyles: SPACER_BASE_STYLES,
  render: renderSpacer,
});
