/**
 * Starts Nextly before the site serves, as a scaffolded app does: the Next.js
 * cache adapter first, so a write inside a request expires its tags there,
 * then Nextly itself.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { registerNextCacheRevalidator } = await import("nextly/runtime");
  registerNextCacheRevalidator();

  const { createRegister } = await import("nextly");
  const { default: config } = await import("./nextly.config");
  await createRegister(config, {
    cacheComponents: process.env.__NEXT_CACHE_COMPONENTS,
  })();
}
