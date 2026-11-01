/**
 * Loading a page's code ahead of a click: the seam between links and routes.
 *
 * A link knows an address; only the router knows which page it leads to. The
 * router registers a preloader here as it loads, and a link calls
 * `preloadRoute` on hover or focus. Kept free of imports, so a link reaching
 * it can't pull the page registry, and with it every page, into a cycle.
 */

/** Starts fetching the page an admin address leads to. */
type RoutePreloader = (href: string) => void;

let preloader: RoutePreloader | null = null;

/** Called once by the router, which knows which page each address leads to. */
export function setRoutePreloader(next: RoutePreloader): void {
  preloader = next;
}

/** Starts fetching the page `href` leads to, when anything knows it. */
export function preloadRoute(href: string): void {
  preloader?.(href);
}
