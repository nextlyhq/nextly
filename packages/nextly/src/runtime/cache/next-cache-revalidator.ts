/**
 * The Next.js cache adapter for the framework-neutral {@link CacheRevalidator}
 * port. Maps a write's revalidation intents to `revalidateTag` / `revalidatePath`
 * from `next/cache`.
 *
 * `next/cache` is resolved lazily through `createRequire` (Node's CommonJS
 * resolver, opaque to bundlers — the same pattern as `actions/upload-media.ts`
 * and `domains/webhooks/after-drain.ts`) so the package root stays Node-safe and
 * importing this module never forces `next` onto a consumer. The adapter no-ops
 * when `next/cache` is unavailable (a non-Next runtime, the CLI) and never
 * throws — a revalidation failure must not turn a committed write into an error.
 *
 * `revalidateTag(tag)` is called single-arg, the form supported across the whole
 * `next` peer range (`^14 || ^15 || ^16`). The Next 16 `{ profile: "max" }`
 * second argument (stale-while-revalidate) is an optional future enhancement.
 *
 * @module runtime/cache/next-cache-revalidator
 */
import { createRequire } from "node:module";

import type {
  CacheRevalidator,
  RevalidationIntent,
} from "../../revalidation/types";

/** The subset of `next/cache` this adapter uses. */
export interface NextCacheModule {
  revalidateTag: (tag: string) => void;
  revalidatePath: (path: string, type?: "page" | "layout") => void;
}

// Resolution is attempted once and memoised (including the null "unavailable"
// result) so a non-Next runtime does not pay the failed require on every write.
let cached: NextCacheModule | null | undefined;

function loadNextCache(): NextCacheModule | null {
  if (cached !== undefined) return cached;
  try {
    const require = createRequire(import.meta.url);
    const mod = require("next/cache") as Partial<NextCacheModule>;
    cached =
      typeof mod.revalidateTag === "function" &&
      typeof mod.revalidatePath === "function"
        ? (mod as NextCacheModule)
        : null;
  } catch {
    // `next` not installed, or not resolvable in this runtime.
    cached = null;
  }
  return cached;
}

/**
 * Maps {@link RevalidationIntent}s to `next/cache` calls. Register it as the
 * `cacheRevalidator` so the write path flushes tag/path invalidations through
 * Next's ISR cache.
 */
export class NextCacheRevalidator implements CacheRevalidator {
  /**
   * @param loader Resolves the `next/cache` module. Defaults to the lazy
   *   `createRequire` loader; injectable so a test can supply a fake module
   *   without a real Next runtime.
   */
  constructor(
    private readonly loader: () => NextCacheModule | null = loadNextCache
  ) {}

  flush(intents: RevalidationIntent[]): void {
    const next = this.loader();
    // No Next cache in this runtime: nothing to bust.
    if (!next) return;
    for (const intent of intents) {
      for (const tag of intent.tags) {
        try {
          next.revalidateTag(tag);
        } catch {
          // `revalidateTag` throws when called outside a request/render scope
          // (e.g. a CLI or background write). Swallow per-call so one failure
          // never stops the rest, and a committed write is never turned into an
          // error.
        }
      }
      for (const target of intent.paths ?? []) {
        try {
          next.revalidatePath(target.path, target.type);
        } catch {
          // Same rationale as the tag loop above.
        }
      }
    }
  }
}
