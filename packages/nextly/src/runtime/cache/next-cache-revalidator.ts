/**
 * The Next.js cache adapter for the framework-neutral {@link CacheRevalidator}
 * port. Maps a write's revalidation intents to `revalidateTag` / `revalidatePath`
 * from `next/cache`.
 *
 * `next/cache` is loaded through {@link loadNextModule}, so the package root
 * stays Node-safe and importing this module never forces `next` onto a
 * consumer. The adapter no-ops where Next.js is not installed (the CLI, a
 * script; a context, not a version), and a revalidation call that fails is
 * swallowed: a revalidation failure must not turn a committed write into an
 * error.
 *
 * `revalidateTag` is called with an explicit `{ expire: 0 }` cache-life profile:
 * a content write must invalidate the cached read immediately — an unpublished
 * or deleted document has to stop being served on the very next request, not
 * after a stale-while-revalidate pass. `{ expire: 0 }` is the immediate-expiry
 * form, and the bare single-argument call is deprecated.
 *
 * @module runtime/cache/next-cache-revalidator
 */
import type {
  CacheRevalidator,
  RevalidationIntent,
} from "../../revalidation/types";
import { loadNextModule, requireNextApi } from "../next-api";

/** A Next `cacheLife`-style profile: `{ expire: 0 }` means expire immediately. */
type CacheLifeProfile = string | { expire?: number };

/**
 * The profile passed to `revalidateTag`: expire the tag immediately so the next
 * request after a write gets fresh (or 404) content, not a stale copy.
 */
const REVALIDATE_PROFILE: CacheLifeProfile = { expire: 0 };

/** The subset of `next/cache` this adapter uses. */
export interface NextCacheModule {
  revalidateTag: (tag: string, profile?: CacheLifeProfile) => void;
  revalidatePath: (path: string, type?: "page" | "layout") => void;
}

// Resolution is attempted once and memoised (including the null "not
// installed" result) so a non-Next runtime does not pay the failed require on
// every write.
let cached: NextCacheModule | null | undefined;

function loadNextCache(): NextCacheModule | null {
  if (cached !== undefined) return cached;
  const mod = loadNextModule("next/cache");
  cached = mod
    ? {
        revalidateTag: requireNextApi(mod, "next/cache", "revalidateTag"),
        revalidatePath: requireNextApi(mod, "next/cache", "revalidatePath"),
      }
    : null;
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
   *   `next/cache` loader; injectable so a test can supply a fake module
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
          next.revalidateTag(tag, REVALIDATE_PROFILE);
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
