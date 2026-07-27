import type { CacheRevalidator, RevalidationIntent } from "./types";

/**
 * The default {@link CacheRevalidator}: does nothing. Registered when no cache
 * adapter is present — a non-Next runtime, the CLI, migrations, or tests — so the
 * write path can always flush intents unconditionally without a null check and
 * without coupling core to any framework. The Next adapter replaces this with an
 * implementation that maps intents to `revalidateTag`/`revalidatePath`.
 */
export class NoopRevalidator implements CacheRevalidator {
  flush(_intents: RevalidationIntent[]): void {
    // Intentionally empty: no cache to revalidate.
  }
}
