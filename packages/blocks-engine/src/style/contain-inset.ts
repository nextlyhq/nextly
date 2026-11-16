/**
 * How a contained block's inset reaches every padding that could replace it.
 *
 * A contained block is drawn full width, and the site sheet gives it an inline
 * padding that brings its content in to the content width
 * (`emitContentWidth`). An author's or a default's own side padding outweighs
 * that rule, so the page compile writes each inline padding as at least the
 * inset, and it flags the blocks whose own box is narrower than the one the
 * inset is measured from: one an author sized, a flex or grid item, and one
 * taken out of the flow. The site sheet reads the flags.
 *
 * @module style/contain-inset
 */
import type { Declaration } from "./declarations";

/**
 * The custom property a contained container's inset travels in.
 *
 * A contained container is drawn full width, and its inline padding brings its
 * content in to the site's content width. The site sheet sets this property on
 * a contained element to how far that is from each edge, and to `0px` on every
 * other element of the page (see `emitContentWidth`). It is registered as not
 * inherited there too, so a block inside a contained one never takes the inset
 * of the container around it.
 */
export const CONTAIN_INSET_PROPERTY = "--nx-contain-inset";

/** The two padding sides a contained container's inset is applied to. */
const INLINE_PADDING = new Set(["padding-inline-start", "padding-inline-end"]);

/** `0`, `-0`, `+0`, `0.0`, `.0` and the like: a zero with no unit. */
const UNITLESS_ZERO = /^[+-]?(?:0+(?:\.0*)?|\.0+)$/;

/**
 * A padding value as an argument of `max()`.
 *
 * A bare `0` is a length where a property takes one, but inside `max()` it is
 * a number, and a number beside a length makes the declaration invalid: the
 * padding would fall to nothing and a contained container's content reach the
 * page edge. A unitless zero is the only number a padding accepts, so it is
 * the one value that needs a unit, in whichever spelling it was written.
 */
function asMaxArgument(value: string): string {
  return UNITLESS_ZERO.test(value.trim()) ? "0px" : value;
}

/**
 * The keywords every property takes, none of which a math function can.
 *
 * `max(inherit, ...)` is invalid, so wrapping one would break the keyword on
 * every block, contained or not. A keyword is an author's explicit word about
 * the cascade, so it is written as it is: on a contained block it sets the
 * padding the way it says, as it does anywhere else.
 */
const CSS_WIDE_KEYWORDS = new Set([
  "inherit",
  "initial",
  "unset",
  "revert",
  "revert-layer",
]);

/** Whether an inline padding value can stand as an argument of `max()`. */
function takesContainInset(value: string): boolean {
  return !CSS_WIDE_KEYWORDS.has(value.trim().toLowerCase());
}

/**
 * The declarations as written into a rule: an inline padding at least the
 * containment inset.
 *
 * Every tier's inline padding (a node's own value, a block-type default, a
 * named class) is written as `max(<value>, var(--nx-contain-inset, 0px))`. The
 * padding is the same everywhere the inset is `0px`, which is every element
 * that is not contained. On a contained one the value an author or a default
 * set replaces the site's gutter as the least space at each side, and can widen
 * the inset, but it cannot take the content past the content width. CSS has no
 * other way to combine two values of one property, so the combination is
 * written into each value that might replace the containment's own.
 *
 * **A block sized by its author is not inset.** The inset is worked out from
 * the width of the box the container is laid out in, since a padding's `100%`
 * means that box and CSS cannot name an element's own width there. A contained
 * block whose `width` or `max-width` is set is narrower than that box, so the
 * rule that sets either one also sets a flag for it, `1` when the value sizes
 * the block and `0` for `auto` or `none`, which size nothing. The site sheet
 * multiplies the inset by one less the larger flag, and its
 * `margin-inline: auto` centres a sized block, whose content then fills it
 * within the gutter. One flag per property, written in the same rule, so each
 * follows its own property through every tier, breakpoint and state: an
 * override back to `auto` brings the inset back, while a `max-width` that
 * still applies keeps it off. `inherit` leaves its flag to the cascade.
 *
 * Only the emitted rule carries it: the trace records the value as it was set.
 */
export function withContainInset(
  declarations: readonly Declaration[],
  onRoot: boolean
): Declaration[] {
  const padded = declarations.map(declaration =>
    INLINE_PADDING.has(declaration.property) &&
    takesContainInset(declaration.value)
      ? {
          ...declaration,
          value: `max(${asMaxArgument(declaration.value)}, var(${CONTAIN_INSET_PROPERTY}, 0px))`,
        }
      : declaration
  );
  if (!onRoot) return padded;
  const flags = [
    ...declarations.flatMap(sizeFlag),
    ...declarations.flatMap(flowFlag),
  ];
  return flags.length === 0 ? padded : [...padded, ...flags];
}

/**
 * The flag each property that can size a block sets, for the site sheet's
 * inset: `1` while the property sizes the block, `0` while it does not.
 */
