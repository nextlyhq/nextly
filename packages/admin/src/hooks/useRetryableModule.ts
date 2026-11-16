/**
 * The state of a {@link RetryableModule} for a component to draw: loading,
 * failed with a way to try again, or arrived.
 *
 * A fetch starts on mount unless the module has already arrived, and again on
 * each `retry`. `attempt` counts the retries, so a caller can offer a reload
 * once one retry has also failed: some browsers cache a failed module load,
 * and a chunk that fails while evaluating stays failed, so past one retry a
 * reload is what recovers, and a real defect then shows as one.
 *
 * @module hooks/useRetryableModule
 */

import { useCallback, useEffect, useState } from "react";

import type { RetryableModule } from "@admin/lib/retryable-module";

export type ModuleLoadState<T> =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ok"; value: T };

export function useRetryableModule<T>(
  module: RetryableModule<T>,
  /** What failed, as the console says it: "This page's code". */
  what: string
): { state: ModuleLoadState<T>; attempt: number; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ModuleLoadState<T>>(() => {
    const loaded = module.loaded();
    return loaded === null
      ? { status: "loading" }
      : { status: "ok", value: loaded };
  });

  useEffect(() => {
    const loaded = module.loaded();
    if (loaded !== null) {
      // An earlier mount's fetch arrived between this mount's first render and
      // this effect: there is nothing to fetch, so adopt what it delivered.
      setState({ status: "ok", value: loaded });
      return;
    }
    let live = true;
    setState({ status: "loading" });
    module
      .load()
      .then(value => {
        if (live) setState({ status: "ok", value });
      })
      .catch((error: unknown) => {
        // Said where a developer looks before the message replaces it: a
        // missing chunk after a deploy and a module that throws while loading
        // read the same on screen and differ only here.
        console.error(`[admin] ${what} could not be loaded:`, error);
        if (live) setState({ status: "error" });
      });
    return () => {
      live = false;
    };
  }, [module, what, attempt]);

  const retry = useCallback(() => setAttempt(count => count + 1), []);
  return { state, attempt, retry };
}
