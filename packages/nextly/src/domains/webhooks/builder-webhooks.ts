/**
 * The Schema Builder's webhook-recording switch, as the registry stores it.
 *
 * Every path that persists the switch goes through here so they cannot drift:
 * the builder's create and update handlers, the single dispatcher, the
 * standalone schema routes, and the `ui-schema.json` metadata upserts. Mirrors
 * `revalidation/builder-revalidate`.
 *
 * @module domains/webhooks/builder-webhooks
 */

import type { StoredWebhookRecording } from "../../schemas/dynamic-collections/types";

/**
 * Resolve the switch into the value the registry column holds.
 *
 * Recording is on by default, so ON is stored as null (no override) and OFF as
 * `{ record: false }`. Storing the default as null keeps the column additive: a
 * database predating it reads null everywhere and behaves unchanged, and only
 * an operator who deliberately turned recording off occupies the column.
 */
export function resolveBuilderWebhooks(
  enabled: boolean | undefined
): StoredWebhookRecording | null {
  return enabled === false ? { record: false } : null;
}
