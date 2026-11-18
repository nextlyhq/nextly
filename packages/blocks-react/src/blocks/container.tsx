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

import {
  CONTENT_WIDTH_CLASS,
  CONTENT_WIDTH_PROPERTY,
} from "@nextlyhq/blocks-engine";
import type {
  ContentModel,
  PropSchema,
  RemotePatternInput,
  TokenRef,
} from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";

import type { BlockRenderArgs, PageContext } from "../context";
import { childImageContext } from "../image-slot";
import {
  backgroundRevision,
  contentKey,
  firstBackgroundSource,
  sizedFirstBackground,
} from "../image-sources";

import {
  canLink,
  LINK_PROPS,
  linkFor,
  readClaimOf,
  relFor,
  text,
  url,
  type LinkAttributes,
} from "./props";

/** What both presets store. */
export interface ContainerProps {
  /**
   * The element rendered. A section is a landmark and a box is not, so this is
   * the one thing the presets genuinely differ on, and it stays a prop rather
   * than a hardcode so a preset can be re-pointed without a migration.
   */
  as?: "section" | "div" | "article" | "aside" | "header" | "footer" | "main";
  /**
   * Whether the content is held to a content width (Boxed) or runs edge to
   * edge (Full width). The block's background runs edge to edge either way.
   */
  contained?: boolean;
  /**
   * The width this container holds its content to while it is Boxed, in
   * place of the site's: a length or a percentage (`"1400px"`), or a site
   * variable. Left out, the site's content width, so a site-wide change still
   * moves every container that states none. The page compile writes it on
   * the container alone: a Boxed container inside this one boxes to the
   * site's width.
   */
  contentWidth?: string | TokenRef;
  /**
   * Where the whole block links to. Only the presets that declare it (Box and
   * Card) render it: linked, the root element is an `<a>` instead of the `as`
   * tag, which is what makes the block interactive content and refuses
   * anything interactive inside it.
   */
  link?: string;
  /** The entry a linkable preset links to, with `entryId`; beats `link`. */
  entryCollection?: string;
  /** The linked entry's id, used with `entryCollection`. */
  entryId?: string;
  /** How a linkable preset's link opens: this tab, or a new one. */
  target?: "_self" | "_blank";
  /** A linkable preset's link relationship tokens (`nofollow`, …). */
  rel?: string;
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
 * A container's Content width settings, drawn in Style › Layout: whether its
 * content is Boxed or runs Full width, and the width it boxes to where it
 * states one of its own. Declared once and spread into every container's
 * props, for the reason {@link CONTAINER_SUPPORTS} is: nine copies would let a
 * label or a place drift on some containers and not others.
 *
 * Settings rather than styles. A style has a device, a state and a shared
 * style it can come from; whether a container is boxed has none of those, so
 * it is the block's own, and one value on every device.
 *
 * The width's key is the engine's `CONTENT_WIDTH_PROP`, which the page
 * compile reads; a test holds the two to one spelling.
 */
export const CONTENT_WIDTH_PROPS: {
  readonly contained: PropSchema;
  readonly contentWidth: PropSchema;
} = {
  contained: {
    label: "Content width",
    type: "checkbox",
    group: "style",
    section: "layout",
    code: `class="${CONTENT_WIDTH_CLASS}"`,
  },
  contentWidth: {
    label: "Width for this section",
    type: "length",
    group: "style",
    section: "layout",
    code: `${CONTENT_WIDTH_PROPERTY}: <width>`,
  },
};

/**
 * The root's classes with the content-width opt-in where the container is
 * Boxed. One function for every container, including the ones that render
 * their own root (Collection list, Entry content).
 */
export function withContentWidth(
  className: string,
  props: { readonly contained?: unknown }
): string {
  return props.contained === true
    ? `${className} ${CONTENT_WIDTH_CLASS}`
    : className;
}

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
  // A card or a panel often casts one: Style › Effects › Shadow.
  shadow: true,
  effects: true,
  position: true,
  container: true,
  // Style › Text: a colour and type set once on the container, which every
  // block inside inherits unless it sets its own. The page compile makes the
  // links inside take the colour too, while the site's Links row sets none.
  typography: true,
  color: true,
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
 * A linkable preset's link settings: where it links (`link`, an address, or
 * an entry), how it opens, and its relationship. Declared once, as
 * {@link CONTENT_WIDTH_PROPS} is, so Box and Card cannot drift apart in what
 * they store or where each setting is edited. The address keeps its stored
 * name, `link`; the entry, the new tab and the relationship are the names
 * every linking block stores them under (`LINK_PROPS`), which the editor's
 * link control groups and the renderer follows.
 *
 * Content › Link for where it goes and how it opens; the relationship is
 * HTML a visitor never reads, so Advanced › HTML.
 */
export function containerLinkProps(
  hint?: string
): Readonly<
  Record<"link" | "entryCollection" | "entryId" | "target" | "rel", PropSchema>
> {
  return {
    link: {
      label: "Link",
      role: "content",
      type: "url",
      section: "Link",
      ...(hint === undefined ? {} : { hint }),
    },
    entryCollection: { ...LINK_PROPS.entryCollection, section: "Link" },
    entryId: { ...LINK_PROPS.entryId, section: "Link" },
    target: { ...LINK_PROPS.target, section: "Link" },
    rel: { ...LINK_PROPS.rel, group: "advanced" },
  };
}

/** A linkable preset's link, read as every linking block reads one. */
function linkPropsOf(props: ContainerProps) {
  return {
    href: props.link,
    entryCollection: props.entryCollection,
    entryId: props.entryId,
    target: props.target,
    rel: props.rel,
  };
}

