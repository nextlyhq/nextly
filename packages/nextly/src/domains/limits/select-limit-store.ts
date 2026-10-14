/**
 * Building the limit store `rateLimit.store` selects.
 *
 * @module domains/limits/select-limit-store
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { withCallDeadline } from "./call-deadline";
import { createDatabaseLimitStore } from "./database-limit-store";
import type { LimitStore } from "./limit-store";
import type { LimitStoreSelection } from "./limit-store-setting";
import { createMemoryLimitStore } from "./memory-limit-store";
import { limitStoreGeneration } from "./store-generation";

/** What a selected store needs from the running install. */
export interface LimitStoreDeps {
  adapter: DrizzleAdapter;
  /** The install's current secret; its generation names the database store's entries. */
  secret: string | undefined;
  /** The most live entries, when the site set it. */
  maxEntries?: number;
}

/** A selected store, and what stops what it runs on its own. */
export interface SelectedLimitStore {
  /** The store, every call answered within its time. */
  store: LimitStore;
  /** Stop the store's own sweeping, once a sweep under way has finished. Calls still work afterwards. */
  readonly close: () => Promise<void>;
}

/** Build the store `selection` names. */
export function selectLimitStore(
  selection: LimitStoreSelection,
  deps: LimitStoreDeps
): SelectedLimitStore {
  if (selection === "memory") {
    return {
      store: withCallDeadline(
        createMemoryLimitStore({ maxEntries: deps.maxEntries })
      ),
      close: () => Promise.resolve(),
    };
  }
  if (selection === "database") {
    const store = createDatabaseLimitStore({
      adapter: deps.adapter,
      generation: limitStoreGeneration(deps.secret),
      maxEntries: deps.maxEntries,
    });
    return { store: withCallDeadline(store), close: () => store.close() };
  }
  // An app's own store: its bound and its sweeping are its own.
  return {
    store: withCallDeadline(selection),
    close: () => Promise.resolve(),
  };
}
