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
 * **`<summary>` takes the title as text, and cannot yet be styled separately.**
 * Styles compile onto a block's own root element, so a rule for a descendant
 * has nowhere to live in the catalog. The summary therefore keeps the browser's
 * own disclosure affordance — a real marker, a real focus ring, both already
 * accessible — and the block does not fake one with an inline style the engine
 * would not compile. Everything a site can express today is available on the
 * `<details>` root through {@link ACCORDION_ITEM_SUPPORTS}.
 *
 * @module blocks/library/accordion-item
 */
import { defineBlock } from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";

// This package's own render args, not the engine's. The engine leaves
// `renderSlot`'s return renderer-agnostic; `context.ts` narrows it to
// `ReactNode` so a slot's output can be placed straight into JSX.
import type { BlockRenderArgs, PageContext } from "../context";

import { INTERACTIVE } from "./categories";

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

/** A section: its title always visible, its children revealed when open. */
function renderAccordionItem({
  props,
  className,
  renderSlot,
}: BlockRenderArgs<AccordionItemProps>): ReactElement {
  // Read defensively rather than trusted. The type states what an author may
  // write; the document states what is stored, and validation asks only that
  // props be an object. A stored non-string title would otherwise reach React
  // as a child object and throw, taking the page down with it.
  const title = typeof props.title === "string" ? props.title : "";
  return (
    <details className={className} open={props.open === true}>
      <summary>{title}</summary>
      {renderSlot("children")}
    </details>
  );
}

export const accordionItem = defineBlock<AccordionItemProps, PageContext>({
  name: ACCORDION_ITEM_BLOCK,
  version: 1,
  description:
    "One section of an accordion: a title that is always visible and children the browser reveals when it is open.",
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
    title: { type: "text" },
    open: { type: "checkbox" },
  },
  defaultProps: { title: "Section", open: false },
  example: { props: { title: "What is included?", open: false } },
  // The child half of the nesting rule. The parent states the other half in
  // `accordion.tsx`; `block.ts` is explicit that neither implies the other.
  parent: [ACCORDION_BLOCK],
  slots: {
    // No declared starting children. Unlike the accordion that holds it, this
    // slot carries no allow-list — a section holds whatever a section holds,
    // which is the substance of the port described above — so there is no child
    // type it exists to hold and no starting block righter than none.
    children: {},
  },
  supports: ACCORDION_ITEM_SUPPORTS,
  render: renderAccordionItem,
});
