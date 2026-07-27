/**
 * Registers Nextly's Next.js cache adapter as soon as any server instance
 * boots. Next.js runs `register()` once per server process at startup — in
 * every serverless function, not just the one serving the admin catch-all
 * route — so any function that performs a Direct API write (the initial content
 * seed at `/admin/api/seed`, a Server Action, a custom route) flushes cache
 * tags instead of silently using the no-op revalidator.
 *
 * Without this, a write from an isolated serverless function would not bust the
 * tag-based caches. That is most damaging for the timerless singleton pages
 * (site settings, navigation, homepage): `next build` runs against the freshly
 * migrated, empty database and caches their defaults, and a later seed that
 * populates them from a separate function would leave those pages stuck on the
 * build-time defaults forever.
 *
 * Guarded to the Node.js runtime: the adapter resolves `next/cache` via
 * `createRequire`, which is unavailable on the edge runtime (where Nextly does
 * not run anyway).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNextCacheRevalidator } = await import("nextly/runtime");
    registerNextCacheRevalidator();
  }
}
