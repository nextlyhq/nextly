/**
 * Shim for use-sync-external-store that re-exports from React
 *
 * React 18+ has useSyncExternalStore built-in, so we don't need the shim.
 * This file replaces the shim package to avoid bundling its polyfill code
 * which has compatibility issues with React 19's changed internals.
 */
import { useSyncExternalStore } from "react";

export { useSyncExternalStore };
