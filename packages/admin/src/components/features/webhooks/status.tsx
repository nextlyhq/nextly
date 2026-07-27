"use client";

/**
 * Presentational helpers for webhook status. Uses the existing token-backed
 * Badge variants (already covered by the UI contrast test), so no new colour
 * pairing is introduced.
 */

import { Badge } from "@nextlyhq/ui";
import type React from "react";

import {
  WEBHOOK_EVENT_WILDCARD,
  type WebhookEventSubscription,
} from "@admin/types/webhooks";

/** Enabled/disabled pill for an endpoint. */
export const EndpointStatusBadge: React.FC<{ enabled: boolean }> = ({
  enabled,
}) =>
  enabled ? (
    <Badge variant="success">Enabled</Badge>
  ) : (
    <Badge variant="default">Disabled</Badge>
  );

/** A compact label for an endpoint's event subscription. */
export function describeEvents(eventTypes: WebhookEventSubscription[]): string {
  if (eventTypes.includes(WEBHOOK_EVENT_WILDCARD)) return "All events";
  if (eventTypes.length === 1) return "1 event";
  return `${eventTypes.length} events`;
}
