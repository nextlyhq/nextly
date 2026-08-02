/**
 * The shared container implementation behind `core/section` and `core/box`.
 *
 * One implementation with presets over it, rather than one block per layout
 * shape. Bricks is the layout model practitioners praise most, and the property
 * they praise is that its structure elements are "divs with presets" — not
 * elements with different capabilities. Elementor arrived at the opposite from
 * both directions: V3's rigid Section/Column needed a migration tool that broke
 * live sites, and V4 shipped Div and Flexbox as separate elements, which its
 * own community asks about ("the Flexbox widget is the Div widget with display
 * flex selected"). A preset carries no capability its sibling lacks, so neither
 * failure is reachable from here.
 *
 * **Zero default padding.** A hardcoded default is the single most-cited
 * complaint about Elementor V4, because every project then begins by removing
 * it. Spacing comes from the document or from a token, never from this file.
 *
 * @module blocks/library/container
 */
import type { BlockRenderArgs } from "@nextlyhq/plugin-sdk/blocks";
import type { ReactElement } from "react";

/** What both presets store. */
export interface ContainerProps {
  /**
   * The element rendered. A section is a landmark and a box is not, so this is
   * the one thing the presets genuinely differ on, and it stays a prop rather
   * than a hardcode so a preset can be re-pointed without a migration.
   */
  as?: "section" | "div" | "article" | "aside" | "header" | "footer" | "main";
  /**
   * Whether the content is held to the site's content width. The width itself
   * is a site setting rather than a per-instance value, so a site-wide change
   * moves every page instead of none of them.
   */
  contained?: boolean;
}

/** The tags a container may render, as a set the validator can check against. */
export const CONTAINER_TAGS = [
  "section",
  "div",
  "article",
  "aside",
  "header",
  "footer",
  "main",
] as const;

/**
 * The class that opts an element into the site's content width.
 *
 * Named rather than inlined as a style so the width lives in one place a site
 * can change. Gutenberg has the right idea in `theme.json`'s `contentSize`;
 * what it lacks is per-breakpoint control, which the style catalog supplies
 * separately.
 */
export const CONTENT_WIDTH_CLASS = "nx-pb-contained";

/**
 * Render a container preset.
 *
 * The block places `className` on its own root and renders no wrapper around
 * it. Elementor's forced wrapper divs were bad enough to warrant a "Widget DOM
 * Optimization" program; a single-element contract makes that class of problem
 * unreachable, and it is what lets the compiler target one selector per node.
 */
export function renderContainer({
  props,
  slots,
  className,
}: BlockRenderArgs<ContainerProps>): ReactElement {
  const Tag = props.as ?? "div";
  const classes =
    props.contained === true
      ? `${className} ${CONTENT_WIDTH_CLASS}`
      : className;
  return <Tag className={classes}>{slots.children as ReactElement}</Tag>;
}
