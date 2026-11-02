/**
 * Shim for use-sync-external-store that re-exports from React
 *
 * React has useSyncExternalStore built in, so the shim is not needed.
 * This file replaces the shim package to avoid bundling its polyfill code
 * which has compatibility issues with React 19's changed internals.
 */
import { useSyncExternalStore } from "react";

export { useSyncExternalStore };
