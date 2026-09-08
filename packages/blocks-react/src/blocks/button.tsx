/**
 * `core/button` — a call to action.
 *
 * Renders an ANCHOR when it navigates and a BUTTON when it does not, which is
 * the rule assistive technology and keyboard users depend on: a link is
 * followed and appears in a link list, a button is activated. A styled `<div>`
 * that looks like a button, or an anchor with no `href`, is reachable by neither.
 *
 * @module blocks/button
 */
import { defineBlock } from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";

import type { BlockRenderArgs, PageContext } from "../context";

import { INTERACTIVE } from "./categories";
import { oneOf, relFor, text, url } from "./props";

/** The button's HTML behaviour when it is not a link. */
export const BUTTON_TYPES = ["button", "submit", "reset"] as const;

export interface ButtonProps {
  /** The visible label. */
  label?: string;
  /** Where it goes. With a destination it is a link; without, a button. */
  href?: string;
  /** An entry to link to, resolved to a path through the host. */
  entryCollection?: string;
  /** The entry's id, used with `entryCollection`. */
  entryId?: string;
  /** Where the link opens. */
  target?: "_self" | "_blank";
  /** Extra `rel` tokens; `noopener noreferrer` are added for `_blank`. */
  rel?: string;
  /** The `type` attribute when this renders as a button. */
  type?: "button" | "submit" | "reset";
  /** An accessible name, when the visible label is not descriptive enough. */
  ariaLabel?: string;
}

export async function renderButton({
  props,
  className,
  ctx,
}: BlockRenderArgs<ButtonProps>): Promise<ReactElement> {
  const label = text(props.label);
  const collection = text(props.entryCollection);
  const entryId = text(props.entryId);

  // An entry reference beats a typed URL: it survives the entry being renamed,
  // which a pasted path does not. Resolution is a read, so it can fail, and a
  // failure means "no destination" rather than a lost page.
  const resolvedPath =
    collection !== "" && entryId !== ""
      ? await ctx.resolveEntryPath(collection, entryId).catch(() => null)
      : null;

  const href = url(resolvedPath ?? undefined) ?? url(props.href);
  const ariaLabel = text(props.ariaLabel);
  const shared = {
    className,
    ...(ariaLabel === "" ? {} : { "aria-label": ariaLabel }),
  };

  if (href === undefined) {
    return (
      <button {...shared} type={oneOf(props.type, BUTTON_TYPES, "button")}>
        {label}
      </button>
    );
  }

  const rel = relFor(props.target, props.rel);
  return (
    <a
      {...shared}
      href={href}
      {...(props.target === "_blank" ? { target: "_blank" } : {})}
      {...(rel === undefined ? {} : { rel })}
    >
      {label}
    </a>
  );
}

// Defined against the ENGINE's `defineBlock`, not the plugin SDK's: the engine
// declares the contract and the SDK re-exports it for third parties. The
// context is named rather than augmented, so a block compiled against the
// published types is typed the same as one compiled here. See `./index.ts`.
/**
 * What makes a call to action look like one.
 *
 * The block renders an `<a>` when it has a destination and a `<button>` when it
 * does not, and both wear this class, so these declarations have to work for
 * either element. That is why several of them look like a reset: an anchor
 * arrives underlined and an inline box, a button arrives with the user agent's
 * own font rather than the page's, and a default that fixed one would leave the
 * other visibly different from its twin.
 *
 * **Colours are tokens; the geometry is literal.** The same split `core/card`
 * makes, for the same reason: `color.primary` and `color.background` are in the
 * default token set and carry per-mode values, so a literal would be wrong in
 * whichever of light and dark it was not picked for. No radius or button-scale
 * token is guaranteed to exist, so those stay values.
 *
 * `color.background` as the foreground is deliberate rather than convenient. It
 * is the page's ground, so it sits at the opposite pole from `color.text` in
 * both modes and therefore contrasts with a saturated `color.primary` in both —
 * white on blue in light, near-black on light blue in dark. A literal white
 * would fail the second.
 *
 * There is one look rather than a set of variants, because `type` here is the
 * HTML attribute — `button`, `submit`, `reset` — and not a visual kind. A block
 * default is keyed by block TYPE, so it could not tell variants apart even if
 * they existed.
 */
/**
 * What a primary action looks like, stated once.
 *
 * Exported because `core/form` renders one too. A form's submit IS a button in
 * every sense an author cares about, and two blocks describing that appearance
 * separately would drift into two different-looking primary actions on one
 * page — which is what happened while the form styled nothing and a host reset
 * left its submit as plain text beside this control.
 */
export const BUTTON_BASE_STYLES = {
  base: {
    base: {
      display: "inline-block",
      // A user agent gives `<button>` a border box and `<a>` a content box, so
      // an authored width means two different outer sizes depending only on
      // whether a destination is set. Measured with `width: 200px` and this
      // set's own inline padding: the anchor came out 232px and the button
      // 200px. Stated once here, both are the same control.
      boxSizing: "border-box",
      padding: {
        blockStart: "0.5rem",
        blockEnd: "0.5rem",
        inlineStart: "1rem",
        inlineEnd: "1rem",
      },
      backgroundColor: { $token: "color.primary" },
      color: { $token: "color.background" },
      borderRadius: "8px",
      // A user agent draws a border on `<button>` and none on `<a>`, and this
      // block renders whichever the presence of a destination selects. Left
      // alone, adding or removing a link changes the control's outline and its
      // outer size while every other declaration here says the two are one
      // presentation. Zeroed rather than set: the block states no border, so
      // the branch that would have inherited one states none either.
      border: {
        width: {
          blockStart: "0",
          blockEnd: "0",
          inlineStart: "0",
          inlineEnd: "0",
        },
        style: "none",
      },
      textDecoration: "none",
      // Every inherited typography longhand, not just family and size. A user
      // agent styles a `<button>` with its own complete font — measured against
      // an ancestor stating Georgia/20px/700/italic/2 line-height/2px tracking,
      // the anchor took all six and the button took two, so weight, style,
      // line-height and letter-spacing all differed. Adding a destination
      // changed the label's metrics, which is the one thing this set exists to
      // prevent.
      fontFamily: "inherit",
      fontSize: "inherit",
      fontWeight: "inherit",
      fontStyle: "inherit",
      lineHeight: "inherit",
      letterSpacing: "inherit",
    },
  },
} as const;

export const button = defineBlock<ButtonProps, PageContext>({
  name: "core/button",
  version: 1,
  description:
    "A call to action. Renders a link when it has a destination and a button when it does not, so it is operable either way.",
  // Palette metadata. The category is imported rather than spelled here so
  // nineteen blocks cannot drift into nineteen headings; keywords are what
  // let a search for a word the description never uses still find this.
  editor: {
    label: "Button",
    icon: "button",
    category: INTERACTIVE,
    keywords: ["link", "cta", "call to action"],
  },
  baseStyles: BUTTON_BASE_STYLES,
  props: {
    label: { type: "text" },
    href: { type: "url" },
    entryCollection: { type: "text" },
    entryId: { type: "text" },
    target: { type: "select", options: ["_self", "_blank"] },
    rel: { type: "text" },
    type: { type: "select", options: [...BUTTON_TYPES] },
    ariaLabel: { type: "text" },
  },
  defaultProps: { label: "", type: "button" },
  example: { props: { label: "Get started", href: "/signup" } },
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
  render: renderButton,
});
