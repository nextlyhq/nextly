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
 */

import { Button } from "@nextlyhq/ui";
import { type ComponentType, useCallback, useEffect, useState } from "react";

import { Loader2 } from "@admin/components/icons";
import type { PageProps } from "@admin/lib/routing";

export type RouteModule = { default: ComponentType<PageProps> };

type RouteLoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ok"; Page: ComponentType<PageProps> };

function RouteLoading() {
  return (
    <div
      role="status"
      className="flex h-full min-h-64 w-full items-center justify-center"
      data-testid="route-loading"
    >
      <Loader2
        className="h-6 w-6 animate-spin text-muted-foreground"
        aria-hidden="true"
      />
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

export function lazyRoute(
  load: () => Promise<RouteModule>
): ComponentType<PageProps> {
  // The browser keeps every fetched module until a full reload, so the
  // resolved page component is remembered here and this route's next mount
  // starts at `ok` — returning to a visited page shows the page, not the
  // spinner again. This holds the component function, never a mounted page.
  let loaded: ComponentType<PageProps> | null = null;

  function LazyRoute(props: PageProps) {
    const [attempt, setAttempt] = useState(0);
    const [state, setState] = useState<RouteLoadState>(() =>
      loaded ? { status: "ok", Page: loaded } : { status: "loading" }
    );

    useEffect(() => {
      if (loaded) return;
      let live = true;
      setState({ status: "loading" });
      load()
        .then(module => {
          loaded = module.default;
          if (live) setState({ status: "ok", Page: module.default });
        })
        .catch(() => {
          if (live) setState({ status: "error" });
        });
      return () => {
        live = false;
      };
      // A fresh fetch per attempt: the retry bumps the counter, and `load`
      // is the module-scope closure the registry declared — it never changes
      // for this component.
    }, [attempt]);

    const retry = useCallback(() => setAttempt(attempt => attempt + 1), []);

    if (state.status === "loading") return <RouteLoading />;
    // One retry covers a blipped fetch. Past it, a plain re-import may keep
    // failing — some browsers cache a failed module load, and a chunk that
    // fails while EVALUATING stays failed everywhere — so the recovery
    // becomes a reload, which refetches from scratch and lets a real defect
    // surface as one instead of posing as a connection problem.
    if (state.status === "error")
      return <RouteLoadError exhausted={attempt > 0} onRetry={retry} />;

    const { Page } = state;
    return <Page {...props} />;
  }

  // The route table's entries are ComponentType<PageProps>; the wrapper takes
  // the same props and renders nothing but the page once loaded.
  return LazyRoute;
}
