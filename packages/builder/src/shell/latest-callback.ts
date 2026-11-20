"use client";

/**
 * A function that keeps its identity across renders and calls the newest
 * one it was handed.
 *
 * @module latest-callback
 */
import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * `fn`, as one function for the life of the component that keeps calling the
 * `fn` of the newest render. For a handler handed to a memoised surface: a
 * new closure each render would draw the surface again, and the first
 * render's closure kept instead would act on what that render held.
 *
 * Only for a handler called after rendering (a press, a key, an effect), never
 * during it: the newest `fn` is taken once the render it came from is
 * committed.
 * @experimental
 */
export function useLatestCallback<A extends unknown[], R>(
  fn: (...args: A) => R
): (...args: A) => R {
  const latest = useRef(fn);
  // Before any effect or event of the committed render can call it.
  useLayoutEffect(() => {
    latest.current = fn;
  });
  return useCallback((...args: A) => latest.current(...args), []);
}

/**
 * {@link useLatestCallback} for a handler that may be absent: `undefined`
 * while it is, so a surface that draws a control only for a handler there is
 * still knows, and one kept function while it is not.
 * @experimental
 */
export function useLatestOptionalCallback<A extends unknown[], R>(
  fn: ((...args: A) => R) | undefined
): ((...args: A) => R | undefined) | undefined {
  const kept = useLatestCallback((...args: A) => fn?.(...args));
  return fn === undefined ? undefined : kept;
}
