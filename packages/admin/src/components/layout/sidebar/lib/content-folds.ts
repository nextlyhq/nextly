/**
 * Which of the Content panel's headings the person folded, remembered for
 * them across visits.
 *
 * Kept with the admin's other interface preferences in the device memory, so
 * it follows the same rules: signing out forgets it with everything else
 * about the person, and where the site turns remembering off it holds for the
 * page alone. Read when the panel first draws rather than after, so a folded
 * heading never paints open first: the sidebar draws only in the browser.
 *
 * @module components/layout/sidebar/lib/content-folds
 */
import { useCallback, useState } from "react";

import {
  keepHeldPreference,
  recallHeldPreference,
} from "@admin/lib/device-memory/device-memory";

const FOLDS_KEY = "nextly:admin:content-panel-folds";

/** The fold key of a heading: `collections`, `singles` or `group:<slug>`. */
export function groupFoldKey(slug: string): string {
  return `group:${slug}`;
}

/** The folded headings as kept, or none when nothing (or nothing valid) is. */
function readFolds(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(recallHeldPreference(FOLDS_KEY) ?? "[]");
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((key): key is string => typeof key === "string")
        : []
    );
  } catch {
    // A value written by something else, or corrupted: start unfolded.
    return new Set();
  }
}

export interface ContentFolds {
  isFolded: (key: string) => boolean;
  toggle: (key: string) => void;
}

/** The panel's folds, read once on mount and kept on every toggle. */
export function useContentFolds(): ContentFolds {
  const [folded, setFolded] = useState(readFolds);
  const toggle = useCallback((key: string) => {
    // From what is kept, not this render's set, so two quick toggles both
    // apply; the write stays in the handler, out of React's render.
    const next = readFolds();
    if (next.has(key)) next.delete(key);
    else next.add(key);
    keepHeldPreference(FOLDS_KEY, JSON.stringify([...next]));
    setFolded(next);
  }, []);
  const isFolded = useCallback((key: string) => folded.has(key), [folded]);
  return { isFolded, toggle };
}
