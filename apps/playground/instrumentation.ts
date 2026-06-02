// Next.js instrumentation hook. Warms up Nextly once per worker at startup so
// that admin/API handlers never run before init (no "getCachedNextly() called
// before initialization" 500s) and schema boot-apply runs once at startup
// instead of on every cold-boot request (which otherwise broadcasts a
// dev-reload per request → an admin reload loop).
//
// IMPORTANT: `register()` runs in EVERY runtime (Node.js AND Edge). Nextly
// pulls in Node-only packages (esbuild, drizzle-kit, pg, …) that the Edge
// runtime cannot bundle — a static `import "nextly"` here makes Turbopack try
// to bundle them for Edge and fail with "Build Error: Unknown module type"
// (@esbuild/<platform>/README.md). So we (a) bail out unless we're in the
// Node.js runtime and (b) import nextly DYNAMICALLY inside that guard, keeping
// nextly entirely out of the Edge bundle.
//
// See https://nextlyhq.com/docs/getting-started/instrumentation
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { createRegister } = await import("nextly");
  const { default: config } = await import("./nextly.config");
  await createRegister(config)();
}
