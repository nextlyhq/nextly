"use client";

import { useCallback, useRef, useEffect } from "react";

/**
 * Returns a debounced version of the callback function.
 * The debounced function will delay invoking the callback until after
 * the specified delay has elapsed since the last time it was invoked.
 *
 * @template T - The callback function type
 * @param callback - The function to debounce
 * @param delay - Delay in milliseconds before invoking the callback
 * @returns A debounced version of the callback function
 *
 * @example
 * ```tsx
 * function SearchComponent() {
 *   const handleSearch = useDebounce((query: string) => {
 *     console.log("Searching for:", query);
 *     // API call here
 *   }, 300);
 *
 *   return (
 *     <input
 *       type="text"
 *       onChange={(e) => handleSearch(e.target.value)}
 *     />
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // With async callback
 * const debouncedFetch = useDebounce(async (id: string) => {
 *   const data = await fetchData(id);
 *   setResult(data);
 * }, 500);
 * ```
 *
 * @performance
 * - Uses refs to avoid stale closure issues
 * - Cleanup function cancels pending invocations on unmount
 * - Stable function reference (only changes when delay changes)
 */
export function useDebounce<T extends (...args: never[]) => unknown>(
  callback: T,
  delay: number
): T {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef(callback);

  // Keep callback ref up to date to avoid stale closures
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return useCallback(
    ((...args: Parameters<T>) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        callbackRef.current(...args);
      }, delay);
    }) as T,
    [delay]
  );
}
