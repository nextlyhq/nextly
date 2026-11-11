/**
 * Core's System health card, declared with `defineWidget` as a plugin
 * declares its own, for super-admins only: the Nextly version and whether it
 * is the newest in its channel, the environment, the database and whether its
 * connection is encrypted, migrations, storage, email and background jobs;
 * with the runtime and plugins for its Details. One module per widget;
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
 * Its lines are always drawn, "up to date" and "working" included: a card
 * that left the dashboard while all was well would read the same as one
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
import type { DatabaseHealth } from "../../health/database-health";
import type { EmailHealth } from "../../health/email-health";
import type { JobsHealth } from "../../health/jobs-health";
import type { LatestVersion } from "../../health/latest-version";
import type { PluginHealth, RuntimeHealth } from "../../health/runtime-health";
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
  /** The running version against its release channel's newest. */
  latest: LatestVersion;
  /**
   * Whether the server runs in production, and the site's own name for the
   * deployment (`admin.environment.label`), when it gives one.
   */
  environment: { production: boolean; label?: string };
  /** The database, its round trip, and whether its connection is encrypted. */
  database: DatabaseHealth;
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
    /** The storage adapter's type: "local", "s3", "vercel-blob"; absent when unread. */
    type?: string;
    /** When the last write failed, as an ISO 8601 instant. */
    failedAt?: string;
    /** The adapter's type: "local", "s3". */
    adapter?: string;
    /** One short, non-sensitive sentence saying what went wrong. */
    reason?: string;
  };
  /** The provider email is sent through; `null` when it could not be read. */
  email: EmailHealth | null;
  /** Background jobs by state; `null` when they could not be counted. */
  jobs: JobsHealth | null;
  /** Node, Next.js and React, for Details. */
  runtime: RuntimeHealth;
  /** Each plugin by name and version, for Details. */
  plugins: PluginHealth[];
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

/** The runtime and plugins every preview shows. */
const PREVIEW_DETAILS = {
  runtime: { node: "24.11.0", next: "16.0.1", react: "19.2.0" },
  plugins: [{ name: "@nextlyhq/plugin-seo", version: "0.0.2-alpha.66" }],
} satisfies Pick<SystemHealthData, "runtime" | "plugins">;

/** A healthy install, for the preview cases. */
const HEALTHY: SystemHealthData = {
  version: "0.0.2-alpha.66",
  latest: { status: "latest", version: "0.0.2-alpha.66" },
  environment: { production: true },
  database: {
    dialect: "postgresql",
    serverVersion: "17.2",
    roundTripMs: 4,
    encryption: "encrypted",
    exposed: true,
  },
  migrations: { status: "ok", failed: 0, pending: 0 },
  schemaChanges: { failed: [], more: 0 },
  storage: { status: "ok", type: "s3" },
  email: { provider: "Resend" },
  jobs: { queued: 2, running: 0, failed: 0 },
  ...PREVIEW_DETAILS,
};

/** An install with a problem on every line, for the preview cases. */
const WITH_PROBLEMS: SystemHealthData = {
  version: "0.0.2-alpha.66",
  latest: { status: "unknown" },
  environment: { production: true },
  database: {
    dialect: "postgresql",
    serverVersion: "17.2",
    roundTripMs: 4,
    encryption: "unencrypted",
    exposed: true,
  },
  migrations: { status: "failed", failed: 1, pending: 0 },
  schemaChanges: { failed: [{ slug: "posts", label: "Posts" }], more: 0 },
  storage: {
    status: "failed",
    type: "s3",
    failedAt: "2026-10-30T08:00:00.000Z",
    adapter: "s3",
    reason: "The storage service could not be reached.",
  },
  email: { provider: null },
  jobs: { queued: 2, running: 0, failed: 3 },
  ...PREVIEW_DETAILS,
};

export const systemHealthWidget = defineWidget({
  id: CORE_WIDGET_ID.systemHealth,
  title: "System health",
  description:
    "Versions, database, migrations, storage, email and jobs. For super-admins.",
  // Half the width by default: a fact's name, its value and a chip or a
  // "How to fix" fit on one line. A third at the least, two thirds at the
  // most. Heights fit the content; `h` is kept for stored layouts.
  size: {
    default: { w: 6, h: 4 },
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
  // Never empty: its lines are the answer whatever they say.
  isEmpty: () => false,
  preview: [
    { name: "Healthy", data: HEALTHY },
    { name: "With problems", data: WITH_PROBLEMS },
  ],
});
