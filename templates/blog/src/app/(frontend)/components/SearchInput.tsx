"use client";

import { useEffect, useState } from "react";

/**
 * SearchInput - client-side search powered by Pagefind.
 *
 * Loads `/pagefind/pagefind.js` lazily on mount. That file is
 * produced by `scripts/build-search-index.mjs` during `next build`
 * and served from `public/pagefind/` as static assets. No server-side
 * search infrastructure required.
 *
 * Debounces input by 150ms so the search runs per-pause rather than
 * per-keystroke. Displays up to 10 results with title + excerpt +
 * URL. Empty state when nothing matches.
 *
 * Gracefully degrades: if the Pagefind bundle hasn't been built yet
 * (dev mode, or user forgot to run the build step), the input still
 * renders and shows a help message instead of silently failing.
 */

// Shapes come from the ambient declaration in src/types/pagefind.d.ts, which is
// the one description of the bundle this file loads at runtime.
import type { PagefindDocument } from "/pagefind/pagefind.js";

type PagefindModule = typeof import("/pagefind/pagefind.js");

/** A search's documents, with the query that produced them. */
type Found = { query: string; docs: PagefindDocument[] };

const NOTHING_FOUND: Found = { query: "", docs: [] };

export function SearchInput() {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found>(NOTHING_FOUND);
  const [pagefind, setPagefind] = useState<PagefindModule | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Lazy-load the Pagefind bundle on mount. Dynamic import with a
  // `webpackIgnore` magic comment keeps bundler tools from trying to
  // include it in the Next.js bundle - Pagefind is served as-is.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod: PagefindModule = await import(
          /* webpackIgnore: true */ /* @vite-ignore */
          "/pagefind/pagefind.js"
        );
        if (cancelled) return;
        // Guarded rather than called directly: the bundle is generated at build
        // time, so a version skew can leave it without the documented init().
        if (typeof mod.init === "function") {
          await mod.init();
        }
        setPagefind(mod);
      } catch (err) {
        if (cancelled) return;
        // Two different situations leave the bundle absent, and telling them
        // apart matters: a project with no published posts has nothing to
        // index, so repeating "run the build" is advice that can never work.
        // The build writes which case it was; if that file is missing too,
        // the build genuinely has not run.
        const state = await fetch("/search-status.json")
          .then(r => (r.ok ? r.json() : null))
          .then(body => (body as { state?: string } | null)?.state)
          .catch(() => undefined);
        if (cancelled) return;
        setLoadError(
          state === "empty"
            ? "No posts have been published yet, so there is nothing to search. The index is generated at build time once the first post is live."
            : "Search index not found. Run `pnpm build` (or `npm run build`) to generate it, then reload."
        );
        console.debug("[search] failed to load pagefind:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounce the query so fast typing doesn't fire a search per keystroke.
  const debouncedQuery = useSettledQuery(query, 150);

  useEffect(() => {
    if (!pagefind || !debouncedQuery) return;
    let cancelled = false;
    (async () => {
      try {
        const search = await pagefind.search(debouncedQuery);
        const docs = await Promise.all(
          search.results.slice(0, 10).map(r => r.data())
        );
        if (!cancelled) setFound({ query: debouncedQuery, docs });
      } catch (err) {
        console.debug("[search] query failed:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, pagefind]);

  // An emptied box forgets the last answer, so it cannot reappear under the
  // next query while that one loads. Adjusted while rendering rather than in
  // an effect; a search still running when the box empties is cancelled by
  // the effect's cleanup, and one that finished just before is dropped here.
  if (!debouncedQuery && found !== NOTHING_FOUND) {
    setFound(NOTHING_FOUND);
  }

  // A cleared box, or no index yet, shows nothing; while typing, the last
  // answer stays up until the newer one arrives.
  const results = pagefind && debouncedQuery ? found.docs : [];
  // "No results" only once this query's own search has answered.
  const answered = found.query === debouncedQuery;

  return (
    <div className="max-w-2xl mx-auto">
      <input
        type="search"
        autoFocus
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search posts..."
        className="w-full rounded-none border px-5 py-4 text-lg transition-colors focus:border-[color:var(--color-fg-muted)] focus:outline-none"
        style={{
          borderColor: "var(--color-border)",
          background: "var(--color-bg-surface)",
          color: "var(--color-fg)",
        }}
        aria-label="Search"
      />

      {loadError && (
        <div
          className="mt-6 rounded-none border border-dashed p-6 text-sm leading-relaxed"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-fg-muted)",
          }}
        >
          {loadError}
        </div>
      )}

      {!loadError && debouncedQuery && answered && results.length === 0 && (
        <p
          className="mt-10 text-center text-sm font-medium"
          style={{ color: "var(--color-fg-muted)" }}
        >
          No results for &quot;{debouncedQuery}&quot;.
        </p>
      )}

      {results.length > 0 && (
        <ul className="mt-10 flex flex-col gap-6">
          {results.map(r => (
            <li
              key={r.url}
              className="group rounded-none border p-6 transition-all hover:border-[color:var(--color-fg-muted)]"
              style={{
                borderColor: "var(--color-border)",
                background: "var(--color-bg-surface)",
              }}
            >
              <a
                href={r.url}
                className="text-xl font-bold tracking-tightest-premium"
                style={{ color: "var(--color-fg)" }}
              >
                {r.meta?.title || r.url}
              </a>
              {r.excerpt && (
                <p
                  className="mt-3 text-sm leading-relaxed"
                  style={{ color: "var(--color-fg-muted)" }}
                  dangerouslySetInnerHTML={{ __html: r.excerpt }}
                />
              )}
              <div
                className="mt-4 text-[10px] font-bold uppercase tracking-widest opacity-0 transition-opacity group-hover:opacity-100"
                style={{ color: "var(--color-accent)" }}
              >
                Read more →
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The query to search for. Typing settles after a pause; an emptied box
 * settles at once, during the same render, so clearing and retyping quickly
 * still ends the old search and its results before the new one starts.
 */
function useSettledQuery(query: string, delayMs: number): string {
  const [settled, setSettled] = useState(query);
  if (!query && settled) setSettled("");
  useEffect(() => {
    if (!query) return;
    const t = setTimeout(() => setSettled(query), delayMs);
    return () => clearTimeout(t);
  }, [query, delayMs]);
  return settled;
}
