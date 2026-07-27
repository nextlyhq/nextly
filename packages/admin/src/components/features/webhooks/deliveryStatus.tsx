"use client";

/**
 * Presentational helpers for the webhook delivery log. Delivery status and
 * per-attempt outcome map to the existing token-backed Badge variants (already
 * covered by the UI contrast test), so no new colour pairing is introduced.
 * Every badge carries text, never colour alone.
 */

import { Badge } from "@nextlyhq/ui";
import type React from "react";

import {
  WEBHOOK_DELIVERY_STATUSES,
  type WebhookDeliveryStatus,
} from "@admin/types/webhooks";

type BadgeVariant = "success" | "warning" | "destructive" | "default";

interface StatusPresentation {
  variant: BadgeVariant;
  label: string;
}

/** Delivery status → badge variant + human label. */
const STATUS_PRESENTATION: Record<WebhookDeliveryStatus, StatusPresentation> = {
  delivered: { variant: "success", label: "Delivered" },
  retrying: { variant: "warning", label: "Retrying" },
  pending: { variant: "warning", label: "Pending" },
  processing: { variant: "default", label: "Processing" },
  failed: { variant: "destructive", label: "Failed" },
};

/**
 * Resolve a delivery status (as it arrives on the wire, i.e. an untrusted
 * string) to its badge presentation. A status the UI does not know — a value
 * the server could add ahead of the client — falls back to a neutral pill
 * showing the raw value rather than crashing. Accepts `string` so this stays
 * verifiable without asserting an out-of-union value; the lookup is keyed only
 * through the known-status list, so no type cast is needed.
 */
export function deliveryStatusPresentation(status: string): StatusPresentation {
  const known = WEBHOOK_DELIVERY_STATUSES.find(value => value === status);
  return known
    ? STATUS_PRESENTATION[known]
    : { variant: "default", label: status };
}

/** Status pill for a delivery row/detail. */
export const DeliveryStatusBadge: React.FC<{
  status: WebhookDeliveryStatus;
}> = ({ status }) => {
  const presentation = deliveryStatusPresentation(status);
  return <Badge variant={presentation.variant}>{presentation.label}</Badge>;
};

/**
 * Map a free-text attempt outcome (engine-authored, e.g. `delivered`,
 * `retrying`, `failed`, `abandoned`) to a badge variant. Unknown outcomes read
 * as neutral.
 */
function attemptVariant(outcome: string): BadgeVariant {
  const normalized = outcome.toLowerCase();
  if (normalized === "delivered") return "success";
  if (normalized === "failed") return "destructive";
  if (normalized === "retrying" || normalized === "pending") return "warning";
  return "default";
}

/** Outcome pill for a single attempt in the timeline. */
export const AttemptOutcomeBadge: React.FC<{ outcome: string }> = ({
  outcome,
}) => <Badge variant={attemptVariant(outcome)}>{outcome}</Badge>;

/**
 * Render an ISO-8601 instant in the viewer's locale/timezone. The delivery
 * reads return raw UTC instants (server-side timezone rewriting is skipped so
 * captured error/response text survives verbatim), so the client formats them.
 * An absent or unparseable value shows an em-dash-free placeholder.
 */
export function formatDeliveryTimestamp(iso: string | null): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

/** Compact HTTP status + latency, or a placeholder when not yet attempted. */
export function formatStatusCode(code: number | null): string {
  return code === null ? "-" : String(code);
}

/** Latency in milliseconds, or a placeholder when absent. */
export function formatLatency(ms: number | null | undefined): string {
  return ms === null || ms === undefined ? "-" : `${ms}ms`;
}

/** A one-line description of the resource an event was about. */
export function describeResource(resource: {
  kind: string;
  collection: string | null;
  id: string | null;
  locale: string | null;
}): string {
  const scope = resource.collection ?? resource.kind;
  const parts = [scope];
  if (resource.id) parts.push(resource.id);
  const base = parts.join(" · ");
  return resource.locale ? `${base} (${resource.locale})` : base;
}
