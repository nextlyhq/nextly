/**
 * Project-local `getNextly` that always passes `nextly.config.ts` to
 * the core initialiser.
 *
 * Why this wrapper exists: `getNextly()` is a cached singleton — the
 * FIRST call wins. Without forwarding the config, frontend pages and
 * server actions would bootstrap Nextly with an empty collections
 * list, leaving `dynamic_collections` unseeded and breaking every
 * code-first query (`Schema for collection "posts" not found in
 * registry.`). The admin route already does this via
 * `createDynamicHandlers({ config })`; this wrapper is the equivalent
 * for the (frontend) and server-action paths.
 *
 * Mirrors Payload CMS's `getPayload()` pattern: the config travels
 * with the function, so callers don't have to import + thread it
 * through every query.
 *
 * Usage everywhere except `src/app/admin/api/...`:
 *
 *   import { getNextly } from "@/lib/nextly";
 *
 *   const nextly = await getNextly();
 *   const result = await nextly.find({ collection: "posts", ... });
 */
import { getNextly as getNextlyCore } from "@revnixhq/nextly";

import nextlyConfig from "../../nextly.config";

export const getNextly = (): ReturnType<typeof getNextlyCore> =>
  getNextlyCore({ config: nextlyConfig });
