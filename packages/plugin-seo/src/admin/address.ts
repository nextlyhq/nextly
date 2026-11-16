/**
 * One value of the address's query, kept in step with the admin's own moves:
 * the admin announces each with a `locationchange` event, and the browser's
 * Back with `popstate`, so a screen that reads its open tab from the address
 * follows a tab link without a reload.
 *
 * @module admin/address
 */
import { useSyncExternalStore } from "react";

/** The moves a screen reading the address follows. */
const MOVES = ["locationchange", "popstate"] as const;

function subscribe(onChange: () => void): () => void {
  for (const move of MOVES) window.addEventListener(move, onChange);
  return () => {
    for (const move of MOVES) window.removeEventListener(move, onChange);
  };
}

/** The value of `key` in the address's query, or null when it has none. */
export function useAddressParam(key: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => new URLSearchParams(window.location.search).get(key),
    () => null
  );
}
