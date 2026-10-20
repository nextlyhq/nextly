/**
 * Work shared within one widget batch, for one caller.
 *
 * Built once per request, beside the caller's read decisions, and dropped with
 * it: nothing here outlives the batch, so no computation reaches another batch
 * or another caller. Each source sees its own view, keyed by its source id, so a
 * key one source chooses never meets another source's computation, whether the
 * two belong to one plugin, to two plugins or to core.
 *
 * @module domains/widgets/batch-scope
 */

import type { WidgetScope } from "./resolved-sources";

/** A batch's shared work, handing each source a view of its own. */
export interface BatchScope {
  /** The view `sourceId` computes through. */
  forSource(sourceId: string): WidgetScope;
}

/**
 * A fresh scope for one batch.
 *
 * The in-flight promise is what is kept, so concurrent askers share one
 * computation rather than racing to start their own. A computation that rejects
 * is forgotten, only if it is still the one kept, so a later asker runs it again
 * instead of every card in the batch inheriting one failure.
 */
export function createBatchScope(): BatchScope {
  const computed = new Map<string, Promise<unknown>>();
  return {
    forSource(sourceId) {
      return {
        getOrCompute<T>(key: string, compute: () => Promise<T>): Promise<T> {
          // A separator no source id contains, so ("a", "b:c") and ("a:b", "c")
          // never land on one entry.
          const entry = `${sourceId}\u0000${key}`;
          const kept = computed.get(entry);
          if (kept !== undefined) return kept as Promise<T>;
          let running: Promise<T>;
          try {
            running = compute();
          } catch (thrown) {
            // A compute that throws before returning a promise fails this asker
            // the same way a rejection would, and is not kept.
            return Promise.reject(
              thrown instanceof Error ? thrown : new Error(String(thrown))
            );
          }
          computed.set(entry, running);
          running.catch(() => {
            if (computed.get(entry) === running) computed.delete(entry);
          });
          return running;
        },
      };
    },
  };
}
