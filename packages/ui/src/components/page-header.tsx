import type { HTMLAttributes, ReactNode } from "react";
import { forwardRef } from "react";

import { cn } from "../lib/utils";

/** @experimental */
export interface PageHeaderProps
  extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** The page's name, rendered as its `h1`. */
  title: string;
  /**
   * A sentence under the title. A `ReactNode` rather than a string because a
   * description carrying a link or an inline code span is ordinary here, and
   * typing it narrowly would push those pages back to hand-rolling the header.
   */
  description?: ReactNode;
  /** The trail above the title. The page supplies it; this only places it. */
  breadcrumbs?: ReactNode;
  /** Page-level actions, trailing the title on one line where there is room. */
  actions?: ReactNode;
}

/**
 * A page's own identity — its trail, its name, its one-line summary and its
 * actions — rendered once instead of at every page that needs one.
 *
 * Every value arrives as a PROP, and that is the point rather than an
 * implementation detail. The markup this replaces was written out by hand on 22
 * pages, and the settings pages took their title from a ~130-line chain that
 * matched `window.location.pathname` in a file none of them import. Both are
 * the same defect from opposite ends: a page knows what it is, and nothing let
 * it say so — so the title lived either in 22 copies or in one foreign file
 * that had to be edited whenever a route was added.
 *
 * The route registry already made this decision for the sidebar. A private
 * route must DECLARE the rail section it belongs to, because the sidebar reads
 * that declaration rather than matching the URL, which makes a route added
 * without one a compile error instead of a page that silently highlights the
 * wrong entry. A title derived from a pathname is the same defect in the half
 * nobody had covered.
 *
 * It also makes a plugin's page indistinguishable from a first-party one: a
 * plugin cannot add a branch to an if-chain it does not ship, but it can pass a
 * prop.
 * @experimental
 */
export const PageHeader = forwardRef<HTMLElement, PageHeaderProps>(
  ({ title, description, breadcrumbs, actions, className, ...props }, ref) => (
    <header
      ref={ref}
      data-slot="page-header"
      className={cn("mb-8", className)}
      {...props}
    >
      {breadcrumbs ? <div className="mb-6">{breadcrumbs}</div> : null}

      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {/* Muted rather than a faint tint of the primary: the latter was tried
              and did not meet contrast for secondary text. */}
          {description ? (
            <p className="mt-1 text-sm font-normal text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>

        {/* Each optional slot is omitted rather than rendered empty. An empty
            <p> still occupies a line and still separates the title from what
            follows, so a title-only page would not keep the spacing of a page
            that never had a description. */}
        {actions ? (
          <div className="flex items-center gap-3">{actions}</div>
        ) : null}
      </div>
    </header>
  )
);
PageHeader.displayName = "PageHeader";
