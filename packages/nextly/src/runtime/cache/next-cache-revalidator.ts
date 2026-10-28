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
import { recordAdvisoryNotice } from "../../hooks/side-effect-warnings";
import {
  expiryHandoff,
  type ExpiryHandoff,
} from "../../revalidation/expiry-handoff";
import type {
  CacheRevalidator,
  FlushOutcome,
  RevalidationIntent,
} from "../../revalidation/types";
import { consoleLogger } from "../../shared/types";
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
  /**
   * Server Actions only: expires the tag so the acting user reads their own
   * write in the same response. Optional so a module without it, or a fake one,
   * still works through `revalidateTag`.
   */
  updateTag?: (tag: string) => void;
}

// Resolution is attempted once and memoised (including the null "not
// installed" result) so a non-Next runtime does not pay the failed require on
// every write.
let cached: NextCacheModule | null | undefined;

/** The two calls this adapter makes, from a loaded `next/cache`. */
export function nextCacheFrom(mod: Record<string, unknown>): NextCacheModule {
  return {
    revalidateTag: requireNextApi(mod, "next/cache", "revalidateTag"),
    revalidatePath: requireNextApi(mod, "next/cache", "revalidatePath"),
    updateTag:
      typeof mod.updateTag === "function"
        ? (tag: string) => (mod.updateTag as (tag: string) => void)(tag)
        : undefined,
  };
}

function loadNextCache(): NextCacheModule | null {
  if (cached !== undefined) return cached;
  const mod = loadNextModule("next/cache");
  cached = mod ? nextCacheFrom(mod) : null;
  return cached;
}

// Whether a failure to resolve `next/cache` was logged already: once is
// enough to name it, and every write after it would repeat the same line.
let resolveFailureLogged = false;

/**
 * `next/cache` from `loader`, or null when it cannot be had. Resolving is
 * inside the best-effort boundary too: a traced bundle missing one of its
 * modules, or an export it lacks, must not turn the committed write this runs
 * after into an error. Logged once; an unsupported Next.js is refused at
 * start, not here.
 */
function resolveNextCache(
  loader: () => NextCacheModule | null
): NextCacheModule | null {
  try {
    return loader();
  } catch (error) {
    if (!resolveFailureLogged) {
      resolveFailureLogged = true;
      const reason = error instanceof Error ? error.message : String(error);
      consoleLogger.warn(
        `[nextly] cache revalidation is off: next/cache could not be resolved (${reason})`
      );
    }
    return null;
  }
}

/**
 * The most tags one write expires one by one: Next.js keeps at most 128 tags on
 * a cached read (`cacheTag`), so a write naming more is better served by the
 * tags every read of its collection or Single carries.
 */
export const MAX_TAGS_PER_WRITE = 128;

/**
 * What Next.js says when `updateTag` is called anywhere but a Server Action: in
 * a Route Handler, or with no request at all. Only this falls back to
 * `revalidateTag`; any other failure is a failure.
 */
const OUTSIDE_SERVER_ACTION =
  /updateTag can only be called from within a Server Action/;

/**
 * Expires one tag: with `updateTag` in a Server Action, so the acting user
 * reads their own write, and with `revalidateTag(tag, { expire: 0 })`
 * everywhere else. In a Route Handler Next.js starts that expiry before the
 * response and completes it in the same invocation, so a read made after the
 * response sees the write; a request already in flight may not.
 */
function expireTag(next: NextCacheModule, tag: string): void {
  if (next.updateTag) {
    try {
      next.updateTag(tag);
      return;
    } catch (error) {
      if (
        !(error instanceof Error && OUTSIDE_SERVER_ACTION.test(error.message))
      ) {
        throw error;
      }
    }
  }
  next.revalidateTag(tag, REVALIDATE_PROFILE);
}

/** Runs `call`, once more if it throws; the error of the second try, or null. */
function withOneRetry(call: () => void): string | null {
  for (let tries = 0; ; tries++) {
    try {
      call();
      return null;
    } catch (error) {
      if (tries === 1)
        return error instanceof Error ? error.message : String(error);
    }
  }
}

