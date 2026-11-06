/**
 * `core/accordion-item` — one disclosure section, open and closed by the browser.
 *
 * A native `<details>` with a `<summary>`, which is the whole implementation:
 * the open/closed state, the keyboard behaviour, the focus handling and the
 * screen-reader announcement are the platform's, and none of them is JavaScript
 * this package would have to ship. `blocks-react` renders on the server and
 * carries no client boundary — there is no `"use client"` anywhere in it — so a
 * disclosure built any other way would be the first thing to need one.
 *
 * **The content is a SLOT, not a prop, and that is the substance of the port.**
 * The older page-builder's accordion stored its sections as a repeater of
 * `{ title, content }` strings and rendered the content through a Markdown
 * pass. That makes an accordion the only place in a document where you cannot
 * put an image, a button, or anything else the library can draw. Here the body
 * is ordinary children, so a section holds whatever a section holds and every
 * block inside it is selectable and stylable in its own right.
 *
 * **What this deliberately does NOT do: close its siblings.** `<details name>`
 * makes a group mutually exclusive with no script, and it needs one shared name
 * across the group. A child cannot derive that: `BlockRenderArgs` carries the
 * node being rendered and never its ancestors, so this block can see its own id
 * and not the accordion's. Three ways to supply it were considered and each
 * costs more than the behaviour is worth:
 *
 * - seeding a group id through the accordion's `SlotSpec.defaultBlock` — that
 *   declares each starting child by TYPE and props, and the group's name would
 *   have to be the PARENT's id, which no declaration written before the parent
 *   exists can name;
 * - passing it through the slot context — `renderSlot(name, ctx)` REPLACES the
 *   subtree's context, and `PageContext` says in as many words that widening it
 *   is "a deliberate act rather than a side effect of a new block";
 * - moving the whole group into one block that renders every `<details>`
 *   itself — which is the repeater design above, and loses the slot.
 *
 * Independent sections are also the safer default rather than merely the
 * cheaper one: an exclusive group collapses a section while someone is reading
 * it, which is why several design systems do not offer exclusivity at all.
 * Should it be wanted, the honest route is a group id on the context, decided
 * for the renderer as a whole rather than smuggled in with this block.
 *
 * **The `<summary>` holds an icon and the title, and the group styles both.**
 * The title is text, or the heading level the accordion names through the
 * render context (`accordionTitles`): a heading inside `<summary>` is valid
 * HTML, and the summary stays the native toggle. Before it sits an empty,
 * hidden icon, which the accordion's icon choice paints with a mask, turns
 * while open, or hides; the browser's own marker is what "Browser default"
 * keeps. Both are marked with the engine's classes rather than parts, since it
 * is the accordion's values that reach them, through child selectors, and a
 * section is never styled from inside itself.
 *
 * @module blocks/library/accordion-item
 */
import {
  type BlockDefinition,
  defineBlock,
  DISCLOSURE_ICON_CLASS,
  DISCLOSURE_TITLE_CLASS,
} from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";

// This package's own render args, not the engine's. The engine leaves
// `renderSlot`'s return renderer-agnostic; `context.ts` narrows it to
// `ReactNode` so a slot's output can be placed straight into JSX.
import type {
  AccordionTitleLevel,
  BlockRenderArgs,
  PageContext,
} from "../context";

import { INTERACTIVE } from "./categories";
import { CONTAINER_CHILD_GAP } from "./container";

/** This block's registered name, so the tests and its parent name it once. */
export const ACCORDION_ITEM_BLOCK = "core/accordion-item";

/** Its parent's name, declared here so the pair agrees on one string. */
export const ACCORDION_BLOCK = "core/accordion";

/** What an author writes on a section. */
export interface AccordionItemProps {
  /** The always-visible label in the `<summary>`. */
  title: string;
  /** Whether this section starts open. */
  open: boolean;
}

/**
 * What a section may be styled with.
 *
 * A `<details>` is a block-level box, so spacing, borders, background, colour
 * and typography apply to it exactly as they would to a box, and typography
 * inherits to the summary — which is the only way to reach that element, since
 * styles compile onto a block's own root and the catalog expresses no
 * descendant selector.
 *
 * **`layout` is withheld deliberately.** A `<details>` is not a flex or grid
 * container in any useful sense: its children are a `<summary>` and the flow
 * content the browser reveals, so `display: flex` there sets the title beside
 * the body, which is never what was wanted. The engine would accept it — every
 * key here must be a registered support, and `layout` is one — so withholding
 * it is this block's decision rather than a limitation.
 *
 * Every key is a STYLE CATALOG group. The older page-builder's accordion also
 * declared `visibility` and `customAttributes`, which are not groups in this
 * engine at all; node visibility is its own field on `BlockNode`, not a style
 * support. Copying that list is what the registry's unknown-support check
 * caught, and it is why the list is derived from the catalog rather than from
 * the block it replaces.
 */