/**
 * Whether a linkable preset renders a link: an address `url` follows, or an
 * entry. The renderer and the content model both ask this, so a link the
 * renderer would drop never makes the block count as interactive, and the
 * reverse. An entry that then fails to resolve draws no link where
 * interactive content was allowed, which refuses nothing it should not.
 */
function isLinked(props: ContainerProps): boolean {
  return canLink(linkPropsOf(props));
}

/**
 * The element a container preset's root renders as: `a` for a linkable preset
 * while it is linked, else its tag, and `div` for a tag it may not render.
 * The render functions below draw it, and an editor asks it, through
 * `containerRootTag`, to say what the page will hold, so the two never
 * disagree; whether a preset is linked is `isLinked`'s answer, the one the
 * renderer and the content model use. Read from stored props, which may
 * hold anything.
 */
export function rootTagOf(
  props: ContainerProps,
  linkable: boolean
): ContainerTag | "a" {
  if (linkable && isLinked(props)) return "a";
  return isContainerTag(props.as) ? props.as : "div";
}

/**
 * A linkable preset's content model: an `<a>` while linked, which is
 * interactive and refuses anything interactive (and a main) beneath it;
 * otherwise what its tag makes it.
 */
export function linkableContentModel(props: ContainerProps): ContentModel {
  if (!isLinked(props)) return containerContentModel(props);
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

/**
 * The first section's background as copies sized to each device, where the
 * page sizes it (`image-sources`): one rule per device and one preload per
 * copy, both hoisted by React into the page's head, so nothing is added among
 * the container's children. Drawn on a published page only, where the route
 * offers the site's copies.
 */
async function SizedFirstBackground({
  page,
  node,
  className,
  patterns,
}: {
  page: PageContext;
  node: BlockRenderArgs<ContainerProps>["node"];
  className: string;
  patterns: readonly RemotePatternInput[] | undefined;
}): Promise<ReactElement | null> {
  const sized = await sizedFirstBackground(page, node, className, patterns);
  if (sized === undefined) return null;
  return (
    <>
      {sized.preloads.map(copy => (
        <link
          key={copy.href}
          rel="preload"
          as="image"
          href={copy.href}
          fetchPriority="high"
          {...(copy.media === undefined ? {} : { media: copy.media })}
        />
      ))}
      <style
        href={`nx-pb-sized-background-${contentKey(sized.css)}`}
        precedence="default"
      >
        {sized.css}
      </style>
    </>
  );
}

/**
 * The root's classes, with the one naming its sized background where the page
 * sizes it: the rules for that background match only while the root wears it.
 */
function withRevision(
  classes: string,
  { ctx, node }: BlockRenderArgs<ContainerProps>
): string {
  const revision = backgroundRevision(ctx, node);
  return revision === undefined ? classes : `${classes} ${revision}`;
}

/** The sized first background, or nothing where the page draws it as it is. */
function firstBackground({
  ctx,
  node,
  className,
  hostPolicy,
}: BlockRenderArgs<ContainerProps>): ReactElement | null {
  if (firstBackgroundSource(ctx, node) === undefined) return null;
  return (
    <SizedFirstBackground
      page={ctx}
      node={node}
      className={className}
      patterns={hostPolicy?.remotePatterns}
    />
  );
}

/**
 * Render a linkable preset: an `<a>` while linked, its tag otherwise. Where
 * it links is read as every linking block reads it: an entry beats a typed
 * address, and a new tab adds its `rel` safety tokens. Only a link to an
 * entry waits, for the entry's address; a typed one renders at once, as it
 * always did, so a page linking by address streams as it did before.
 */
export function renderLinkableContainer(
  args: BlockRenderArgs<ContainerProps>
): ReactElement | Promise<ReactElement> {
  const link = linkPropsOf(args.props);
  if (text(link.entryCollection) !== "" && text(link.entryId) !== "") {
    return linkFor(link, (collection, id) =>
      args.ctx.resolveEntryPath(collection, id, readClaimOf(args.node))
    ).then(resolved => drawLinked(args, resolved));
  }
  const href = url(link.href);
  const rel = relFor(link.target, link.rel);
  return drawLinked(
    args,
    href === undefined
      ? undefined
      : {
          href,
          ...(link.target === "_blank" ? { target: "_blank" as const } : {}),
          ...(rel === undefined ? {} : { rel }),
        }
  );
}

/** A linkable preset drawn with its link's attributes, or unlinked with none. */
function drawLinked(
  args: BlockRenderArgs<ContainerProps>,
  link: LinkAttributes | undefined
): ReactElement {
  if (link === undefined) return renderContainer(args);
  const classes = withRevision(
    withContentWidth(args.className, args.props),
    args
  );
  return (
    <a className={classes} {...link}>
      {firstBackground(args)}
      {args.renderSlot("children", childImageContext(args.ctx, args.node))}
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
export function renderContainer(
  args: BlockRenderArgs<ContainerProps>
): ReactElement {
  const { props, renderSlot, className, ctx, node } = args;
  // Checked rather than trusted. The type says what an author may write; the
  // document says what is actually stored, and validation only asks that props
  // be an object. A stored `as: "img"` would reach React as a void element
  // handed children and throw, taking the page with it, so an unknown tag falls
  // back to the one every container can safely be.
  const Tag = rootTagOf(props, false);
  const classes = withRevision(withContentWidth(className, props), args);
  // The children's images are sized to the width this container leaves them.
  return (
    <Tag className={classes}>
      {firstBackground(args)}
      {renderSlot("children", childImageContext(ctx, node))}
    </Tag>
  );
}
