"use client";

/**
 * Whether Next.js's development overlay is in the page.
 *
 * Under `next dev`, Next.js draws its development tools, the bottom-left badge
 * among them, inside a `nextjs-portal` element it adds to the document. The
 * admin cannot learn this from its own build: the published package is built
 * for production, which folds `process.env.NODE_ENV` before the host ever runs
 * it. The host's `devIndicators` setting is not readable from the page either,
 * so the overlay's presence is the signal, whether or not its badge is shown.
 *
 * The element can arrive after the admin's first render, so the document's
 * children are watched until it does.
 *
 * @module components/layout/sidebar/use-next-dev-overlay
 */
import { useEffect, useState } from "react";

const OVERLAY_SELECTOR = "nextjs-portal";

export function useNextDevOverlay(): boolean {
  const [present, setPresent] = useState(false);
  useEffect(() => {
    if (document.querySelector(OVERLAY_SELECTOR) !== null) {
      setPresent(true);
      return;
    }
    const observer = new MutationObserver(() => {
      if (document.querySelector(OVERLAY_SELECTOR) === null) return;
      setPresent(true);
      observer.disconnect();
    });
    observer.observe(document.body, { childList: true });
    return () => observer.disconnect();
  }, []);
  return present;
}