export const ACCORDION_ITEM_SUPPORTS = {
  spacing: true,
  border: true,
  background: true,
  color: true,
  typography: true,
  dimensions: true,
  effects: true,
} as const;

/**
 * What an accordion's section titles may be drawn as, in the order the
 * accordion offers them: the one list, which the accordion's select offers
 * and from which the headings a section draws are derived.
 */
export const ACCORDION_TITLE_LEVELS: readonly AccordionTitleLevel[] = [
  "text",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
];

/** The levels drawn as a heading: every offered level but text. */
const TITLE_HEADINGS: ReadonlySet<string> = new Set(
  ACCORDION_TITLE_LEVELS.filter(level => level !== "text")
);

/**
 * The title's own defaults. A heading title is matched directly by the site's
 * heading baseline (its size, leading, weight and margins), which would beat
 * the section's typography, set on its `<details>` and reaching the title only
 * by inheritance. Reset here, after that baseline and at its weight, so a
 * title looks as the section is styled whatever level it is.
 */
const ACCORDION_ITEM_PARTS = {
  title: {
    baseStyles: {
      base: {
        base: {
          fontSize: "inherit",
          lineHeight: "inherit",
          fontWeight: "inherit",
          margin: {
            blockStart: "0",
            blockEnd: "0",
            inlineStart: "0",
            inlineEnd: "0",
          },
        },
      },
    },
  },
} as const;

/**
 * The element a title is drawn as: the heading its accordion names, or text
 * for anything else, read defensively as the stored props are.
 */
function titleTag(
  level: AccordionTitleLevel | undefined
): "span" | "h2" | "h3" | "h4" | "h5" | "h6" {
  return level !== undefined && level !== "text" && TITLE_HEADINGS.has(level)
    ? level
    : "span";
}

/** A section: its title always visible, its children revealed when open. */
function renderAccordionItem({
  props,
  ctx,
  className,
  partClass,
  renderSlot,
}: BlockRenderArgs<AccordionItemProps>): ReactElement {
  // Read defensively rather than trusted. The type states what an author may
  // write; the document states what is stored, and validation asks only that
  // props be an object. A stored non-string title would otherwise reach React
  // as a child object and throw, taking the page down with it.
  const title = typeof props.title === "string" ? props.title : "";
  const Title = titleTag(ctx.accordionTitles);
  return (
    <details className={className} open={props.open === true}>
      <summary>
        <span className={DISCLOSURE_ICON_CLASS} aria-hidden="true" />
        <Title className={`${DISCLOSURE_TITLE_CLASS} ${partClass("title")}`}>
          {title}
        </Title>
      </summary>
      {renderSlot("children")}
    </details>
  );
}

export const accordionItem: BlockDefinition<AccordionItemProps, PageContext> =
  defineBlock({
    name: ACCORDION_ITEM_BLOCK,
    version: 1,
    // What an author reads, in the Add panel and the block card: one plain
    // line. What the block does, for whoever maintains it: One section of an
    // accordion: a title that is always visible and children the browser
    // reveals when it is open.
    description: "One part of an accordion, with a title that opens it.",
    // Palette metadata. The category is imported rather than spelled here so
    // nineteen blocks cannot drift into nineteen headings; keywords are what
    // let a search for a word the description never uses still find this.
    editor: {
      label: "Accordion item",
      icon: "panel",
      category: INTERACTIVE,
      keywords: ["disclosure", "panel", "faq"],
    },
    props: {
      title: { label: "Title", role: "content", type: "text" },
      open: { label: "Open by default", type: "checkbox" },
    },
    defaultProps: { title: "Section", open: false },
    example: { props: { title: "What is included?", open: false } },
    // The child half of the nesting rule. The parent states the other half in
    // `accordion.tsx`; `block.ts` is explicit that neither implies the other.
    parent: [ACCORDION_BLOCK],
    slots: {
      // No declared starting children. Unlike the accordion that holds it, this
      // slot carries no allow-list: a section holds whatever a section holds, so
      // there is no child type it exists to hold and no starting block righter
      // than none.
      children: {},
    },
    // Every block after the `<summary>` is spaced from what precedes it, the
    // first one from the title included.
    childGap: CONTAINER_CHILD_GAP,
    parts: ACCORDION_ITEM_PARTS,
    supports: ACCORDION_ITEM_SUPPORTS,
    // A `<details>` is interactive content, so nothing that refuses
    // interactive content may hold one, and like any element but a plain box it
    // refuses a main beneath it.
    contentModel: () => ({
      is: ["flow", "interactive"],
      accepts: { without: ["main"] },
    }),
    render: renderAccordionItem,
  });
