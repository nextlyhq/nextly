"use client";

/**
 * Presentational helpers for the webhook delivery log. Delivery status and
 * per-attempt outcome map to the existing token-backed Badge variants (already
 * covered by the UI contrast test), so no new colour pairing is introduced.
 * Every badge carries text, never colour alone.
 */

import { Badge } from "@nextlyhq/ui";
import type React from "react";

import type { WebhookDeliveryStatus } from "@admin/types/webhooks";

type BadgeVariant = "success" | "warning" | "destructive" | "default";

/** Delivery status → badge variant + human label. */
const STATUS_PRESENTATION: Record<
  WebhookDeliveryStatus,
  { variant: BadgeVariant; label: string }
> = {
  delivered: { variant: "success", label: "Delivered" },
  retrying: { variant: "warning", label: "Retrying" },
  pending: { variant: "warning", label: "Pending" },
  processing: { variant: "default", label: "Processing" },
  failed: { variant: "destructive", label: "Failed" },
};

/** Status pill for a delivery row/detail. */
export const DeliveryStatusBadge: React.FC<{
  status: WebhookDeliveryStatus;
}> = ({ status }) => {
  // An unrecognized status (a value added server-side ahead of the UI) stays
  // legible as a neutral pill rather than crashing the row.
  const presentation = STATUS_PRESENTATION[status] ?? {
    variant: "default" as const,
    label: status,
  };
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
