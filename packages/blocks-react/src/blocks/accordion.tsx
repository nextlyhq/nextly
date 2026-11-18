/**
 * `core/accordion` — the group a set of disclosure sections belongs to.
 *
 * A preset over the same implementation `core/box`, `core/section`, `core/card`
 * and the columns pair use, restricted to `core/accordion-item` children. It
 * differs from a box in relationships and defaults, never in capabilities,
 * which is the property `container.tsx` argues for: display is a style, so a
 * stack of sections is a box that starts stacked rather than a second kind of
 * container.
 *
 * **Why the group exists at all, given the sections work alone.** A bare
 * `<details>` is already a working disclosure, so a library could ship only the
 * item and let authors drop them anywhere. The group earns its place by holding
 * the things that belong to the SET rather than to a section: the spacing
 * between sections, the shared border treatment, and — the load-bearing one —
 * an identity the editor can select, so "the FAQ" is one thing to move,
 * duplicate or hide rather than six things that happen to be adjacent.
 *
 * It is also what makes the slot restriction expressible. `core/accordion`
 * accepts only `core/accordion-item`, so the editor can refuse a paragraph
 * dropped between two sections — which would render outside every `<details>`
 * and be permanently visible, looking like a bug in the accordion rather than a
 * misplaced block.
 *
 * **The gap between sections is `baseStyles`, not a rule in the renderer.**
 * `blocks-react/src/styles.ts` feeds `baseStyles` to `compilePageCss`, so a
 * default declared here is a real stylesheet rule an author can override on the
 * node like any other. A value hardcoded in the render function could not be
 * overridden at all.
 *
 * **No default border, and no default background.** The older page-builder drew
 * its dividers with `var(--nx-color-border)`, which is the ADMIN token
 * namespace — so that declaration validates, compiles, ships, and then resolves
 * to nothing on the visitor's page while looking correct inside an admin
 * preview. **Three blocks reached for that namespace independently**, which
 * makes it design pressure rather than three mistakes: when the correct
 * mechanism is unreachable, the thing that LOOKS like it works gets reached for.
 *
 * The gap between sections is the site's `space.stack` token, the same space
 * every container puts between the blocks it holds, so an accordion reads
 * with the rhythm of the page around it.
 *
 * The `--nx-` half of that history stands: that namespace belongs to the admin
 * and this renderer never emits it, so a rule using it resolves to nothing on a
 * published page while looking right in an editor preview.
 *
 * The divider is left to the author.
 *
 * @module blocks/library/accordion
 */
import { type BlockDefinition, defineBlock } from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";

import type {
  AccordionTitleLevel,
  BlockRenderArgs,
  PageContext,
} from "../context";

import {
  ACCORDION_BLOCK,
  ACCORDION_ITEM_BLOCK,
  ACCORDION_TITLE_LEVELS,
} from "./accordion-item";
import { INTERACTIVE } from "./categories";
import {
  containerContentModel,
  CONTAINER_SUPPORTS,
  CONTENT_WIDTH_PROPS,
  renderContainer,
} from "./container";
import type { ContainerProps } from "./container";
import { htmlTagProp } from "./html-tags";

export { ACCORDION_BLOCK, ACCORDION_ITEM_BLOCK } from "./accordion-item";

/**
 * Sections stacked, with a gap between them.
 *
 * `display: grid` rather than `flex` because a single-column grid gives `gap`
 * its meaning with no other declaration — no direction to set, no wrapping to
 * disable, and no flex-item properties needed on the children. The catalog has
 * no flex ITEM properties at all (`flex`, `flexGrow`, `flexShrink`, `flexBasis`
 * are absent), so a flex layout here would leave the sections unable to express
 * how they take space; a grid puts that on the track list, which the group owns.
 */
export const ACCORDION_BASE_STYLES = {
  base: {
    base: {
      display: "grid",
      // The site's stack token, which every path a reference reaches declares,
      // a stored artifact handed back with no context included.
      gap: { $token: "space.stack" },
      // A plus at the end of each title, a minus while open, the same in
      // every browser, which an author changes like any value.
      disclosureIcon: "plus",
      disclosurePosition: "after",
    },
  },
} as const;

/** What an author writes on an accordion. */
export interface AccordionProps extends ContainerProps {
  /** What its sections' titles are drawn as. */
  titlesAs?: AccordionTitleLevel;
  /**
   * Whether one section opens at a time (`one`), closing the others, or each
   * opens alone (`many`). Unset reads as `many`, which is how an accordion
   * stored before this setting behaves; a new one stores `one`.
   */
  openMode?: "one" | "many";
  /** Whether the first section starts open. Unset reads as off. */
  firstOpen?: boolean;
}

/** The questions a new accordion starts with: three, numbered. */
const STARTING_QUESTIONS = [1, 2, 3].map(number => ({
  type: ACCORDION_ITEM_BLOCK,
  props: { title: `Question ${String(number)}` },
}));

