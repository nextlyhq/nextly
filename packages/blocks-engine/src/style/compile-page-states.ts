/**
 * The elements the typography tier styles, and the interaction states: which
 * states a descendant passes up to its ancestors, the selectors each state is
 * written with on a published page, and the forced-state classes a preview uses.
 *
 * @module style/compile-page-states
 */
import { STYLE_STATES, type StyleState } from "../document";

/**
 * The pseudo-class each stored state compiles to.
 *
 * Wrapped in `:where()`, which matches identically and contributes NOTHING to
 * specificity. Everything this module emits is anchored at the page root and
 * meant to be decided by source order alone; a bare `:hover` is worth a class,
 * so a block type's default hover colour would beat a node's own colour however
 * late the node's rule came, and a node given its own colour would still change
 * colour on hover having said nothing about hovering.
 *
 * Zeroing them is only half of it: at equal specificity source order decides, so
 * the order states and breakpoints are emitted in becomes the cascade. See
 * `envelopeRules`.
 *
 * `:focus-visible`, not `:focus`. Styling every focus paints a ring on mouse
 * users who never asked for one, which is why authors historically removed focus
 * styling altogether and broke keyboard navigation.
 */
/**
 * The elements a typographic default may be written for.
 *
 * Closed and ordered: closed because a tag is interpolated into a selector and
 * a caller-supplied one would be an injection surface of exactly the kind the
 * block-type check below refuses; ordered because two defaults at equal
 * specificity are separated by source order, so the order they are emitted in
 * is part of the contract rather than an artifact of iteration.
 */
export const TYPOGRAPHIC_ELEMENTS = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "blockquote",
  "figure",
  "hr",
  "ol",
  "ul",
  // Last, so adding it moved no earlier element's rule: rich text renders a
  // code block as one.
  "pre",
] as const;

/**
 * An element a typographic default may be written for.
 *
 * The type is the allow-list rather than a widening of it, so a tag the
 * compiler does not emit — a typo, or `table` before anyone decides it
 * belongs — is refused where it is written instead of silently contributing
 * nothing. A caller reading `Record<string, …>` has no way to learn which keys
 * are honoured except by trying one.
 */
export type TypographicElement = (typeof TYPOGRAPHIC_ELEMENTS)[number];

/**
 * What each interaction state MEANS, in one place.
 *
 * Both facts about a state live here together, because both are read by
 * surfaces outside this file and either one written down twice can drift from
 * the other. The pseudo-class is what the compiler emits; whether the state
 * PROPAGATES is what a previewing surface needs in order to decide which
 * elements to force it on.
 *
 * Propagation is measured behaviour rather than a convention. In a browser, an
 * ancestor of the target matches `:hover` and `:active` and does NOT match
 * `:focus-visible` — the selector that would propagate there is
 * `:focus-within`, which this compiler does not emit. A surface that assumed
 * one rule for all three would light up an enclosing block for an appearance no
 * visitor ever sees.
 *
 * `base` is not a state: it is what applies when no state does, so it has no
 * pseudo-class and nothing to propagate.
 */
const STATE_FACTS: Readonly<
  Record<StyleState, { readonly pseudo: string; readonly propagates: boolean }>
> = {
  base: { pseudo: "", propagates: false },
  hover: { pseudo: ":hover", propagates: true },
  focus: { pseudo: ":focus-visible", propagates: false },
  active: { pseudo: ":active", propagates: true },
};

/**
 * Whether forcing this state on an element should also force it on that
 * element's ancestors.
 *
 * Published because the decision belongs beside the selector it follows from: a
 * previewing surface marks elements, and a surface deciding for itself which
 * states propagate holds a second opinion that can disagree with the CSS this
 * compiler emits. Changing `focus` to `:focus-within` would then move the
 * published rules and leave the canvas marking the wrong chain.
 */
export function statePropagatesToAncestors(state: StyleState): boolean {
  return STATE_FACTS[state].propagates;
}

/**
 * One rendering of each state's pseudo-class, built by `render`.
 *
 * A helper rather than two object literals, so neither map can gain a state the
 * other lacks or spell one differently.
 */
function stateSelectors(
  render: (pseudo: string, state: StyleState) => string
): Readonly<Record<StyleState, string>> {
  const selectors = {} as Record<StyleState, string>;
  for (const state of STYLE_STATES) {
    const pseudo = STATE_FACTS[state].pseudo;
    selectors[state] = pseudo === "" ? "" : render(pseudo, state);
  }
  return selectors;
}

export const STATE_SELECTORS: Readonly<Record<StyleState, string>> =
  stateSelectors(pseudo => `:where(${pseudo})`);

/**
 * The class a previewing surface puts on ONE element to force an interaction
 * state on it.
 *
 * A page cannot force a pseudo-class on itself. There is no CSS or DOM way to
 * make an element match `:hover` without a pointer — `Emulation.forcePseudoState`
 * is a devtools protocol, not something a page can reach. So an editor that
 * lets an author edit a hover appearance has to be given something it CAN
 * toggle, and this is it.
 *
 * Named by the engine rather than by the editor because it is a contract
 * between the two: the compiler writes it into a selector and the surface puts
 * it on an element, and a name spelled in two places can be spelled
 * differently. The same reason `NODE_ID_ATTRIBUTE` is published.
 */
export function previewStateClass(state: StyleState): string {
  return `nx-pb-state-${state}`;
}

/**
 * The state selectors a PREVIEW sheet uses, with the marker joined to the
 * pseudo-class inside the existing wrapper.
 *
 * INSIDE `:where()`, which is the whole reason this is safe. `:where()`
 * contributes nothing whatever it holds, so a previewed rule weighs exactly
 * what the published one weighs and the preview cascade cannot differ from the
 * cascade a visitor gets. Measured in a browser against the alternative: with
 * the marker inside, a later equal-weight rule still won; moved outside, the
 * earlier rule won because the class had added weight of its own.
 *
 * That equality is a requirement rather than a nicety. The style panel's
 * provenance explains what the PUBLISHED page does, so a preview that ranked
 * its rules differently would describe an order no visitor ever sees — in the
 * one state the author opened the panel to inspect.
 *
 * `base` has no marker: it is not a state anything forces, it is what applies
 * when nothing else does.
 */
export const PREVIEW_STATE_SELECTORS: Readonly<Record<StyleState, string>> =
  stateSelectors(
    (pseudo, state) => `:where(${pseudo}, .${previewStateClass(state)})`
  );
