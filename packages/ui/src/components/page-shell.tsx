import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { Children, forwardRef, Fragment, isValidElement } from "react";

import { devWarnOnce } from "../lib/dev-warn";
import { cn } from "../lib/utils";

/** @experimental */
export interface PageShellProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Which measure the content column is bounded to. `full` removes the cap so
   * the column takes whatever the panel gives it, while KEEPING the gutter — a
   * full-width page is still inset from the panel's edge.
   */
  width?: "form" | "wide" | "full";
}

/**
 * Declared as a lookup rather than branched at the call site so the three arms
 * are one list. A `switch` here would let a fourth width be added to the type
 * and forgotten in the mapping, which the checker cannot see through a
 * `default` arm.
 */
/**
 * `CSSProperties` models only the properties csstype knows about, so a CSS
 * custom property is not assignable to it.
 *
 * Naming the single property this component sets keeps the object CHECKED: a
 * typo in the property name is still a compile error, and the value still has
 * to be a string. The blanket `as CSSProperties` assertion used elsewhere in
 * this repo would accept a misspelled custom property silently, which for a
 * value the grid template reads by name is the failure worth preventing — the
 * layout would fall back to its default measure and nothing would say so.
 */
type ShellStyle = CSSProperties & Record<"--nx-shell-measure", string>;

/**
 * Whether anything that RENDERS as a direct child is a bare string or number.
 *
 * CSS Grid wraps such a child in an ANONYMOUS grid item, and an anonymous item
 * matches no selector — so `.nx-page-shell > *` cannot reach it and it is
 * auto-placed into the first available track, which is a gutter. It renders,
 * it looks finished, and it sits outside the measure.
 *
 * A fragment has to be descended into rather than counted as one child. React
 * removes it from the DOM, so ITS children are what become the shell's grid
 * items, while `Children.toArray` returns the fragment as a single element and
 * stops there. Recursion, not a single pass, is what makes the two agree.
 *
 * TypeScript cannot express the constraint: `ReactNode` admits strings by
 * design, and narrowing `children` to elements would reject the valid fragments
 * and arrays this walks. So it is checked at runtime and reported in
 * development, the same way this kit reports the other contracts its types
 * cannot carry.
 */
function hasBareTextChild(children: ReactNode): boolean {
  return Children.toArray(children).some(child => {
    if (typeof child === "string" || typeof child === "number") return true;
    // The generic narrows `child.props` to a shape with a typed `children`,
    // which is what lets the recursion read it without asserting.
    if (isValidElement<{ children?: ReactNode }>(child)) {
      return child.type === Fragment && hasBareTextChild(child.props.children);
    }
    return false;
  });
}

const MEASURE: Record<NonNullable<PageShellProps["width"]>, string> = {
  form: "var(--nx-measure-form)",
  wide: "var(--nx-measure-wide)",
  full: "100%",
};

/**
 * The page's inset and measure, owned in one place and spent as GRID COLUMNS.
 *
 * This replaces a pairing in which an outer container padded the panel and an
 * inner one padded again while capping the width. That shape had three
 * defects, and all three are structural rather than cosmetic:
 *
 *  - The two insets ADDED, because padding is not something a descendant can
 *    cancel. Measured on the settings page, the header sat at x=360 and the
 *    form card at x=384 — a 24px disagreement between two elements that are
 *    supposed to share a left edge. Here the inset is a column, so there is one
 *    declaration and no second site to disagree with it.
 *  - The measure was applied INSIDE each form component, so anything the page
 *    rendered beside that form escaped it. Not hypothetical: the webhook edit
 *    page renders its signing-secret block as a sibling of the form, and it ran
 *    the full panel width while the form was centred. With the page owning the
 *    shell, a sibling is inside the measure by default and leaves it only by
 *    saying `Bleed`.
 *  - Centring was `mx-auto` on a max-width box, which does nothing at panel
 *    widths where the cap does not bind — and at the measured 952px panel the
 *    56rem cap never binds at all, so the apparent centring was only the two
 *    paddings. `justify-content: center` on the grid centres the column at
 *    every width.
 *
 * Vertical padding stays ordinary `padding-block`: it is not in tension with
 * the columns, and keeping it here means one component answers the whole of
 * "how far is content from the panel's edge".
 * @experimental
 */
export const PageShell = forwardRef<HTMLDivElement, PageShellProps>(
  ({ width = "form", className, children, style, ...props }, ref) => {
    // The caller's `style` is spread FIRST so the measure this component
    // computes from `width` wins over a hand-written `--nx-shell-measure`.
    // Two sources for one value would otherwise disagree silently, and
    // `width` is the supported way to choose it.
    const shellStyle: ShellStyle = {
      ...style,
      "--nx-shell-measure": MEASURE[width],
    };

    devWarnOnce(
      !hasBareTextChild(children),
      "PageShell: a direct child is bare text. CSS Grid wraps it in an anonymous grid item, " +
        "which no selector can reach, so it is placed in the gutter rather than the content " +
        "column and sits outside the page's measure. Wrap it in an element — a `<p>`, or the " +
        "section it belongs to."
    );

    return (
      <div
        ref={ref}
        data-slot="page-shell"
        // The measure travels as a custom property rather than as a utility
        // class because the grid template reads it: one `grid-template-columns`
        // serves all three widths, instead of three near-identical templates
        // that would each have to be corrected together.
        style={shellStyle}
        className={cn("nx-page-shell py-8", className)}
        {...props}
      >
        {children}
      </div>
    );
  }
);
PageShell.displayName = "PageShell";

/** @experimental */
export type BleedProps = HTMLAttributes<HTMLDivElement>;

/**
 * Opts one child out of the measure, edge to edge across the shell's gutter.
 *
 * The sanctioned form of something that previously only happened by accident.
 * A wide data table, a delivery log or a toolbar declares that it wants the
 * full panel, so a reviewer can see the intent — and, just as usefully, a block
 * that is merely in the wrong place no longer LOOKS like a deliberate
 * full-bleed.
 *
 * Valid only as a DIRECT child of `PageShell`. The `full-start`/`full-end`
 * lines are named on the shell's own grid, so they are in scope for its
 * children and nowhere else; nested inside a `FormSection` this renders a plain
 * block and the `grid-column` is inert. That is a real constraint rather than a
 * stylistic preference, and `page-shell.test.tsx` pins both halves: that a
 * `Bleed` rendered directly under the shell is its child, and that one nested a
 * level deeper does NOT receive the full column.
 *
 * It forwards its ref and any div attributes for the same reason: a consumer
 * cannot reach for the usual remedy of wrapping it, because a wrapper is
 * precisely what makes it stop working.
 * @experimental
 */
export const Bleed = forwardRef<HTMLDivElement, BleedProps>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="bleed"
      className={cn("nx-bleed", className)}
      {...props}
    >
      {children}
    </div>
  )
);
Bleed.displayName = "Bleed";
