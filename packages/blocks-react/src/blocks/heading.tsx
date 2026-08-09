/**
 * `core/heading` — a section title.
 *
 * The level is STORED, never derived from the node's depth in the tree. A
 * builder that computes it from nesting produces a document whose outline
 * changes when a block is dragged, which is precisely the accessibility failure
 * headings exist to prevent: the level describes the content's structure, not
 * the editor's.
 *
 * @module blocks/heading
 */
import { defineBlock } from "@nextlyhq/blocks-engine";
import { createElement } from "react";
import type { ReactElement } from "react";

import type { BlockRenderArgs, PageContext } from "../context";

import { oneOf, relFor, text, url } from "./props";

/** The levels a heading may render. */
export const HEADING_LEVELS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

export type HeadingLevel = (typeof HEADING_LEVELS)[number];

export interface HeadingProps {
  /** The heading text. */
  text?: string;
  /** Which heading level to render. */
  level?: HeadingLevel;
  /** An optional link wrapped INSIDE the heading, not around it. */
  href?: string;
  /** Where the link opens. */
  target?: "_self" | "_blank";
  /** Extra `rel` tokens; `noopener noreferrer` are added for `_blank`. */
  rel?: string;
}

export function renderHeading({
  props,
  className,
}: BlockRenderArgs<HeadingProps>): ReactElement {
  const level = oneOf(props.level, HEADING_LEVELS, "h2");
  const label = text(props.text);
  const href = url(props.href);

  // The anchor goes INSIDE the heading. Wrapping the heading in a link instead
  // would put a block-level element in a phrasing context and, more usefully,
  // would make a screen reader announce the whole heading as a link even when
  // only part of it is meant to be one.
  const content = href
    ? createElement(
        "a",
        {
          href,
          ...(props.target === "_blank" ? { target: "_blank" } : {}),
          ...(relFor(props.target, props.rel) === undefined
            ? {}
            : { rel: relFor(props.target, props.rel) }),
        },
        label
      )
    : label;

  return createElement(level, { className }, content);
}

// Defined against the ENGINE's `defineBlock`, not the plugin SDK's: the engine
// declares the contract and the SDK re-exports it for third parties. The
// context is named rather than augmented, so a block compiled against the
// published types is typed the same as one compiled here. See `./index.ts`.
export const heading = defineBlock<HeadingProps, PageContext>({
  name: "core/heading",
  version: 1,
  description:
    "A section title. The level is chosen by the author, so the page outline stays stable when blocks move.",
  props: {
    text: { type: "text" },
    level: { type: "select", options: [...HEADING_LEVELS] },
    href: { type: "url" },
    target: { type: "select", options: ["_self", "_blank"] },
    rel: { type: "text" },
  },
  defaultProps: { text: "", level: "h2" },
  // A heading is what a page calls itself, so the first one is the best title
  // available when nobody filled the SEO field in.
  seo: props => ({ title: props.text }),
  example: { props: { text: "A section title", level: "h2" } },
  supports: {
    typography: true,
    color: true,
    spacing: true,
    dimensions: true,
    border: true,
    effects: true,
    position: true,
  },
  render: renderHeading,
});