/**
 * The tags a write expires. Past {@link MAX_TAGS_PER_WRITE}, each nextly tag
 * gives way to its collection's (`nextly:<collection>`) or Single's
 * (`nextly:single:<slug>`), which every cached read of it carries; a
 * configured tag of the app's own is kept as it is.
 */
export function tagsToExpire(intents: RevalidationIntent[]): string[] {
  const tags = [...new Set(intents.flatMap(intent => intent.tags))];
  if (tags.length <= MAX_TAGS_PER_WRITE) return tags;
  return [...new Set(tags.map(broadestTag))];
}

/** The notice code a response carries when a write's cache expiry was handed off. */
export const CACHE_EXPIRY_DEFERRED = "CACHE_EXPIRY_DEFERRED";

/** What the response tells the writer: it names nothing they could not see. */
export const DEFERRED_EXPIRY_NOTICE =
  "The change is saved. It may take up to a minute to appear publicly.";

/**
 * The collections and Singles whose reads a set of tags belongs to, in the
 * notice's namespacing (`posts`, `single:header`). Tags of the app's own
 * name no collection, so a set of only those is reported once, unnamed.
 */
function ownersOf(tags: string[]): string[] {
  const owners = new Set<string>();
  for (const tag of tags) {
    const parts = broadestTag(tag).split(":");
    if (parts[0] === "nextly" && parts.length >= 2) {
      owners.add(parts.slice(1).join(":"));
    }
  }
  return owners.size > 0 ? [...owners] : [""];
}

function broadestTag(tag: string): string {
  const parts = tag.split(":");
  if (parts[0] !== "nextly" || parts.length < 2) return tag;
  return parts[1] === "single" && parts.length >= 3
    ? parts.slice(0, 3).join(":")
    : parts.slice(0, 2).join(":");
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
    private readonly loader: () => NextCacheModule | null = loadNextCache,
    private readonly handoff: () => ExpiryHandoff = expiryHandoff
  ) {}

  flush(intents: RevalidationIntent[]): FlushOutcome | void {
    const next = resolveNextCache(this.loader);
    // No Next cache in this runtime (the CLI, a script): nothing here to expire.
    if (!next) return;
    const failed = new Map<string, string>();
    for (const tag of tagsToExpire(intents)) {
      const error = withOneRetry(() => expireTag(next, tag));
      if (error !== null) failed.set(tag, error);
    }
    for (const target of intents.flatMap(intent => intent.paths ?? [])) {
      // A path carries no tag to hand off: its failure is logged, and the
      // write's tags beside it still expire the reads.
      const error = withOneRetry(() =>
        next.revalidatePath(target.path, target.type)
      );
      if (error !== null) {
        consoleLogger.warn(
          `[nextly] could not revalidate the path ${target.path}: ${error}`
        );
      }
    }
    if (failed.size === 0) return;
    // The write is committed: what failed twice goes to the out-of-request
    // path, and the outcome lets the response say it may take a moment.
    const deferredTags = [...failed.keys()];
    const reason = [...new Set(failed.values())].join("; ");
    consoleLogger.error(
      `[nextly] cache expiry failed twice and was handed off (${reason}): ${deferredTags.join(", ")}`
    );
    this.handOff(deferredTags, reason);
    // The response says so: the change is saved, and its public pages may
    // show the previous content until the hand-off runs. A no-op outside a
    // request, where there is no response to tell.
    for (const owner of ownersOf(deferredTags)) {
      recordAdvisoryNotice({
        phase: "cache-expiry",
        collection: owner,
        code: CACHE_EXPIRY_DEFERRED,
        message: DEFERRED_EXPIRY_NOTICE,
      });
    }
    return { deferredTags };
  }

  /** Hands tags off without letting the hand-off itself fail the write. */
  private handOff(tags: string[], reason: string): void {
    try {
      const pending = this.handoff().handOff(tags, reason);
      if (pending instanceof Promise) {
        pending.catch(error =>
          consoleLogger.error(
            `[nextly] the cache expiry hand-off failed: ${error instanceof Error ? error.message : String(error)}`
          )
        );
      }
    } catch (error) {
      consoleLogger.error(
        `[nextly] the cache expiry hand-off failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
