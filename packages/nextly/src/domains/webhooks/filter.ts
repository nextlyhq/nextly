/**
 * Webhook domain — filter matching (pure).
 *
 * `matchesFilter` decides whether one endpoint's filter accepts one envelope.
 * Run at fan-out time for every (envelope, endpoint) pair, so it stays a small
 * allocation-free predicate.
 *
 * @module domains/webhooks/filter
 */

import type { FilterSpec, WebhookEvent } from "./types";

/**
 * Whether `filter` accepts `envelope`.
 *
 * A null/undefined filter matches everything (the endpoint's subscribed event
 * types are enforced separately at fan-out). For the v1 spec, all present
 * constraints must hold (a conjunction):
 * - `eventTypes`: OR across the listed types; absent/empty = any type.
 * - `collections`: envelope's collection must be listed; null/absent = all.
 * - `changedFields`: at least one listed field must appear in the envelope's
 *   `changedFields`; null/absent = no constraint.
 *
 * An unknown/unsupported filter version fails closed (returns false): we never
 * deliver against a filter we cannot evaluate.
 */
export function matchesFilter(
  filter: FilterSpec | null | undefined,
  envelope: WebhookEvent
): boolean {
  if (filter == null) return true;
  if (filter.version !== 1) return false;

  const { eventTypes, collections, changedFields } = filter;

  if (
    eventTypes != null &&
    eventTypes.length > 0 &&
    !eventTypes.includes(envelope.type)
  ) {
    return false;
  }

  if (collections != null) {
    const collection = envelope.resource.collection;
    if (collection === undefined || !collections.includes(collection)) {
      return false;
    }
  }

  if (changedFields != null && changedFields.length > 0) {
    const changed = new Set(envelope.changedFields);
    if (!changedFields.some(f => changed.has(f))) return false;
  }

  return true;
}
