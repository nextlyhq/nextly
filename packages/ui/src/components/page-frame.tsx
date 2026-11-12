import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  type HTMLAttributes,
  type ForwardRefExoticComponent,
  type JSX,
  type PropsWithoutRef,
  type ReactNode,
  type RefAttributes,
} from "react";

import { cn } from "../lib/utils";

import { PageShell, type PageShellProps } from "./page-shell";

/**
 * The four kinds of page the admin draws, each with one width.
 *
 * - `list`: full width within the gutter (entries, users, keys, webhooks),
 *   drawn as a padded block rather than a grid, so a page that hands its own
 *   height down through `height: 100%` (a split pane, a media grid) keeps it.
 * - `form`: a 56rem column under the page's left edge (settings, create and
 *   edit pages).
 * - `editor`: full width with no gutter and no padding: the editor draws its
 *   own field column (inset by the gutter, and measured) and a side panel that
 *   meets the window's edge.
 * - `workspace`: no gutter and no padding, for a page that lays out its own
 *   surface (the dashboard, a builder canvas).
 * @experimental
 */
export type PageType = "list" | "form" | "editor" | "workspace";

/**
 * The shell each type draws with. A table rather than a branch per type, so
 * the four widths are read in one place and a fifth type is one row.
 */
const SHELL_FOR: Record<
  Exclude<PageType, "workspace" | "list" | "editor">,
  Pick<PageShellProps, "width" | "align">
> = {
  form: { width: "form", align: "start" },
};

/**
 * How a frame tells the listener above it that the page draws its own frame:
 * it claims with its type on mount and releases on unmount. `null` where no
 * listener is above, and inside a frame, so only a page's outermost frame
 * speaks for the page.
 */
type ClaimFrame = (type: PageType) => () => void;

const PageFrameClaimContext = createContext<ClaimFrame | null>(null);

/** @experimental */
export interface PageFrameListenerProps {
  /**
   * Called with the type of the outermost `PageFrame` drawn inside, as it
   * mounts or changes, and with `null` once none is left.
   */
  onFrame: (type: PageType | null) => void;
  children?: ReactNode;
}

/**
 * Hears whether the content inside it draws a `PageFrame`, for a host that
 * gives unframed content a frame of its own and must not frame content twice.
 * Read from the frames themselves rather than from what the content is called,
 * so a page that draws a frame through any component is heard the same way.
 *
 * The frame claims in a layout effect, so a host that changes its own markup
 * in answer does so before the first paint.
 * @experimental
 */
export function PageFrameListener({
  onFrame,
  children,
}: PageFrameListenerProps): JSX.Element {
  // The latest callback, read when a frame claims, so the claim function stays
  // one value for the listener's life and no frame claims again on a render.
  const onFrameRef = useRef(onFrame);
  useLayoutEffect(() => {
    onFrameRef.current = onFrame;
  });
  // Every frame claiming at once, in mount order; the page's frame is the
  // last one standing, and none left answers `null`.
  const claims = useRef<{ type: PageType }[]>([]);
  const claim = useCallback<ClaimFrame>(type => {
    const entry = { type };
    claims.current = [...claims.current, entry];
    onFrameRef.current(type);
    return () => {
      claims.current = claims.current.filter(other => other !== entry);
      onFrameRef.current(
        claims.current[claims.current.length - 1]?.type ?? null
      );
    };
  }, []);
  return (
    <PageFrameClaimContext.Provider value={claim}>
      {children}
    </PageFrameClaimContext.Provider>
  );
}

/** @experimental */
export interface PageFrameProps extends HTMLAttributes<HTMLDivElement> {
  /** Which kind of page this is; it decides the width. */
  type: PageType;
}

/**
 * A page's frame: the width and gutter its type gives it. A page says what it
 * is, and the frame decides how wide that is, so two pages of one type can
 * never drift apart.
 * @experimental
 */
export const PageFrame: ForwardRefExoticComponent<
  PropsWithoutRef<PageFrameProps> & RefAttributes<HTMLDivElement>
> = forwardRef<HTMLDivElement, PageFrameProps>(
  ({ type, className, children: content, ...props }, ref) => {
    // Tell a listener above, when there is one, that this page is framed, and
    // hide the listener from frames inside this one: the page's own frame is
    // its outermost.
    const claim = useContext(PageFrameClaimContext);
    useLayoutEffect(() => claim?.(type), [claim, type]);
    const children = (
      <PageFrameClaimContext.Provider value={null}>
        {content}
      </PageFrameClaimContext.Provider>
    );
    if (type !== "form") {
      return (
        <div
          ref={ref}
          data-slot="page-frame"
          data-page-type={type}
          // A list is inset by the same gutter a shell spends as columns
          // (`.nx-page-pad` reads `--nx-gutter`, which steps with the panel);
          // a workspace draws its own surface and takes none, and an editor
          // insets its own field column so its panel can meet the edge.
          className={cn("min-w-0", type === "list" && "nx-page-pad", className)}
          {...props}
        >
          {children}
        </div>
      );
    }
    return (
      <PageShell
        ref={ref}
        data-page-type={type}
        {...SHELL_FOR[type]}
        className={className}
        {...props}
      >
        {children}
      </PageShell>
    );
  }
);
PageFrame.displayName = "PageFrame";
