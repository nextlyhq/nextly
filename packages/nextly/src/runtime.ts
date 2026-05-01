/**
 * Runtime entry — `@revnixhq/nextly/runtime`
 *
 * This subpath aggregates everything that runs **inside a Next.js
 * request lifecycle** and therefore is allowed to (transitively)
 * import `next/navigation`, `next/cache`, `next/headers`, etc.
 *
 * The package's root entry (`@revnixhq/nextly`) deliberately does NOT
 * re-export from here. That keeps the root Node-safe so:
 *   - The CLI can load user configs without dragging Next.js in.
 *   - Plugin authors can `import { defineCollection } from "@revnixhq/nextly"`
 *     in their own packages without forcing a `next` peer dep on
 *     consumers.
 *
 * Templates wire the catch-all admin route from this subpath:
 *
 * ```ts
 * // src/app/admin/[[...params]]/route.ts (or app router catch-all)
 * import { createDynamicHandlers } from "@revnixhq/nextly/runtime";
 * export const { GET, POST, PATCH, DELETE } = createDynamicHandlers();
 * ```
 *
 * Industry alignment: this mirrors how Payload separates
 * `@payloadcms/next` (runtime) from `payload` (core), and how tRPC
 * isolates Next.js code under `@trpc/server/adapters/next-app-dir`.
 * See task 24 phase "stage 1 architecture fix".
 */

export {
  bumpSchemaVersion,
  createDynamicHandlers,
  getCollectionsHandler,
  getCollectionsService,
} from "./routeHandler";
