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

import { resolveWebhookRecording } from "./resolve-recording-config";

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

/**
 * Resolve the CODE-FIRST `webhooks` option into the value the registry column
 * holds. The authored option is a `boolean | { record?: boolean }` union rather
 * than the Builder's plain on/off, so it is normalized through
 * `resolveWebhookRecording` first and then mapped by the same rule: recording
 * (the default) stores null, an opt-out stores `{ record: false }`.
 *
 * Used by the code-first sync payload builders so a `webhooks: false` in config
 * is mirrored onto the row, not just published to the in-process policy.
 */
export function storedWebhookRecording(
  webhooks: boolean | { record?: boolean } | undefined
): StoredWebhookRecording | null {
  return resolveBuilderWebhooks(resolveWebhookRecording(webhooks).record);
}
