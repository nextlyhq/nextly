/**
 * Core's System health card, declared with `defineWidget` as a plugin
 * declares its own: the Nextly version, whether migrations are applied, and
 * whether storage is working, for super-admins only. One module per widget;
 * `core-widgets/index.ts` lists them in their order.
 *
 * ## Only a super-admin is told it exists
 *
 * Its id is in `SUPER_ADMIN_WIDGET_IDS`, which the dashboard's one audience
 * decision reads: nobody else is offered it, may place it or is handed its
 * card. Its read also asks again, as the caller its services were bound for,
 * before it reads anything, so no path that skipped the audience reaches it.
 *
 * ## It is never hidden for being empty
 *
 * Its three lines are always drawn, "up to date" and "working" included: a
 * card that left the dashboard while all was well would read the same as one
 * nobody could load.
 *
 * ## Its read is handed in
 *
 * The read is given to this module by the System health source when it is
 * registered (`provideSystemHealth`), rather than imported: the widget list is
 * read by the admin's tests and by every reader of core's ids, none of which
 * should reach the ledger and storage modules it reads through.
 *
 * @module domains/widgets/core-widgets/system-health
 */

import { NextlyError } from "../../../errors/nextly-error";
import {
  defineWidget,
  type WidgetReadServices,
} from "../declaration/define-widget";
import { processHeld } from "../process-held";

import { CORE_WIDGET_ID } from "./ids";

/** Whether migrations are applied: all of them, some still applying, or some that did not finish. */
export type SystemHealthMigrationStatus = "ok" | "pending" | "failed";

/** What System health answers: plain JSON, which is what reaches the browser. */
export interface SystemHealthData {
  /** The running Nextly version, such as "0.0.2-alpha.66". */
  version: string;
  migrations: {
    status: SystemHealthMigrationStatus;
    /** Migrations whose last attempt failed or never finished. */
    failed: number;
    /**
     * Migrations still being applied: by this process at boot, or by another
     * (a CLI, a second instance) that recorded an attempt within the stale
     * threshold; 0 when unknown.
     */
    pending: number;
  };
  /** Collections whose last schema change failed, the first few by label. */
  schemaChanges: {
    failed: { slug: string; label: string }[];
    /** How many more failed beyond those listed. */
    more: number;
  };
  storage: {
    status: "ok" | "failed";
    /** When the last write failed, as an ISO 8601 instant. */
    failedAt?: string;
    /** The adapter's type: "local", "s3". */
    adapter?: string;
    /** One short, non-sensitive sentence saying what went wrong. */
    reason?: string;
  };
}

/** The System health read for the caller a card's read services were bound for. */
type SystemHealthRead = (
  services: WidgetReadServices,
  opts: { signal: AbortSignal }
) => Promise<SystemHealthData>;

/**
 * The read the System health source provided, held for the process
 * (`processHeld`): Next.js and Turbopack can evaluate this module in more than
 * one server graph, and the source registered at boot and the card answered
 * on a request can each hold a different copy.
 */
const provided = processHeld(
  "nextly.dashboard.systemHealth",
  (): { read?: SystemHealthRead } => ({}),
  (held): held is { read?: SystemHealthRead } =>
    typeof held === "object" && held !== null
);

/** Hands the card its read; the System health source does, when it is registered. */
export function provideSystemHealth(read: SystemHealthRead): void {
  provided.read = read;
}

/** A healthy install, for the preview page. */
const HEALTHY: SystemHealthData = {
  version: "0.0.2-alpha.66",
  migrations: { status: "ok", failed: 0, pending: 0 },
  schemaChanges: { failed: [], more: 0 },
  storage: { status: "ok" },
};

/** An install with a problem on every line, for the preview page. */
const WITH_PROBLEMS: SystemHealthData = {
  version: "0.0.2-alpha.66",
  migrations: { status: "failed", failed: 1, pending: 0 },
  schemaChanges: { failed: [{ slug: "posts", label: "Posts" }], more: 0 },
  storage: {
    status: "failed",
    failedAt: "2026-10-30T08:00:00.000Z",
    adapter: "s3",
    reason: "The storage service could not be reached.",
  },
};

export const systemHealthWidget = defineWidget({
  id: CORE_WIDGET_ID.systemHealth,
  title: "System health",
  description:
    "The Nextly version, and whether migrations and storage are working. For super-admins.",
  // A third of the width by default, three rows tall: one row per line and
  // room for a problem's link. Two rows at the least, which still hold the
  // three lines; wider gives the links more room.
  size: {
    default: { w: 4, h: 3 },
    min: { w: 4, h: 2 },
    max: { w: 8, h: 4 },
  },
  load: async ({ services, signal }) => {
    const read = provided.read;
    if (read === undefined) {
      // Booted without the System health source: a fault of the install,
      // never a card claiming all is well.
      throw NextlyError.internal({
        logContext: { reason: "system-health-not-provided" },
      });
    }
    return read(services, { signal });
  },
  view: { component: "core#SystemHealth" },
  // Never empty: its three lines are the answer whatever they say.
  isEmpty: () => false,
  preview: [
    { name: "Healthy", data: HEALTHY },
    { name: "With problems", data: WITH_PROBLEMS },
  ],
});
