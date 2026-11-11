import { Slot } from "@radix-ui/react-slot";
import {
  cloneElement,
  forwardRef,
  isValidElement,
  type AnchorHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
  type ForwardRefExoticComponent,
  type PropsWithoutRef,
  type RefAttributes,
} from "react";

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
  /**
   * A row of tabs under the title, for a page whose sections each have their
   * own address (`PageTabs` with a `PageTab` per section). Rendered across the
   * header's full width, below the title and actions.
   */
  tabs?: ReactNode;
  /**
   * The `id` of the title's `h1`, for a region that names itself by the page's
   * title (`aria-labelledby` on the page's form).
   */
  titleId?: string;
  /** A leading visual, such as a plugin's icon tile, before the title. */
  media?: ReactNode;
  /** Small chips beside the title: a version, a status, a category. */
  meta?: ReactNode;
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
export const PageHeader: ForwardRefExoticComponent<
  PropsWithoutRef<PageHeaderProps> & RefAttributes<HTMLElement>
> = forwardRef<HTMLElement, PageHeaderProps>(
  (
    {
      title,
      description,
      breadcrumbs,
      actions,
      tabs,
      media,
      meta,
      titleId,
      className,
      ...props
    },
    ref
  ) => (
    <header
      ref={ref}
      data-slot="page-header"
      className={cn("mb-8", className)}
      {...props}
    >
      {breadcrumbs ? (
        // Collapses when the breadcrumb is drawn elsewhere (the admin draws it
        // in its top bar), so the header keeps no empty row above its title.
        <div className="mb-6 empty:hidden">{breadcrumbs}</div>
      ) : null}

      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-start gap-4">
          {media ? <div className="shrink-0">{media}</div> : null}
          <div className="min-w-0 space-y-1">
            {/* The title and its chips wrap together, so a long name pushes
              the chips onto the next line instead of squeezing itself. */}
            <div className="flex flex-wrap items-center gap-3">
              <h1 id={titleId} className="text-xl font-semibold tracking-tight">
                {title}
              </h1>
              {meta}
            </div>
            {/* Muted rather than a faint tint of the primary: the latter was tried
              and did not meet contrast for secondary text. */}
            {description ? (
              // A block rather than a <p>, so a description may hold its own
              // paragraphs (a plugin's summary, then its author).
              <div
                data-slot="page-header-description"
                className="mt-1 text-sm font-normal text-muted-foreground"
              >
                {description}
              </div>
            ) : null}
          </div>
        </div>

        {/* Each optional slot is omitted rather than rendered empty. An empty
            <p> still occupies a line and still separates the title from what
            follows, so a title-only page would not keep the spacing of a page
            that never had a description. */}
        {actions ? (
          <div className="flex items-center gap-3">{actions}</div>
        ) : null}
      </div>

      {/* Tabs sit under the title row and span the header, so a page with
          sections reads title, then where you are within it. */}
      {tabs ? <div className="mt-6">{tabs}</div> : null}
    </header>
  )
);
PageHeader.displayName = "PageHeader";

/** @experimental */
export interface PageTabsProps extends HTMLAttributes<HTMLElement> {
  /** What the sections are, for assistive technology (`"Form sections"`). */
  label: string;
}

/**
 * The tab row of a page whose sections each have their own address. A labelled
 * `nav` of links rather than an ARIA tablist: every tab changes the URL, and a
 * link inside `role="tab"` breaks the tabs pattern's keyboard and announcement
 * contract. The current section is marked with `aria-current="page"` by
 * `PageTab`.
 * @experimental
 */
export const PageTabs: ForwardRefExoticComponent<
  PropsWithoutRef<PageTabsProps> & RefAttributes<HTMLElement>
> = forwardRef<HTMLElement, PageTabsProps>(
  ({ label, className, children, ...props }, ref) => (
    <nav
      ref={ref}
      aria-label={label}
      data-slot="page-tabs"
      className={cn(
        "flex gap-1 overflow-x-auto border-b border-border",
        className
      )}
      {...props}
    >
      {children}
    </nav>
  )
);
PageTabs.displayName = "PageTabs";

/**
 * The anchor attributes a tab passes through. `aria-current` is not among
 * them: it is derived from `current`, so the tab is announced as current
 * exactly when it is drawn as current.
 */
type PageTabAnchorProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "aria-current" | "href"
>;

/**
 * A tab changes the address, so it always has a destination: its own `href`,
 * or, with `asChild`, the router link it wraps.
 * @experimental
 */
export type PageTabProps = PageTabAnchorProps & {
  /** Whether this tab is the section being shown. */
  current?: boolean;
} & (
    | {
        /** Where the tab leads. */
        href: string;
        asChild?: false;
      }
    | {
        /**
         * Render the caller's own link element (a router link) in place of
         * an `<a>`; that element carries the destination. The tab keeps its
         * look and its `aria-current`.
         */
        asChild: true;
        href?: undefined;
      }
  );

/**
 * One section of a `PageTabs` row: a link, underlined when current.
 * @experimental
 */
export const PageTab: ForwardRefExoticComponent<
  PropsWithoutRef<PageTabProps> & RefAttributes<HTMLAnchorElement>
> = forwardRef<HTMLAnchorElement, PageTabProps>(
  (
    { current = false, asChild = false, className, children, ...props },
    ref
  ) => {
    const Comp = asChild ? Slot : "a";
    const marker = current ? "page" : undefined;
    // `Slot` lets the wrapped element's own props win over the ones set here,
    // so a router link carrying its own `aria-current` would be announced by
    // that instead of by `current`. Setting the marker on the child itself
    // keeps `current` the one source of it.
    const content =
      asChild && isValidElement<{ "aria-current"?: string }>(children)
        ? cloneElement(children, { "aria-current": marker })
        : children;
    return (
      <Comp
        // The caller's attributes first, so nothing they pass can replace the
        // current marker or the slot this component sets.
        {...props}
        ref={ref}
        data-slot="page-tab"
        aria-current={marker}
        className={cn(
          // The current tab's underline sits on the row's own bottom border,
          // so the row reads as one rule with one section marked.
          "-mb-px inline-flex h-9 shrink-0 items-center border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors",
          current
            ? "border-foreground text-foreground"
            : "border-transparent text-muted-foreground hover:text-foreground",
          className
        )}
      >
        {content}
      </Comp>
    );
  }
);
PageTab.displayName = "PageTab";
