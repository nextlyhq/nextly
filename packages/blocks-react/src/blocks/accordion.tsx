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
 * The gap is `space.4`, and the route it took is worth keeping. This block
 * shipped with `{ $token: "space.4" }` and its sections rendered touching,
 * because nothing turned the token set into CSS: an unresolved `var()` makes
 * the declaration invalid at computed-value time and `gap` falls back to
 * `normal` — zero for a grid. It became a plain length for that reason, and is
 * a token again now that `PageRenderer` emits the token tier on every path a
 * reference reaches, including a stored artifact handed back with no context.
 *
 * The `--nx-` half of that history stands: that namespace belongs to the admin
 * and this renderer never emits it, so a rule using it resolves to nothing on a
 * published page while looking right in an editor preview.
 *
 * Separation between sections is therefore a LENGTH, which needs no stylesheet
 * to resolve, and the divider is left to the author until the site stylesheet
 * is wired and a surface token can carry it.
 *
 * @module blocks/library/accordion
 */
import { defineBlock } from "@nextlyhq/blocks-engine";

import type { PageContext } from "../context";

import { ACCORDION_BLOCK, ACCORDION_ITEM_BLOCK } from "./accordion-item";
import { INTERACTIVE } from "./categories";
import { CONTAINER_SUPPORTS, renderContainer } from "./container";
import type { ContainerProps } from "./container";

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
 *
 * The gap is a LENGTH rather than `{ $token: "space.4" }`, and `1rem` is what
 * `space.4` itself declares — so the value survives the change back once
 * `compileSiteSheet` is wired into the render path and tokens resolve.
 */
export const ACCORDION_BASE_STYLES = {
  base: {
    base: {
      display: "grid",
      // The site's spacing token. This was a length while nothing declared
      // `--site-*` on every path a reference reaches: the value compiled to a
      // `var()` with nothing behind it and `gap` fell back to `normal`, zero for
      // a grid. Measured on the path that used to fail — a stored artifact
      // handed back with no context — the property is now declared and resolves
      // to `1rem`, the value the literal stood in for.
      gap: { $token: "space.4" },
    },
  },
} as const;

export const accordion = defineBlock<ContainerProps, PageContext>({
  name: ACCORDION_BLOCK,
  version: 1,
  description:
    "A group of disclosure sections. Restricts its slot to core/accordion-item so a stray block cannot render outside every section and stay permanently visible.",
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
    as: { type: "select", options: ["div", "section", "article"] },
    contained: { type: "checkbox" },
  },
  defaultProps: { as: "div", contained: false },
  example: { props: { as: "div" } },
  // The parent half of the nesting rule. `block.ts` is explicit that a slot
  // naming a type does NOT confine that type to this slot; the item states its
  // own side in `accordion-item.tsx`.
  slots: {
    children: {
      allow: [ACCORDION_ITEM_BLOCK],
      // One section to start, because an empty accordion is unusable in the
      // precise sense a row is: this slot admits only `core/accordion-item`,
      // and that block names this one as its only parent, so the single block
      // that may go here can be placed nowhere else on the page.
      //
      // ONE rather than the row's two, and the difference is the same rule read
      // the other way. A row of one is a box, and `core/box` already exists, so
      // one column is a degenerate spelling of a block the author could have
      // reached for instead. An accordion of one is not a spelling of anything:
      // a lone `core/accordion-item` cannot stand on a page at all, so a single
      // disclosure REQUIRES this wrapper and is a finished document.
      defaultBlock: [{ type: ACCORDION_ITEM_BLOCK }],
    },
  },
  baseStyles: ACCORDION_BASE_STYLES,
  supports: CONTAINER_SUPPORTS,
  render: renderContainer,
});
