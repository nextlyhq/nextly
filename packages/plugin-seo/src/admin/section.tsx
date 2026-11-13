/**
 * What every screen of the SEO section shares: its trail in the admin's top
 * bar (SEO / Pages / Import), a link that moves within the admin without
 * reloading it, and the screen left at an old address, which sends a
 * bookmark on to the screen that replaced it.
 *
 * @module admin/section
 */
import {
  Breadcrumbs,
  navigateTo,
  type BreadcrumbItem,
} from "@nextlyhq/plugin-sdk/admin";
import {
  useEffect,
  type AnchorHTMLAttributes,
  type JSX,
  type MouseEvent,
} from "react";

import { PAGES_PAGE_HREF } from "../code-pages/contract";
import { INSPECT_PAGE_HREF, OVERVIEW_PAGE_HREF } from "../overview/contract";

/** One step of a trail after SEO: its name, and where it leads, if back. */
export interface TrailStep {
  label: string;
  href?: string;
}

/**
 * The trail from SEO to the screen: `SEO / <step> / …`, the last step the
 * screen itself. Drawn in the top bar, where every admin page draws its own.
 */
export function SeoTrail({
  steps,
}: {
  steps: readonly TrailStep[];
}): JSX.Element {
  const items: BreadcrumbItem[] = [
    { label: "SEO", href: OVERVIEW_PAGE_HREF },
    ...steps.map(step =>
      step.href === undefined
        ? { label: step.label }
        : { label: step.label, href: step.href }
    ),
  ];
  return <Breadcrumbs items={items} />;
}

/** Pages, as a step back on a trail. */
export const PAGES_STEP: TrailStep = { label: "Pages", href: PAGES_PAGE_HREF };

/**
 * `Screen` with its trail set: for a screen drawn before the section had
 * one, so its own code is left as it is.
 */
export function withTrail(
  Screen: () => JSX.Element,
  steps: readonly TrailStep[]
): () => JSX.Element {
  function Trailed(): JSX.Element {
    return (
      <>
        <SeoTrail steps={steps} />
        <Screen />
      </>
    );
  }
  Trailed.displayName = `withTrail(${Screen.name})`;
  return Trailed;
}

/** Whether a click asks for a new tab or window, which the browser handles. */
function opensElsewhere(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

/**
 * A link to another admin page: a real link, so it can be opened in a new
 * tab or copied, that moves within the admin on a plain click.
 */
export function AdminLink({
  href,
  onClick,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }): JSX.Element {
  return (
    <a
      {...props}
      href={href}
      onClick={event => {
        onClick?.(event);
        if (event.defaultPrevented || opensElsewhere(event)) return;
        event.preventDefault();
        navigateTo(href);
      }}
    />
  );
}

/**
 * Sends the reader on to `to`, standing in for the old address in the
 * history, so Back does not land on it and move them forward again.
 */
function useMovedTo(to: string | undefined): void {
  useEffect(() => {
    if (to !== undefined) navigateTo(to, { replace: true });
  }, [to]);
}

/** The old address `received?address=`: Inspect for that page, else Pages. */
export function receivedMovedTo(search: string): string {
  const address = new URLSearchParams(search).get("address");
  return address === null || address === ""
    ? PAGES_PAGE_HREF
    : `${INSPECT_PAGE_HREF}?address=${encodeURIComponent(address)}`;
}

/** The old "What search engines received" address: Inspect, or Pages. */
export function SeoReceivedMoved(): null {
  useMovedTo(
    typeof window === "undefined"
      ? undefined
      : receivedMovedTo(window.location.search)
  );
  return null;
}

/** Where the old Bulk edit address leads: Pages, in Edit mode. */
const PAGES_EDIT_HREF: string = `${PAGES_PAGE_HREF}?mode=edit`;

/** The old Bulk edit address: Pages in Edit mode, which took it over. */
export function SeoBulkMoved(): null {
  useMovedTo(typeof window === "undefined" ? undefined : PAGES_EDIT_HREF);
  return null;
}
