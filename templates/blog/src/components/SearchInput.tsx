"use client";

import { useEffect, useMemo, useState } from "react";

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

interface PagefindResult {
  url: string;
  meta?: { title?: string };
  excerpt?: string;
}

interface PagefindModule {
  init?: () => Promise<void>;
  search: (query: string) => Promise<{
    results: Array<{ data: () => Promise<PagefindResult> }>;
  }>;
}

export function SearchInput() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PagefindResult[]>([]);
  const [pagefind, setPagefind] = useState<PagefindModule | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Lazy-load the Pagefind bundle on mount. Dynamic import with a
  // `webpackIgnore` magic comment keeps bundler tools from trying to
  // include it in the Next.js bundle - Pagefind is served as-is.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = (await import(
          /* webpackIgnore: true */ /* @vite-ignore */
          "/pagefind/pagefind.js"
        )) as PagefindModule;
        if (cancelled) return;
        if (typeof mod.init === "function") {
          await mod.init();
        }
        setPagefind(mod);
      } catch (err) {
        if (cancelled) return;
        setLoadError(
          "Search index not found. Run `pnpm build` (or `npm run build`) to generate it, then reload."
        );
        console.debug("[search] failed to load pagefind:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounce the query so fast typing doesn't fire a search per keystroke.
  const debouncedQuery = useDebounce(query, 150);

  useEffect(() => {
    if (!pagefind || !debouncedQuery) {
      setResults([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const search = await pagefind.search(debouncedQuery);
        const docs = await Promise.all(
          search.results.slice(0, 10).map(r => r.data())
        );
        if (!cancelled) setResults(docs);
      } catch (err) {
        console.debug("[search] query failed:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, pagefind]);

  return (
    <div>
      <input
        type="search"
        autoFocus
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search posts..."
        className="w-full rounded-lg border px-4 py-3 text-base"
        style={{
          borderColor: "var(--color-border)",
          background: "var(--color-bg-surface)",
          color: "var(--color-fg)",
        }}
        aria-label="Search"
      />

      {loadError && (
        <p
          className="mt-4 rounded-md border border-dashed p-4 text-sm"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-fg-muted)",
          }}
        >
          {loadError}
        </p>
      )}

      {!loadError && debouncedQuery && results.length === 0 && (
        <p className="mt-6 text-sm" style={{ color: "var(--color-fg-muted)" }}>
          No results for &quot;{debouncedQuery}&quot;.
        </p>
      )}

      {results.length > 0 && (
        <ul className="mt-6 flex flex-col gap-4">
          {results.map(r => (
            <li
              key={r.url}
              className="rounded-lg border p-4"
              style={{
                borderColor: "var(--color-border)",
                background: "var(--color-bg-surface)",
              }}
            >
              <a
                href={r.url}
                className="text-base font-semibold"
                style={{ color: "var(--color-fg)" }}
              >
                {r.meta?.title || r.url}
              </a>
              {r.excerpt && (
                <p
                  className="mt-1 text-sm"
                  style={{ color: "var(--color-fg-muted)" }}
                  dangerouslySetInnerHTML={{ __html: r.excerpt }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return useMemo(() => debounced, [debounced]);
}
