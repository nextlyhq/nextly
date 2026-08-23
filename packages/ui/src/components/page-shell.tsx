import type { CSSProperties, HTMLAttributes } from "react";
import { forwardRef, useCallback, useEffect, useRef } from "react";

import { devWarnOnce, isDevelopmentRuntime } from "../lib/dev-warn";
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
 * Whether the shell has a direct child TEXT node with visible content.
 *
 * Read from the DOM after mount rather than by walking `children` before it,
 * because the element tree cannot answer this question. A component child is
 * opaque to a pre-render walk — `() => "hello"` is an element whose type is a
 * function, and what it returns is decided at render — so a traversal can only
 * ever recognise the shapes someone thought to enumerate: a bare literal, then
 * a fragment, then a component, then a component returning a fragment. The
 * rendered DOM is where the answer already exists, and it covers every shape at
 * once.
 *
 * Whitespace-only nodes are ignored: JSX routinely leaves them between elements
 * and CSS Grid does not make a grid item of one.
 */
function hasBareTextChild(shell: HTMLElement): boolean {
  return Array.from(shell.childNodes).some(
    node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim() !== ""
  );
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
 *  - A measure applied INSIDE a form component lets anything the page renders
 *    beside that form escape it. With the page owning the shell, a sibling is
 *    inside the measure by default and leaves it only by saying `Bleed`.
 *  - Centring by `mx-auto` on a max-width box does nothing at panel widths
 *    where the cap does not bind. Here the two outer tracks are equal and
 *    flexible, so the content column is centred at every width and no
 *    `justify-content` is declared — with flexible tracks the grid fills its
 *    container and there is no free space for one to distribute.
 *
 * Vertical padding stays ordinary `padding-block`: it is not in tension with
 * the columns, and keeping it here means one component answers the whole of
 * "how far is content from the panel's edge".
 * @experimental
 */
export const PageShell = forwardRef<HTMLDivElement, PageShellProps>(
  ({ width = "form", className, children, style, ...props }, ref) => {
    // The shell's own handle on its node, kept alongside whatever ref the
    // caller passed so the development check below can read the rendered DOM
    // without taking the ref away from them.
    const shellRef = useRef<HTMLDivElement | null>(null);
    const attachRef = useCallback(
      (node: HTMLDivElement | null) => {
        shellRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      },
      [ref]
    );

    // Gated on the runtime up front so the DOM read itself never happens in
    // production, not merely its console output.
    useEffect(() => {
      if (!isDevelopmentRuntime()) return;
      const shell = shellRef.current;
      if (!shell) return;
      devWarnOnce(
        !hasBareTextChild(shell),
        "PageShell: a direct child renders as bare text. CSS Grid wraps it in an anonymous " +
          "grid item, which no selector can reach, so it is placed in the gutter rather than " +
          "the content column and sits outside the page's measure. Wrap it in an element — a " +
          "`<p>`, or the section it belongs to."
      );
    });

    // The caller's `style` is spread FIRST so the measure this component
    // computes from `width` wins over a hand-written `--nx-shell-measure`.
    // Two sources for one value would otherwise disagree silently, and
    // `width` is the supported way to choose it.
    const shellStyle: ShellStyle = {
      ...style,
      "--nx-shell-measure": MEASURE[width],
    };

    return (
      <div
        ref={attachRef}
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
