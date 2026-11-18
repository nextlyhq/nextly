"use client";
/**
 * `<PageCodeBoundary>`: a page that adds code of its own loads, and is left,
 * as a whole document.
 *
 * Its code is started by a loader written into the page's HTML, which runs
 * only as the browser reads that HTML, and what it starts is added to the
 * document outside React. So client-side navigation would neither start it
 * on arrival nor take it away on leaving: the page's styles and scripts
 * would apply to every page visited after it. Rather than undo what a
 * page's code may have done, which nothing can do in general, a page that
 * carries such code is a full-document boundary:
 *
 * - reached by client-side navigation, it loads again as a document, so its
 *   loader runs;
 * - left by client-side navigation, the next page loads as a document, so
 *   nothing the code added stays.
 *
 * Loaded as a document, it does nothing. It tells the two apart by whether
 * React is hydrating the server's HTML (a document load) or rendering on the
 * client (a navigation).
 *
 * @module site/page-code-boundary
 * @experimental Settles with page code.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";

/** The browser's document navigation, as the boundary uses it. */
export interface DocumentNavigation {
  /** The address shown now. */
  href(): string;
  /** Load the address shown as a whole document. */
  reload(): void;
  /** Run `run` in a later task, once the router has moved the address. */
  later(run: () => void): void;
}

const BROWSER: DocumentNavigation = {
  href: () => window.location.href,
  reload: () => window.location.reload(),
  later: run => {
    window.setTimeout(run, 0);
  },
};

/** Nothing to subscribe to: the answer is only which snapshot React asks. */
const NOTHING_TO_WATCH = (): (() => void) => () => {};

export function PageCodeBoundary({
  navigation = BROWSER,
}: {
  /** The browser's own, outside tests. */
  readonly navigation?: DocumentNavigation;
}): null {
  // The server snapshot while hydrating the server's HTML, the client's when
  // rendered by client-side navigation; the first render's answer is kept.
  const onClient = useSyncExternalStore(
    NOTHING_TO_WATCH,
    () => true,
    () => false
  );
  const reachedByClient = useRef(onClient);
  useEffect(() => {
    if (reachedByClient.current) {
      navigation.later(() => navigation.reload());
      return undefined;
    }
    const here = navigation.href();
    // Left: the next page is loaded as a document. Only where the address
    // moved, so React's development re-run of effects reloads nothing.
    return () => {
      navigation.later(() => {
        if (navigation.href() !== here) navigation.reload();
      });
    };
  }, [navigation]);
  return null;
}
