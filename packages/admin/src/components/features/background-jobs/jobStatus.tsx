"use client";

/**
 * Presentational helpers for the background job monitor.
 *
 * Every status maps to an existing token-backed Badge variant, so no new colour
 * pairing is introduced, and every badge carries text rather than colour alone.
 *
 * The map is keyed by the CORE's status union, so a status added there fails to
 * compile here rather than rendering an unlabelled pill. That is the whole
 * reason the vocabulary is imported instead of restated.
 */

import { Badge } from "@nextlyhq/ui";
import type React from "react";

import type { JobDisplayStatus } from "@admin/types/jobs";

type BadgeVariant = "success" | "warning" | "destructive" | "default";

interface StatusPresentation {
  variant: BadgeVariant;
  label: string;
  /** What this status means for the person reading it. */
  hint: string;
}

/**
 * Status → presentation.
 *
 * `retrying` is deliberately NOT destructive. It is the system healing itself,
 * and colouring it like a failure is the documented common mistake in queue
 * tooling: it raises an alarm for something that needs nobody, and buries the
 * dead job among transient noise. `failed` is the only terminal bad state and
 * the only red one.
 */
const STATUS_PRESENTATION: Record<JobDisplayStatus, StatusPresentation> = {
  waiting: {
    variant: "default",
    label: "Waiting",
    hint: "Queued and not yet attempted.",
  },
  retrying: {
    variant: "warning",
    label: "Retrying",
    hint: "An attempt failed and another is scheduled. No action needed.",
  },
  running: {
    variant: "default",
    label: "Running",
    hint: "A runner holds this job right now.",
  },
  succeeded: {
    variant: "success",
    label: "Succeeded",
    hint: "Finished.",
  },
  failed: {
    variant: "destructive",
    label: "Failed",
    hint: "Attempts are spent. This will not happen without a person.",
  },
};

/**
 * Resolve a status as it arrives on the wire — an untrusted string — to its
 * presentation. A value this build does not know falls back to a neutral pill
 * showing it verbatim rather than rendering nothing, so a server ahead of the
 * client degrades to "unfamiliar" instead of "blank".
 */
export function jobStatusPresentation(status: string): StatusPresentation {
  const known = Object.prototype.hasOwnProperty.call(
    STATUS_PRESENTATION,
    status
  )
    ? (status as JobDisplayStatus)
    : null;
  return known
    ? STATUS_PRESENTATION[known]
    : { variant: "default", label: status, hint: "" };
}

/** Status pill for a job row. */
export const JobStatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const presentation = jobStatusPresentation(status);
  return (
    <Badge variant={presentation.variant} title={presentation.hint}>
      {presentation.label}
    </Badge>
  );
};

/**
 * Render an ISO-8601 instant in the viewer's locale and timezone.
 *
 * The jobs read opts out of server-side timezone rewriting so a `lastError`
 * that is itself a timestamp survives verbatim, which means every instant on
 * this screen arrives in UTC and is formatted here.
 */
export function formatJobTimestamp(iso: string | null): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

/**
 * How long ago, in the coarsest unit that is still true.
 *
 * "4 minutes ago" answers an operator's actual question — is this moving —
 * where a wall-clock time makes them do the subtraction. The absolute time
 * stays available as the cell's tooltip.
 */
export function formatJobAge(iso: string, now: Date): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return iso;
  const seconds = Math.round((now.getTime() - then.getTime()) / 1000);
  const ahead = seconds < 0;
  const magnitude = Math.abs(seconds);
  const say = (value: number, unit: string): string => {
    const plural = `${value} ${unit}${value === 1 ? "" : "s"}`;
    return ahead ? `in ${plural}` : `${plural} ago`;
  };
  if (magnitude < 45) return ahead ? "in a moment" : "just now";
  if (magnitude < 3600) return say(Math.round(magnitude / 60), "minute");
  if (magnitude < 86_400) return say(Math.round(magnitude / 3600), "hour");
  return say(Math.round(magnitude / 86_400), "day");
}