export const SIZED_FLAG_PROPERTIES: Readonly<Record<string, string>> = {
  width: "--nx-sized-width",
  "max-width": "--nx-sized-max-width",
};

/**
 * The flag a block's layout sets on its children: `1` while it lays them out
 * as flex or grid items, `0` otherwise.
 *
 * A padding's `100%` is the width of the box a block is laid out in, which for
 * a flex or grid item is the whole row, not the item's own share of it, so a
 * contained item would be inset from a box far wider than its own. The rule
 * that sets the parent's `display` also writes this on its children, at the
 * same breakpoint and state, and the site sheet treats a flagged contained
 * child as it does a sized block: centred, not inset. `initial`, `unset` and
 * the reverts give no row and clear it, and so does `inherit`, whose layout
 * no rule here can know.
 */
export const SIZED_ITEM_PROPERTY = "--nx-sized-item";

/**
 * The flag a block's own `position` sets: `1` while it is absolutely or fixed
 * positioned, `0` otherwise.
 *
 * A child taken out of the flow is not a flex or grid item, whatever its
 * parent's layout, so the site sheet reads the item flag only where this one
 * is 0. A flag of its own, set in the rule that sets the position, so each
 * follows its own property through the cascade and neither depends on which
 * of two blocks' rules comes later.
 */
export const OUT_OF_FLOW_PROPERTY = "--nx-out-of-flow";

/** The positions that take a block out of the flow. */
const OUT_OF_FLOW = new Set(["absolute", "fixed"]);

/** The flag a block's own `position` sets, if it sets one. */
function flowFlag(declaration: Declaration): Declaration[] {
  if (declaration.property !== "position") return [];
  const value = declaration.value.trim().toLowerCase();
  if (value === "inherit") return [];
  return [
    {
      property: OUT_OF_FLOW_PROPERTY,
      value: OUT_OF_FLOW.has(value) ? "1" : "0",
    },
  ];
}

/**
 * The flag a block's `flex-direction` sets on its children: `1` in a column,
 * `0` in a row. A flex column's items stretch across its whole width, which
 * is the width the inset is measured from, so a contained item there keeps
 * its inset; the site sheet reads the item flag only where this one is 0.
 */
export const COLUMN_FLOW_PROPERTY = "--nx-column-flow";

/** The layouts whose children are flex or grid items. */
const ROW_LAYOUTS = new Set(["flex", "inline-flex", "grid", "inline-grid"]);

/** The flag a block's own `display` sets on its children, if it sets one. */
function itemFlag(declarations: readonly Declaration[]): Declaration[] {
  const flags: Declaration[] = [];
  const display = declarations.findLast(d => d.property === "display");
  if (display !== undefined) {
    // `inherit` takes a layout no rule here can know, so it is read as no
    // row: the inset is then never lost, at the most an item over-padded.
    const value = display.value.trim().toLowerCase();
    flags.push({
      property: SIZED_ITEM_PROPERTY,
      value: ROW_LAYOUTS.has(value) ? "1" : "0",
    });
  }
  const direction = declarations.findLast(d => d.property === "flex-direction");
  if (direction !== undefined) {
    flags.push({
      property: COLUMN_FLOW_PROPERTY,
      value: direction.value.trim().toLowerCase().startsWith("column")
        ? "1"
        : "0",
    });
  }
  return flags;
}

/**
 * Values of those properties that size nothing. Neither is inherited, so
 * `initial`, `unset` and the reverts resolve to `auto` or `none` as well.
 */
const UNSIZED = new Set([
  "auto",
  "none",
  "initial",
  "unset",
  "revert",
  "revert-layer",
]);

/** The flag a declaration sets, if it is one that can size a block. */
function sizeFlag(declaration: Declaration): Declaration[] {
  const flag = SIZED_FLAG_PROPERTIES[declaration.property];
  if (flag === undefined) return [];
  const value = declaration.value.trim().toLowerCase();
  // `inherit` takes the parent's size, which no rule here can know.
  if (value === "inherit") return [];
  return [{ property: flag, value: UNSIZED.has(value) ? "0" : "1" }];
}

/**
 * The rule that flags a block's children, beside the one that sets its layout:
 * `children` selects them, under the weightless anchor when the tier has one,
 * and inside the same at-rule.
 * Only a block's own root rule sets its layout, so a descendant or a routed
 * part's rule flags nothing.
 */
export function childFlagRule(
  rule: {
    readonly descendant: string;
    readonly selector?: string;
    readonly declarations: readonly Declaration[];
  },
  children: string,
  weightlessAnchor: string | undefined,
  atRule: string | undefined
):
  | { atRule?: string; selector: string; declarations: Declaration[] }
  | undefined {
  if (rule.descendant !== "" || rule.selector !== undefined) return undefined;
  const declarations = itemFlag(rule.declarations);
  if (declarations.length === 0) return undefined;
  return {
    ...(atRule === undefined ? {} : { atRule }),
    selector:
      weightlessAnchor === undefined
        ? children
        : `${weightlessAnchor} :where(${children})`,
    declarations,
  };
}
