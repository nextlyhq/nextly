/**
 * Whether an element has come into view yet.
 *
 * The entry screen's preview renders a whole page, and a page can be large. A
 * form whose blocks field sits below other fields should not pay for drawing
 * it before anyone scrolls to it, and the fields above it should never wait on
 * it. So the page is drawn the first time its frame is seen, and stays drawn.
 *
 * Where there is no observer to ask — an older engine, a test without layout —
 * the answer is "seen", so the page is drawn rather than left blank forever.
 *
 * @module @nextlyhq/plugin-page-builder/admin/use-first-seen
 */
import { useEffect, useState, type RefObject } from "react";

/**
 * Margin around the viewport that counts as seen, so the page starts drawing
 * just before it scrolls on screen rather than after.
 */
const AHEAD = "200px";

export function useFirstSeen(target: RefObject<Element | null>): boolean {
  const [seen, setSeen] = useState(
    () => typeof IntersectionObserver === "undefined"
  );

  useEffect(() => {
    const element = target.current;
    if (seen || element === null) return;
    const observer = new IntersectionObserver(
      entries => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        setSeen(true);
        observer.disconnect();
      },
      { rootMargin: AHEAD }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [seen, target]);

  return seen;
}
