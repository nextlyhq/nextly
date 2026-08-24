import type { CSSProperties, HTMLAttributes } from "react";
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react";

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

/**
 * A shell already owns the inset somewhere up the tree.
 *
 * Nesting is what would otherwise reintroduce the exact defect this primitive
 * exists to end: an outer shell places the inner one in its content column and
 * the inner grid adds a second pair of gutter tracks, so content is inset
 * twice. Relying on every caller to know whether an ancestor layout already
 * rendered a shell is the kind of unwritten precondition that holds until one
 * page is composed differently.
 */
const InsideShell = createContext(false);

/**
 * Whether a direct child has been taken out of the grid by `display: contents`.
 *
 * Such a child generates no box, so the `grid-column` rule has nothing to
 * apply to, while ITS children are promoted into this grid and match no
 * selector — they auto-place from the first track, which is a gutter. The
 * element is present and correctly classed, so nothing about the markup says
 * the content left the measure.
 */
function hasDisplayContentsChild(shell: HTMLElement): boolean {
  return Array.from(shell.children).some(
    child => getComputedStyle(child).display === "contents"
  );
}

/**
 * Declared as a lookup rather than branched at the call site so the three arms
 * are one list. A `switch` here would let a fourth width be added to the type
 * and forgotten in the mapping, which the checker cannot see through a
 * `default` arm.
 */
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
        // A callback ref's RETURN is the caller's cleanup under React 19, and
        // React runs it instead of calling the ref again with null. Discarding
        // it here would silently drop, say, an observer's disconnect. Passing it
        // straight through is also correct under the React 18 half of this
        // package's peer range, where such a ref returns nothing.
        if (typeof ref === "function") return ref(node);
        if (ref) ref.current = node;
      },
      [ref]
    );

    const nested = useContext(InsideShell);

    // Gated on the runtime up front so neither the DOM read nor the observer
    // below exists in production, not merely their console output.
    useEffect(() => {
      if (!isDevelopmentRuntime()) return;
      const shell = shellRef.current;
      if (!shell) return;

      const check = () => {
        devWarnOnce(
          !hasBareTextChild(shell),
          "PageShell: a direct child renders as bare text. CSS Grid wraps it in an anonymous " +
            "grid item, which no selector can reach, so it is placed in the gutter rather than " +
            "the content column and sits outside the page's measure. Wrap it in an element — " +
            "a `<p>`, or the section it belongs to."
        );
        devWarnOnce(
          !hasDisplayContentsChild(shell),
          "PageShell: a direct child has `display: contents`, so it generates no grid item and " +
            "the content-column rule has nothing to apply to. Its own children are promoted " +
            "into this grid, match no selector, and are placed from the gutter onward. Give " +
            "the child a box, or move `display: contents` inside it."
        );
      };

      check();

      // A child that swaps an element for text through its OWN state does not
      // re-render this component, so the effect above would never run again and
      // the defect would arrive unreported. Watching the child list is what
      // makes the check a property of the rendered DOM rather than of when this
      // component happened to render.
      //
      // `childList` ALONE, deliberately, and this is the boundary of the check
      // rather than an oversight. A child that stays mounted and mutates its
      // own class or style to `display: contents` is not reported, because
      // catching it needs `attributes` with `subtree: true` — MutationObserver
      // cannot scope attributes to direct children — which fires on every
      // descendant class change anywhere in the page. In an admin full of hover
      // states, transitions and editor chrome that is continuous, and each
      // notification re-runs `getComputedStyle` over every direct child.
      //
      // This is an advisory development warning: a miss costs only the report,
      // while a check that makes every developer's page churn is one that gets
      // deleted, taking its true positives with it. The mount-time pass above
      // still catches `display: contents` present at first render, which is how
      // it is almost always written.
      const observer = new MutationObserver(check);
      observer.observe(shell, { childList: true });
      return () => {
        observer.disconnect();
      };
    });

    // The caller's `style` is spread FIRST so the measure this component
    // computes from `width` wins over a hand-written `--nx-shell-measure`.
    // Two sources for one value would otherwise disagree silently, and
    // `width` is the supported way to choose it.
    const shellStyle: ShellStyle = {
      ...style,
      "--nx-shell-measure": MEASURE[width],
    };

    // A nested shell contributes NO second grid: the outer one already inset
    // this content, and adding another pair of gutter tracks is precisely the
    // double inset this primitive exists to make unrepresentable. It renders a
    // plain box so its children stay in the outer measure, and says so, because
    // the redundant shell is what the author should remove.
    if (nested) {
      devWarnOnce(
        false,
        "PageShell: an ancestor already renders a PageShell. A nested one would add a second " +
          "pair of gutter tracks and inset its content twice, so this one renders as a plain " +
          "box and its `width` is ignored. Remove it, or move the outer shell."
      );
      return (
        <div
          ref={attachRef}
          data-slot="page-shell-nested"
          className={className}
          // The caller's own `style`, NOT the computed one. Only `width` stops
          // meaning anything here, because the measure it selects has no grid
          // to select a track in; everything else the caller wrote — spacing,
          // positioning, their own custom properties — is theirs and must not
          // vanish because an ancestor elsewhere in the tree added a shell.
          style={style}
          {...props}
        >
          {children}
        </div>
      );
    }

    return (
      <InsideShell.Provider value={true}>
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
      </InsideShell.Provider>
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