/**
 * The name a one-at-a-time accordion's sections share. The node id keeps it
 * apart from every other accordion on the page, and the list place from the
 * copies a list draws of the same node once per entry. A `<details>` name is
 * matched only against others in the same document, and is never shown.
 */
function groupName(args: BlockRenderArgs<AccordionProps>): string {
  const place = args.ctx.itemPosition;
  return place === undefined
    ? `nx-accordion-${args.node.id}`
    : `nx-accordion-${args.node.id}-${place}`;
}

/**
 * How this accordion's sections open, for its own subtree: the shared name
 * while one opens at a time, and the first section's id while it starts open.
 * Each is read defensively, as stored props are: only `one` opens one at a
 * time, and only `true` opens the first.
 */
function groupOf(
  args: BlockRenderArgs<AccordionProps>
): NonNullable<PageContext["accordionGroup"]> {
  const first = args.node.slots?.children?.[0]?.id;
  return {
    ...(args.props.openMode === "one" ? { name: groupName(args) } : {}),
    ...(args.props.firstOpen === true && first !== undefined
      ? { opens: first }
      : {}),
  };
}

/**
 * The group, drawn as a container whose sections are handed their title
 * level and how they open through the render context: set for this
 * accordion's subtree, so a nested one sets its own. A stored level it does
 * not offer draws text.
 */
function renderAccordion(args: BlockRenderArgs<AccordionProps>): ReactElement {
  const stored = args.props.titlesAs;
  const level = ACCORDION_TITLE_LEVELS.find(each => each === stored) ?? "text";
  const group = groupOf(args);
  return renderContainer({
    ...args,
    renderSlot: (name, ctx) =>
      args.renderSlot(name, {
        ...(ctx ?? args.ctx),
        accordionTitles: level,
        accordionGroup: group,
      }),
  });
}

export const accordion: BlockDefinition<AccordionProps, PageContext> =
  defineBlock<AccordionProps, PageContext>({
    name: ACCORDION_BLOCK,
    version: 1,
    // What an author reads, in the Add panel and the block card: one plain
    // line. What the block does, for whoever maintains it: A group of
    // disclosure sections. Restricts its slot to core/accordion-item so a stray
    // block cannot render outside every section and stay permanently visible.
    description: "Questions or topics that open and close.",
    // Palette metadata. The category is imported rather than spelled here so
    // nineteen blocks cannot drift into nineteen headings; keywords are what
    // let a search for a word the description never uses still find this.
    editor: {
      label: "Accordion",
      icon: "accordion",
      category: INTERACTIVE,
      keywords: ["disclosure", "faq", "collapse", "toggle"],
    },
    props: {
      as: htmlTagProp(["div", "section", "article"]),
      ...CONTENT_WIDTH_PROPS,
      // Whether opening one question closes the others. Done by the
      // browser through a shared `<details>` name, so it needs no script.
      openMode: {
        label: "Open",
        section: "Behaviour",
        type: "select",
        options: ["one", "many"],
        optionLabels: { one: "One at a time", many: "Many" },
        // An accordion stored before this setting opens each question
        // alone, so that is what unset reads as.
        whenUnset: "many",
      },
      firstOpen: {
        label: "First open",
        section: "Behaviour",
        type: "checkbox",
        whenUnset: false,
      },
      // What the titles ARE, for screen readers and search engines: their
      // place in the page's outline. How they look is the Style tab's.
      titlesAs: {
        label: "Titles as",
        section: "Behaviour",
        type: "select",
        options: [...ACCORDION_TITLE_LEVELS],
        optionLabels: {
          text: "Plain text",
          h2: "Heading 2",
          h3: "Heading 3",
          h4: "Heading 4",
          h5: "Heading 5",
          h6: "Heading 6",
        },
        // A stored accordion without a level draws text, as it always has;
        // a new one starts at Heading 3.
        whenUnset: "text",
      },
    },
    defaultProps: {
      as: "div",
      contained: false,
      titlesAs: "h3",
      openMode: "one",
      firstOpen: true,
    },
    example: { props: { as: "div" } },
    // The parent half of the nesting rule. `block.ts` is explicit that a slot
    // naming a type does NOT confine that type to this slot; the item states its
    // own side in `accordion-item.tsx`.
    slots: {
      children: {
        allow: [ACCORDION_ITEM_BLOCK],
        // Three numbered questions to start, each with an answer to write
        // over, so a new accordion reads as one at once and its questions
        // agree. An empty accordion would be unusable: this slot admits only
        // `core/accordion-item`, which names this block as its only parent.
        // A question added later takes the next number (the builder's
        // `accordion-questions.ts`).
        defaultBlock: STARTING_QUESTIONS,
      },
    },
    baseStyles: ACCORDION_BASE_STYLES,
    // A container's supports, and the icon its sections draw.
    supports: { ...CONTAINER_SUPPORTS, disclosure: true },
    // What it is as HTML follows the tag it renders.
    contentModel: containerContentModel,
    render: renderAccordion,
  });
