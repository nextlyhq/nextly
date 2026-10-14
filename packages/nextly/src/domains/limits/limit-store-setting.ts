/**
 * What `rateLimit.store` selects.
 *
 * The setting takes `"memory"` (the default), `"database"`, an app's own
 * store of the {@link LimitStore} contract, or, as before, an app's store of
 * the earlier {@link RateLimitStore} contract. A store of the earlier contract
 * keeps serving core's own limits, which were built on it; limits built on
 * the newer contract then count in memory, and say so.
 *
 * @module domains/limits/limit-store-setting
 */
import { NextlyError } from "../../errors/nextly-error";
import {
  isRateLimitStore,
  type RateLimitStore,
} from "../../middleware/rate-limit";

import { isLimitStore, type LimitStore } from "./limit-store";

/** What `rateLimit.store` may be set to. */
export type RateLimitStoreSetting =
  | "memory"
  | "database"
  | LimitStore
  | RateLimitStore;

/** The store limits on the newer contract count in. */
export type LimitStoreSelection = "memory" | "database" | LimitStore;

/** What the setting selects, for each contract. */
export interface ResolvedStoreSetting {
  /** The store limits on the newer contract count in. */
  selection: LimitStoreSelection;
  /** An app's store of the earlier contract, for core's own limits. */
  legacy?: RateLimitStore;
}

/**
 * Resolve `rateLimit.store`.
 *
 * @throws {NextlyError} `VALIDATION_ERROR` naming the setting, for a value
 *   that is none of the choices
 */
export function resolveStoreSetting(setting: unknown): ResolvedStoreSetting {
  const legacy = isRateLimitStore(setting) ? setting : undefined;
  if (setting === undefined || setting === "memory") {
    return { selection: "memory" };
  }
  if (setting === "database") return { selection: "database" };
  if (isLimitStore(setting)) return { selection: setting, legacy };
  if (legacy) return { selection: "memory", legacy };
  throw NextlyError.validation({
    errors: [
      {
        path: "rateLimit.store",
        code: "INVALID_VALUE",
        message:
          'Must be "memory", "database", or a store implementing the limit store contract.',
      },
    ],
  });
}
