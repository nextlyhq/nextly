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
 * **No default border, and no default background.** `defaultSiteTokens()`
 * guarantees `color.text`, `color.background`, `color.primary`, `font.body`,
 * `content.width` and `space.4` — there is no surface colour and no border
 * colour among them. The older page-builder drew its dividers with
 * `var(--nx-color-border)`, which is the ADMIN token namespace: this renderer
 * emits `--site-*`, so that declaration validates, compiles, ships, and then
 * resolves to nothing on the visitor's page while looking correct inside an
 * admin preview. Separation between sections is therefore spacing, which every
 * theme can express, and the divider is left to the author until a surface
 * token exists to carry it.
 *
 * @module blocks/library/accordion
 */
import { defineBlock } from "@nextlyhq/blocks-engine";

import type { PageContext } from "../context";

import { ACCORDION_BLOCK, ACCORDION_ITEM_BLOCK } from "./accordion-item";
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
 * `space.4` is one of the six tokens `defaultSiteTokens()` guarantees, so this
 * default resolves under every theme rather than only where a site happens to
 * define a spacing scale.
 */
export const ACCORDION_BASE_STYLES = {
  base: {
    base: {
      display: "grid",
      // A LENGTH, not a token: nothing emits token CSS yet, so a `{ $token }`
      // reference compiles to a `var()` with nothing behind it and the gap
      // silently falls back to `normal`, which for a grid is zero. `1rem` is
      // what `space.4` itself declares, so the value survives the change back.
      gap: "1rem",
    },
  },
} as const;

export const accordion = defineBlock<ContainerProps, PageContext>({
  name: ACCORDION_BLOCK,
  version: 1,
  description:
    "A group of disclosure sections. Restricts its slot to core/accordion-item so a stray block cannot render outside every section and stay permanently visible.",
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
      // Empty, as everywhere in this library: a literal template carries
      // literal ids and two groups expanded from one collide on
      // `duplicate-node-id`. Nothing reads `SlotSpec.template` yet.
      template: [],
    },
  },
  baseStyles: ACCORDION_BASE_STYLES,
  supports: CONTAINER_SUPPORTS,
  render: renderContainer,
});
