/**
 * `core/icon` — one symbol from an icon set, drawn as inline SVG.
 *
 * The document stores an id (`lucide:star`) and the page context resolves it,
 * so the set is the host's: a published page resolves it on the server and
 * ships no script, and the editor's canvas resolves it from the same data,
 * loaded when first needed.
 *
 * Three ways to use it, told apart by the markup assistive technology reads:
 * decorative (no label), hidden; labelled, an image with that name; linked, a
 * link named by the label, or by the icon's own name when there is none.
 *
 * @module blocks/icon
 */
import { type BlockDefinition, defineBlock } from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";

import type { BlockRenderArgs, PageContext, ResolvedIcon } from "../context";

import { MEDIA } from "./categories";
import { libraryDefinition } from "./classic-spacing";
import {
  canLink,
  isPresent,
  LINK_PROPS,
  linkFor,
  readClaimOf,
  text,
  type LinkProps,
} from "./props";

export interface IconProps extends LinkProps {
  /** The icon, as `<set>:<name>`: `lucide:star`. */
  icon?: string;
  /** What a screen reader says in place of the icon; empty means decorative. */
  label?: string;
}

/** An icon's name as a person would say it: `circle-arrow-up` → "Circle arrow up". */
export function iconSpokenName(name: string): string {
  const words = name.replace(/-/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The SVG for a resolved icon, sized by the text around it (1em) and drawn in
 * its colour, so Style's font size and colour size and colour it.
 *
 * The body is the host's own icon data, never author input, which is why it
 * is written as markup: an icon set is SVG, and rebuilding it element by
 * element would restate the set's format here. `label` makes it an image with
 * that name; without one it is hidden from assistive technology, as a
 * decorative glyph or one inside a link that is named instead.
 */
function renderIconSvg(
  resolved: ResolvedIcon,
  options: { readonly label?: string; readonly className?: string } = {}
): ReactElement {
  const named = options.label !== undefined && options.label !== "";
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={resolved.viewBox}
      width="1em"
      height="1em"
      fill={resolved.stroked ? "none" : "currentColor"}
      {...(resolved.stroked
        ? {
            stroke: "currentColor",
            strokeWidth: 2,
            strokeLinecap: "round" as const,
            strokeLinejoin: "round" as const,
          }
        : // A filled icon says it has no stroke, so a page's styles setting
          // one on its SVGs or an ancestor cannot outline it: stroke is
          // inherited.
          { stroke: "none" })}
      focusable="false"
      {...(named
        ? { role: "img", "aria-label": options.label }
        : { "aria-hidden": true })}
      {...(options.className === undefined
        ? {}
        : { className: options.className })}
      dangerouslySetInnerHTML={{ __html: resolved.body }}
    />
  );
}

/** The icon block's type, which a list reading its links ahead asks by. */
export const ICON_TYPE = "core/icon";

/**
 * Whether an icon names one to draw, and so a link to follow. `has` says
 * whether a prop holds a value (or, for a list reading its links ahead, is
 * bound to one). Asked by the render before it resolves the icon, and by a
 * list before it reads this icon's link ahead, so the two agree on which
 * icons link. An icon the host then cannot draw still reads no link.
 */
export function iconMayDraw(has: (prop: string) => boolean): boolean {
  return has("icon");
}

export async function renderIcon({
  props,
  className,
  ctx,
  node,
}: BlockRenderArgs<IconProps>): Promise<ReactElement> {
  const id = text(props.icon);
  // A resolver that fails is the same as one that draws no such icon: the
  // page still renders, without the icon, rather than failing whole.
  const resolved =
    !iconMayDraw(prop => isPresent(props, prop)) ||
    ctx.resolveIcon === undefined
      ? null
      : await ctx.resolveIcon(id).catch(() => null);
  // An icon this host does not draw: an empty, unnamed element, so the block
  // keeps its place to be selected and the page shows nothing in its stead.
  // Decided before the link is resolved, so an icon that draws nothing spends
  // none of the page's reads on an entry's address it would not use.
  if (resolved === null) {
    return <span className={className} aria-hidden="true" />;
  }
  const label = text(props.label);
  // Claimed as this block's, so a page past its allowance names it.
  const link = await linkFor(props, (collection, entryId) =>
    ctx.resolveEntryPath(collection, entryId, readClaimOf(node))
  );
  if (link === undefined) {
    return renderIconSvg(resolved, { label, className });
  }
  // A link is named by the label, or by the icon's own name when the author
  // gave none: a link with no name is announced only as "link".
  return (
    <a
      className={className}
      {...link}
      aria-label={label === "" ? iconSpokenName(resolved.name) : label}
    >
      {renderIconSvg(resolved)}
    </a>
  );
}

/**
 * The block's own look: an inline box the size of the text, so an icon sits
 * on a line beside words and Style's font size sizes it.
 */
const ICON_BASE_STYLES = {
  base: {
    base: {
      display: "inline-flex",
      fontSize: "1.5rem",
    },
  },
} as const;

// Defined against the ENGINE's `defineBlock`, as every core block is, so the
// library carries no dependency on the plugin SDK.
export const icon: BlockDefinition<IconProps, PageContext> = libraryDefinition(
  defineBlock({
    name: ICON_TYPE,
    version: 1,
    description: "A symbol, decorative or labelled.",
    editor: {
      label: "Icon",
      icon: "star",
      category: MEDIA,
      keywords: ["symbol", "glyph", "svg"],
    },
    baseStyles: ICON_BASE_STYLES,
    props: {
      icon: { label: "Icon", role: "content", type: "icon" },
      label: {
        label: "Screen reader label",
        role: "content",
        type: "text",
        hint: "Read out in place of the icon. Leave empty when the text beside it already says the same.",
      },
      ...LINK_PROPS,
    },
    defaultProps: { icon: "lucide:star", label: "" },
    example: { props: { icon: "lucide:star", label: "" } },
    supports: {
      typography: true,
      color: true,
      background: true,
      spacing: true,
      dimensions: true,
      border: true,
      effects: true,
      position: true,
    },
    // Phrasing, so it sits on a line beside words; interactive only when it
    // links, so an unlinked icon can still go inside a link.
    contentModel: props =>
      canLink(props)
        ? { is: ["flow", "phrasing", "interactive"] }
        : { is: ["flow", "phrasing"] },
    rendersNothing: props => text(props.icon) === "",
    render: renderIcon,
  })
);
