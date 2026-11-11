import {
  forwardRef,
  type HTMLAttributes,
  type ForwardRefExoticComponent,
  type PropsWithoutRef,
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
 * - `editor`: full width; the editor draws its own field column and side
 *   panel inside it.
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
  Exclude<PageType, "workspace" | "list">,
  Pick<PageShellProps, "width" | "align">
> = {
  form: { width: "form", align: "start" },
  editor: { width: "full", align: "start" },
};

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
  ({ type, className, children, ...props }, ref) => {
    if (type === "workspace" || type === "list") {
      return (
        <div
          ref={ref}
          data-slot="page-frame"
          data-page-type={type}
          // A list is inset by the same gutter a shell spends as columns
          // (`.nx-page-pad` reads `--nx-gutter`, which steps with the panel);
          // a workspace draws its own surface and takes none.
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
