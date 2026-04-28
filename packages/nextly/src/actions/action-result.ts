import type { PublicData } from "../errors/public-data";

/**
 * Wire shape returned by Server Actions wrapped with `withAction`.
 *
 * The `error` block matches the canonical HTTP wire-format error block
 * (modulo the discriminator), so developers learn one shape regardless of
 * whether they consume a Route Handler or a Server Action.
 */
export type ActionError = {
  code: string;
  message: string;
  messageKey?: string;
  data?: PublicData;
  requestId: string;
};

/**
 * Result of a Server Action: either `{ ok: true, data }` on success or
 * `{ ok: false, error }` on failure. The `ok` discriminator narrows
 * cleanly via `if (result.ok)` so consumers get type-safe access to either
 * branch.
 */
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ActionError };
