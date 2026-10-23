/**
 * Starts Nextly when the server starts, before it serves a request.
 *
 * Next.js runs `register()` once per server instance and finishes it before
 * the instance handles traffic, in every serverless function as well as the
 * admin's. Without it, Nextly starts on the first request that happens to
 * need it, so a route that cannot start it alone, such as `/api/health`,
 * answers as if the server could not serve until some other request has.
 *
 * It also registers Nextly's Next.js cache adapter here, so a Direct API write
 * from any function flushes the cache tags it touches.
 *
 * Guarded to the Node.js runtime and imported dynamically inside the guard:
 * Nextly needs Node-only packages that the Edge runtime cannot bundle. Next.js
 * skips `register()` during `next build`, so this never opens a database
 * connection at build time.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { registerNextCacheRevalidator } = await import("nextly/runtime");
  registerNextCacheRevalidator();

  const { createRegister } = await import("nextly");
  const { default: config } = await import("../nextly.config");
  // Next.js writes its Cache Components setting into this file as it builds
  // it. Nextly, loaded from node_modules, cannot read that for itself, and
  // warns when Cache Components is on, which it does not support yet.
  await createRegister(config, {
    cacheComponents: process.env.__NEXT_CACHE_COMPONENTS,
  })();
}
