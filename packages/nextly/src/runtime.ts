/**
 * Runtime entry — `nextly/runtime`
 *
 * This subpath aggregates everything that runs **inside a Next.js
 * request lifecycle** and therefore is allowed to (transitively)
 * import `next/navigation`, `next/cache`, `next/headers`, etc.
 *
 * The package's root entry (`nextly`) deliberately does NOT
 * re-export from here. That keeps the root Node-safe so:
 *   - The CLI can load user configs without dragging Next.js in.
 *   - Plugin authors can `import { defineCollection } from "nextly"`
 *     in their own packages without forcing a `next` peer dep on
 *     consumers.
 *
 * Templates wire the catch-all admin route from this subpath:
 *
 * ```ts
 * // src/app/admin/[[...params]]/route.ts (or app router catch-all)
 * import { createDynamicHandlers } from "nextly/runtime";
 * export const { GET, POST, PATCH, DELETE } = createDynamicHandlers();
 * ```
 *
 * Industry alignment: this mirrors how Payload separates
 * `@payloadcms/next` (runtime) from `payload` (core), and how tRPC
 * isolates Next.js code under `@trpc/server/adapters/next-app-dir`.
 */

export {
  bumpSchemaVersion,
  createDynamicHandlers,
  getCollectionsHandler,
  getCollectionsService,
} from "./routeHandler";

// F1 cache revalidation — the Next adapter + read-side tagging helpers. Safe to
// import here: this subpath is already Next-coupled. The write-side adapter
// resolves `next/cache` lazily, so importing these never forces `next` at load.
export {
  NextCacheRevalidator,
  registerNextCacheRevalidator,
  nextlyTags,
  nextlySingleTags,
  entryIdTag,
  cachedFind,
  type NextCacheModule,
  type CachedFindOptions,
} from "./runtime/cache";

// SEO bridge — map the plugin's `seo` field group to a Next `Metadata` object.
// The `next` import is type-only, so this never forces `next` at load.
export {
  buildMetadata,
  type BuildMetadataOptions,
  type MetadataEntry,
  type SeoMetaInput,
} from "./runtime/seo";

// Draft previews — the route that turns a scoped preview link into a draft
// session, and the reader a read path asks what that session may see. `next` is
// not imported at all: the caller passes `draftMode` and `cookies` in, which
// also keeps both testable without a request.
export {
  PREVIEW_SCOPE_COOKIE,
  createPreviewRoute,
  readPreviewScope,
  readPreviewSession,
  previewGrantsDraft,
  type PreviewRouteConfig,
  type PreviewScopeReaderConfig,
} from "./runtime/preview/preview-route";

// The JOIN between the two above: a `draft` hook that grants exactly what the
// request's token covers. Exported because the join is security-critical and
// short, which is the combination that gets retyped subtly wrong — and its
// failure grants every draft rather than erroring.
export { previewDraftGate } from "./runtime/preview/preview-draft-gate";

// The Single counterpart. A sibling rather than a branch: a collection gate
// returns an entry id so the route can compare it against the row a PATH
// resolved to, while a Single has no path and no id — its slug is its identity —
// so its gate settles the question and answers a boolean.
export { previewSingleDraftGate } from "./runtime/preview/preview-single-draft-gate";
export type { PreviewSingleDraftGateConfig } from "./runtime/preview/preview-single-draft-gate";
export type {
  PreviewDraftGateConfig,
  DraftGateRequest,
} from "./runtime/preview/preview-draft-gate";

// Content routing + sitemap/robots delivery. `next`/`react` are type-only and
// `next/navigation` resolves lazily, so importing these never forces them.
// `getNextly` is the documented default for `ContentRouteConfig.nextly`, and a
// helper built ON a content route needs the same instance the route resolves
// through — on a per-tenant setup a second instance is a second DATABASE. It is
// exported so such a helper can resolve it the same way, rather than having the
// route hand a general reader to every callback in order to share one.
export { getNextly } from "./direct-api/nextly";

export {
  resolveContent,
  isReservedPath,
  createContentRoute,
  createPublicContentRoute,
  createSingleRoute,
  createPublicSingleRoute,
  slugToStaticParam,
  nextlySitemap,
  nextlyRobots,
  type ContentEntry,
  type ResolveContentOptions,
  type ContentRoute,
  type StaticContentRoute,
  type ContentRouteArgs,
  type ContentRouteConfig,
  type RenderContext,
  type NextlyContentReader,
  type SingleRoute,
  type SingleRouteConfig,
  type SingleContext,
  type SingleDraftRequest,
  type SingleDocument,
  type NextlySingleReader,
  type ResolvedContext,
  type NextlySitemapEntry,
  type NextlySitemapOptions,
  type NextlyRobotsOptions,
} from "./runtime/routing";
