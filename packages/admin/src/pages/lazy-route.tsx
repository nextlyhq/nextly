/**
 * lazyRoute(loader) — a page whose chunk is fetched when the route renders,
 * and fetched AGAIN when the visitor asks.
 *
 * Not React.lazy, on purpose: a lazy component caches a rejected import, so
 * one failed fetch would rethrow on every later render and leave the route
 * broken for the session. This wrapper holds the fetch in state — the first
 * render shows the route's loading state, a failure shows its recoverable
 * error with a retry that issues a fresh import(), and a resolved module
 * renders as the page. The shell and navigation live outside the page, so
 * all three states leave them untouched.
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

function RouteLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex h-full min-h-64 w-full flex-col items-center justify-center gap-4 p-8 text-center"
      data-testid="route-load-error"
    >
      <p className="text-sm text-muted-foreground">
        This page could not be loaded. Check your connection and try again.
      </p>
      <Button variant="outline" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

export function lazyRoute(
  load: () => Promise<RouteModule>
): ComponentType<PageProps> {
  function LazyRoute(props: PageProps) {
    const [attempt, setAttempt] = useState(0);
    const [state, setState] = useState<RouteLoadState>({ status: "loading" });

    useEffect(() => {
      let live = true;
      setState({ status: "loading" });
      load()
        .then(module => {
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
    if (state.status === "error") return <RouteLoadError onRetry={retry} />;

    const { Page } = state;
    return <Page {...props} />;
  }

  // The route table's entries are ComponentType<PageProps>; the wrapper takes
  // the same props and renders nothing but the page once loaded.
  return LazyRoute;
}
