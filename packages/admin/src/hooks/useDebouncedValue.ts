"use client";

import { useEffect, useState } from "react";

/**
 * useDebouncedValue Hook
 *
 * Debounces a value by delaying its update until after a specified delay.
 * Useful for reducing API calls during rapid user input (search, filtering).
 *
 * @template T - The type of the value being debounced
 * @param value - The value to debounce
 * @param delay - Delay in milliseconds before updating the debounced value
 * @returns The debounced value
 *
 * @example
 * ```tsx
 * function SearchInput() {
 *   const [search, setSearch] = useState("");
 *   const debouncedSearch = useDebouncedValue(search, 300);
 *
 *   // API call only fires 300ms after user stops typing
 *   const { data } = useQuery({
 *     queryKey: ["search", debouncedSearch],
 *     queryFn: () => api.search(debouncedSearch),
 *     enabled: debouncedSearch.length >= 2,
 *   });
 *
 *   return <input value={search} onChange={(e) => setSearch(e.target.value)} />;
 * }
 * ```
 *
 * @performance
 * - Prevents excessive function calls during rapid input changes
 * - Cleanup function cancels pending updates on unmount
 * - Uses setTimeout for precise delay control
 *
 * @see https://tanstack.com/query/latest/docs/react/guides/query-keys
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    // Set up the timeout to update the debounced value
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    // Cleanup function: cancel the timeout if value changes before delay expires
    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * useDebouncedState Hook
 *
 * Returns a debounced value along with setter and immediate update function.
 * Useful when you need more control over the debouncing behavior.
 *
 * @template T - The type of the value being debounced
 * @param initialValue - The initial value
 * @param delay - Delay in milliseconds before updating the debounced value
 * @returns A tuple of [currentValue, debouncedValue, setValue, setImmediate]
 *
 * @example
 * ```tsx
 * function ControlledSearch() {
 *   const [value, debouncedValue, setValue, setImmediate] = useDebouncedState("", 300);
 *
 *   // value updates immediately (for input display)
 *   // debouncedValue updates after 300ms (for API calls)
 *
 *   const handleClear = () => {
 *     // setImmediate bypasses debounce for instant clearing
 *     setImmediate("");
 *   };
 *
 *   return (
 *     <div>
 *       <input value={value} onChange={(e) => setValue(e.target.value)} />
 *       <button onClick={handleClear}>Clear</button>
 *       <p>Searching for: {debouncedValue}</p>
 *     </div>
 *   );
 * }
 * ```
 *
 * @returns
 * - `value` - The current (immediate) value
 * - `debouncedValue` - The debounced value
 * - `setValue` - Function to update value (debounced)
 * - `setImmediate` - Function to update both values immediately (bypasses debounce)
 */
export function useDebouncedState<T>(
  initialValue: T,
  delay: number
): [T, T, (value: T) => void, (value: T) => void] {
  const [value, setValue] = useState(initialValue);
  const [debouncedValue, setDebouncedValue] = useState(initialValue);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  const setImmediate = (newValue: T) => {
    setValue(newValue);
    setDebouncedValue(newValue);
  };

  return [value, debouncedValue, setValue, setImmediate];
}
