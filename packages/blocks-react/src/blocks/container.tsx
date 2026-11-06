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
 * **No padding of its own here.** A hardcoded default is the single most-cited
 * complaint about Elementor V4, because every project then begins by removing
 * it, and nested containers inherit the problem. A preset that pads (Section,
 * Card) reads a site token in its own `baseStyles`; Box and Column stay at
 * zero. What every preset shares is {@link CONTAINER_CHILD_GAP}: the space
 * between the blocks it holds, which belongs to the container rather than to
 * a margin on each child.
 *
 * @module blocks/library/container
 */

import { CONTENT_WIDTH_CLASS } from "@nextlyhq/blocks-engine";
import type { ContentModel, TokenRef } from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";

import type { BlockRenderArgs } from "../context";

import { url } from "./props";

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
  /**
   * Where the whole block links to. Only the presets that declare it (Box and
   * Card) render it: linked, the root element is an `<a>` instead of the `as`
   * tag, which is what makes the block interactive content and refuses
   * anything interactive inside it.
   */
  link?: string;
}

/**
 * The space a container puts between the blocks it holds, as a site token.
 *
 * One value for every flow container, so a site changing `space.stack` moves
 * the rhythm of every section, box, card and column at once. The compiler
 * writes it as a top margin on each child after the first, and as `gap` once
 * an author makes the container flex or grid.
 */
export const CONTAINER_CHILD_GAP: TokenRef = { $token: "space.stack" };

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

/** One of the tags a container may render. */
export type ContainerTag = (typeof CONTAINER_TAGS)[number];

/**
 * The class that opts an element into the site's content width.
 *
 * Named rather than inlined as a style so the width lives in one place a site
 * can change. Gutenberg has the right idea in `theme.json`'s `contentSize`;
 * what it lacks is per-breakpoint control, which the style catalog supplies
 * separately.
 *
 * Re-exported from the engine rather than spelled again here. The rule behind
 * it is emitted by the site stylesheet, which the engine compiles, and a
 * selector written there against a literal written here is one contract with
 * two definitions — free to drift, and drifting silently, because a rule whose
 * selector matches nothing simply does not apply.
 */
export { CONTENT_WIDTH_CLASS };

/**
 * The style capabilities every container preset opts into.
 *
 * Declared ONCE and shared, because a preset differs from its siblings in what
 * it starts as, never in what it can be told to do — the property this file's
 * header argues for. Four parallel copies of this list would let a later
 * addition or removal reach some presets and not others, silently giving one
 * container different editor controls and accepted styles from the rest. The
 * divergence would be invisible: each list reads as correct on its own.
 */
export const CONTAINER_SUPPORTS = {
  spacing: true,
  layout: true,
  dimensions: true,
  background: true,
  border: true,
  effects: true,
  position: true,
  container: true,
} as const;

/** Whether a stored value is a tag a container may render. */
function isContainerTag(value: unknown): value is ContainerTag {
  return CONTAINER_TAGS.some(tag => tag === value);
}

/**
 * What a container preset is as HTML content, from the tag it renders.
 *
 * A `div` is plain flow content. Any other tag refuses a `main` beneath it,
 * because HTML's main element may only sit inside plain containers; a header
 * or a footer also refuses another header or footer, and a main refuses a
 * second main.
 */
export function containerContentModel(props: ContainerProps): ContentModel {
  const tag = isContainerTag(props.as) ? props.as : "div";
  switch (tag) {
    case "div":
      return { is: ["flow"] };
    case "header":
    case "footer":
      return {
        is: ["flow", tag],
        accepts: { without: ["header", "footer", "main"] },
      };
    case "main":
      return { is: ["flow", "main"], accepts: { without: ["main"] } };
    default:
      return { is: ["flow"], accepts: { without: ["main"] } };
  }
}

/**
 * The link a linkable preset renders, or undefined when it renders none.
 * The renderer and the content model both ask this, so a link the renderer
 * would drop never makes the block count as interactive, and the reverse.
 */
function linkOf(props: ContainerProps): string | undefined {
  return url(props.link);
}

/**
 * A linkable preset's content model: an `<a>` while linked, which is
 * interactive and refuses anything interactive (and a main) beneath it;
 * otherwise what its tag makes it.
 */
export function linkableContentModel(props: ContainerProps): ContentModel {
  if (linkOf(props) === undefined) return containerContentModel(props);
  return {
    is: ["flow", "interactive"],
    accepts: { without: ["interactive", "main"] },
  };
}

/**
 * The base style a linkable preset carries: `display: block`, so a linked
 * block's `<a>` root lays out as the box it was rather than as inline text. A
 * `div` is already a block, so the declaration changes nothing until the link
 * is on, and a display the author sets on the node still wins over it.
 */
export const LINKABLE_BASE_STYLE = { display: "block" } as const;

/** Render a linkable preset: an `<a>` while linked, its tag otherwise. */
export function renderLinkableContainer(
  args: BlockRenderArgs<ContainerProps>
): ReactElement {
  const href = linkOf(args.props);
  if (href === undefined) return renderContainer(args);
  const classes =
    args.props.contained === true
      ? `${args.className} ${CONTENT_WIDTH_CLASS}`
      : args.className;
  return (
    <a className={classes} href={href}>
      {args.renderSlot("children")}
    </a>
  );
}

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
  renderSlot,
  className,
}: BlockRenderArgs<ContainerProps>): ReactElement {
  // Checked rather than trusted. The type says what an author may write; the
  // document says what is actually stored, and validation only asks that props
  // be an object. A stored `as: "img"` would reach React as a void element
  // handed children and throw, taking the page with it, so an unknown tag falls
  // back to the one every container can safely be.
  const Tag = isContainerTag(props.as) ? props.as : "div";
  const classes =
    props.contained === true
      ? `${className} ${CONTENT_WIDTH_CLASS}`
      : className;
  return <Tag className={classes}>{renderSlot("children")}</Tag>;
}
