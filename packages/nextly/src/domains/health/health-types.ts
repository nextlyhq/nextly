/**
 * The facts System health reports, as plain types.
 *
 * Apart from the modules that read them, so that what the widget declares
 * about its answer (`core-widgets/system-health.ts`) depends on no server
 * code: the widget list is read by the admin's own tests and type check,
 * which cannot load the database, email or jobs code the reads use.
 *
 * @module domains/health/health-types
 */
import type { ConnectionInspection } from "@nextlyhq/adapter-drizzle/types";

/** The database line, as the card, Details and the report read it. */
export interface DatabaseHealth {
  dialect: "postgresql" | "mysql" | "sqlite";
  /** The server's version ("17.2"), or SQLite's library version; absent when unread. */
  serverVersion?: string;
  /** How long one small query took, in whole milliseconds; absent when it failed. */
  roundTripMs?: number;
  /** Whether the connection is encrypted, from the session; "unknown" is never a pass. */
  encryption: ConnectionInspection["encryption"];
  /**
   * Whether the connection crosses a network a site must protect: production,
   * and a database on another machine. Never the address itself.
   */
  exposed: boolean;
}

/** The email line. */
export interface EmailHealth {
  /** The sending provider's label, or `null` when none is set up. */
  provider: string | null;
}

/** The jobs line. */
export interface JobsHealth {
  /** Waiting to run: due now, scheduled, or waiting to retry. */
  queued: number;
  running: number;
  /** Failed for good within the last 24 hours. */
  failed: number;
}

/**
 * The installed version against its channel's newest: the newest itself,
 * behind it, or unknown when the newest could not be read.
 */
export type LatestVersion =
  | { status: "latest"; version: string }
  | { status: "update"; version: string }
  | { status: "unknown" };

/** The runtime line of Details. */
export interface RuntimeHealth {
  node: string;
  next?: string;
  react?: string;
}

/** One plugin, as Details lists it. */
export interface PluginHealth {
  name: string;
  version: string;
}
