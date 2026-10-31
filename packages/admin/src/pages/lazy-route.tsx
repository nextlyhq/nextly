/**
 * lazyRoute(loader) — a page whose chunk is fetched when the route renders,
 * and fetched AGAIN when the visitor asks.
 *
 * Not React.lazy, on purpose: a lazy component caches a rejected import, so
 * one failed fetch would rethrow on every later render and leave the route
 * broken for the session. This wrapper holds the fetch in state — the first
 * render shows the route's loading state, a failure shows its recoverable
 * error with a retry that issues a fresh import(), and a resolved module
 * renders as the page. The resolved module is remembered, so returning to a
 * route whose chunk already arrived starts at the page, not the spinner.
 * The shell and navigation live outside the page, so all three states leave
 * them untouched.
 *
 * A route can also be fetched ahead with `preload()`, which a link calls on
 * hover or focus: the visit then joins that fetch rather than starting its
 * own, so the click doesn't wait for the download.
 */

import { Button } from "@nextlyhq/ui";
import { type ComponentType, useEffect, useState } from "react";

import { Loader2 } from "@admin/components/icons";
import { useRetryableModule } from "@admin/hooks/useRetryableModule";
import { retryableModule } from "@admin/lib/retryable-module";
import type { PageProps } from "@admin/lib/routing";

export type RouteModule = { default: ComponentType<PageProps> };

/** How long a fetch runs before its spinner is drawn. */
const SPINNER_DELAY_MS = 200;

/**
 * The loading state: announced at once, drawn only once the fetch has taken
 * 200 ms, so a chunk that arrives quickly (from cache, or fetched ahead)
 * shows no flash of a spinner. The space is held from the start, so the
 * page doesn't move when the spinner appears.
 */
function RouteLoading() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SPINNER_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div
      role="status"
      className="flex h-full min-h-64 w-full items-center justify-center"
      data-testid="route-loading"
    >
      {slow ? (
        <Loader2
          className="h-6 w-6 animate-spin text-muted-foreground"
          aria-hidden="true"
          data-testid="route-spinner"
        />
      ) : null}
      <span className="sr-only">Loading</span>
    </div>
  );
}

function RouteLoadError({
  onRetry,
  exhausted,
}: {
  onRetry: () => void;
  exhausted: boolean;
}) {
  return (
    <div
      role="alert"
      className="flex h-full min-h-64 w-full flex-col items-center justify-center gap-4 p-8 text-center"
      data-testid="route-load-error"
    >
      <p className="text-sm text-muted-foreground">
        {exhausted
          ? "This page still could not be loaded. Reload to start over."
          : "This page could not be loaded. Check your connection and try again."}
      </p>
      {exhausted ? (
        <Button variant="outline" onClick={() => window.location.reload()}>
          Reload the page
        </Button>
      ) : (
        <Button variant="outline" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** A lazily fetched route, and the way to fetch it ahead of a visit. */
export type LazyRouteComponent = ComponentType<PageProps> & {
  /** Starts fetching the page's code if nothing has yet; never throws. */
  preload: () => void;
};

export function lazyRoute(
  load: () => Promise<RouteModule>
): LazyRouteComponent {
  // One fetch shared by a preload and a visit, the page it delivered kept for
  // a later visit, and a failure forgotten so a retry fetches afresh: the
  // fetch, held apart from React.lazy (see `retryableModule`).
  const page = retryableModule(() => load().then(module => module.default));

  function LazyRoute(props: PageProps) {
    const { state, attempt, retry } = useRetryableModule(
      page,
      "This page's code"
    );

    if (state.status === "loading") return <RouteLoading />;
    // One retry covers a blipped fetch. Past it, the recovery becomes a reload
    // (`useRetryableModule` says why).
    if (state.status === "error")
      return <RouteLoadError exhausted={attempt > 0} onRetry={retry} />;

    const Page = state.value;
    return <Page {...props} />;
  }

  // The route table's entries are ComponentType<PageProps>; the wrapper takes
  // the same props and renders nothing but the page once loaded.
  return Object.assign(LazyRoute, { preload: page.preload });
}
