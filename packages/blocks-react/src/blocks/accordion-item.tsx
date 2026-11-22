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
 * **How a section opens is its accordion's to say.** `<details name>` makes
 * a group mutually exclusive with no script: opening one closes the others
 * that share its name. A child cannot derive that name, since
 * `BlockRenderArgs` carries the node being rendered and never its ancestors,
 * so the accordion hands its sections a group on the render context
 * (`accordionGroup`), for its own subtree, as it hands them their title
 * level: the shared name while one opens at a time, and which section starts
 * open while the first does. With one open at a time a section's own "Open
 * by default" is not drawn (a browser keeps only one of a named group open
 * anyway); with many, it is, beside the accordion's First open.
 *
 * **The toggle is a 44px target with a ring for the keyboard.** The
 * `<summary>` is the native toggle, opened by a click, a tap, Enter and Space;
 * its part sets a minimum height a finger can hit and a focus ring in the
 * text's own colour, so it follows the site's colours and dark values.
 *
 * **The `<summary>` holds an icon and the title, and the group styles both.**
 * The title is text, or the heading level the accordion names through the
 * render context (`accordionTitles`): a heading inside `<summary>` is valid
 * HTML, and the summary stays the native toggle. Before it sits an empty
 * icon, hidden from screen readers, which the accordion's icon choice paints
 * with a mask (a plus that becomes a minus, or a chevron that turns) or
 * hides. Both are marked with the engine's classes rather than parts, since it
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
  toOneParagraph,
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
  /** Whether this section starts open, while its accordion opens many. */
  open: boolean;
}

/** The answer a new question starts with, for its author to write over. */
const STARTING_ANSWER = [
  {
    type: "core/text",
    props: { text: toOneParagraph("Write the answer here.").value },
  },
];

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
  // The `<summary>`: a target at least 44px tall, and a ring in the text's
  // colour while it has keyboard focus, which a reset stylesheet may have
  // taken away. Drawn just outside the row, so it never covers the title.
  toggle: {
    baseStyles: {
      base: {
        base: { minHeight: "44px" },
      },
      focus: {
        base: {
          outline: {
            width: "2px",
            style: "solid",
            color: "currentColor",
            offset: "2px",
          },
        },
      },
    },
  },
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

/**
 * Whether a section starts open: the one its accordion opens first, and,
 * while the accordion opens many, any section set to open itself. While one
 * opens at a time, its own setting is hidden in the editor and not drawn.
 */
function startsOpen(
  props: AccordionItemProps,
  id: string,
  group: PageContext["accordionGroup"]
): boolean {
  if (group?.opens === id) return true;
  return group?.name === undefined && props.open === true;
}

/** A section: its title always visible, its children revealed when open. */
function renderAccordionItem({
  props,
  node,
  ctx,
  className,
  partClass,
  markProp,
  renderSlot,
}: BlockRenderArgs<AccordionItemProps>): ReactElement {
  // Read defensively rather than trusted. The type states what an author may
  // write; the document states what is stored, and validation asks only that
  // props be an object. A stored non-string title would otherwise reach React
  // as a child object and throw, taking the page down with it.
  const title = typeof props.title === "string" ? props.title : "";
  const Title = titleTag(ctx.accordionTitles);
  const group = ctx.accordionGroup;
  return (
    <details
      className={className}
      open={startsOpen(props, node.id, group)}
      {...(group?.name === undefined ? {} : { name: group.name })}
    >
      <summary className={partClass("toggle")}>
        <span className={DISCLOSURE_ICON_CLASS} aria-hidden="true" />
        <Title
          className={`${DISCLOSURE_TITLE_CLASS} ${partClass("title")}`}
          // The element the editor types the title into, on the canvas.
          {...(markProp?.("title") ?? {})}
        >
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
      label: "Question",
      icon: "panel",
      category: INTERACTIVE,
      keywords: ["disclosure", "panel", "faq", "accordion item", "answer"],
    },
    props: {
      title: { label: "Question", role: "content", type: "text", inline: true },
      // Shown only while the accordion opens many at a time: with one at a
      // time, its First open decides, and this is not drawn.
      open: {
        label: "Open by default",
        type: "checkbox",
        onlyWhenParent: { openMode: ["many"] },
      },
    },
    // A question added to an accordion is given the next number there by the
    // editor; this is what one placed any other way says.
    defaultProps: { title: "Question", open: false },
    example: { props: { title: "Question 1", open: false } },
    // The child half of the nesting rule. The parent states the other half in
    // `accordion.tsx`; `block.ts` is explicit that neither implies the other.
    parent: [ACCORDION_BLOCK],
    slots: {
      // No allow-list: a section holds whatever a section holds, a picture, a
      // button or a list as much as words. It starts with one Text, the answer
      // to write over; emptied, the editor draws its empty-container start.
      children: { defaultBlock: STARTING_ANSWER },
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
