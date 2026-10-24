/**
 * Work shared within one widget batch, for one caller.
 *
 * Built once per request, beside the caller's read decisions, and dropped with
 * it: nothing here outlives the batch, so no computation reaches another batch
 * or another caller. Each source sees its own view, keyed by its source id, so a
 * key one source chooses never meets another source's computation, whether the
 * two belong to one plugin, to two plugins or to core. The data functions of one
 * owner's declared widgets share a view of their own, apart from every source's.
 *
 * @module domains/widgets/batch-scope
 */

import type { WidgetScope } from "./resolved-sources";

/** A batch's shared work, handing each source, and each widget owner, a view of its own. */
export interface BatchScope {
  /** The view `sourceId` computes through. */
  forSource(sourceId: string): WidgetScope;
  /**
   * The view the data functions of `owner`'s declared widgets compute through:
   * the declaring plugin's name, or the site.
   *
   * 🔴 A key space of its own, not a source id with a prefix. A source's id is
   * an author's choice like an owner's name, so a prefix is a convention two of
   * them could still meet across; two maps cannot.
   */
  forOwner(owner: string): WidgetScope;
  /**
   * The view core keeps facts about the caller alone in, such as whether they
   * have a release to read: the same for every source in the batch, so it is
   * asked once rather than once per source. Only core computes through it.
   */
  forCaller(): WidgetScope;
}

/** The keys one view computes under, created the first time it is asked for. */
function keysIn(
  views: Map<string, Map<string, Promise<unknown>>>,
  name: string
): Map<string, Promise<unknown>> {
  let keys = views.get(name);
  if (keys === undefined) {
    keys = new Map();
    views.set(name, keys);
  }
  return keys;
}

/**
 * One view over its own keys.
 *
 * The in-flight promise is what is kept, so concurrent askers share one
 * computation rather than racing to start their own. A computation that rejects
 * is forgotten, only if it is still the one kept, so a later asker runs it again
 * instead of every card in the batch inheriting one failure.
 */
function viewOver(computed: Map<string, Promise<unknown>>): WidgetScope {
  return {
    getOrCompute<T>(key: string, compute: () => Promise<T>): Promise<T> {
      const kept = computed.get(key);
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
      computed.set(key, running);
      running.catch(() => {
        if (computed.get(key) === running) computed.delete(key);
      });
      return running;
    },
  };
}

/** A fresh scope for one batch. */
export function createBatchScope(): BatchScope {
  // One map of keys per source, rather than the two joined into one string: a
  // source id and a key are both arbitrary, so no separator between them is
  // one neither can contain, and ("a", "b\0c") would meet ("a\0b", "c"). The
  // owners' views sit in a second map, for the same reason.
  const bySource = new Map<string, Map<string, Promise<unknown>>>();
  const byOwner = new Map<string, Map<string, Promise<unknown>>>();
  const aboutCaller = new Map<string, Promise<unknown>>();
  return {
    forSource: sourceId => viewOver(keysIn(bySource, sourceId)),
    forOwner: owner => viewOver(keysIn(byOwner, owner)),
    forCaller: () => viewOver(aboutCaller),
  };
}
