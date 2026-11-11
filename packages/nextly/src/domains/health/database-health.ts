/**
 * The database line of System health: which database, how quickly it answered,
 * and whether the site's connection to it is encrypted, as the adapter read it
 * from the database session; and the one rule that makes an unencrypted or
 * unchecked connection something to act on.
 *
 * ## Where the connection is exposed
 *
 * An unencrypted connection matters where its traffic crosses a network: in
 * production, to a database on another machine. A database on this machine (a
 * loopback address or a local socket, judged by the adapter from its own
 * configuration, so the address never reaches here) or a development server
 * is not exposed, and its connection is shown and not counted.
 *
 * @module domains/health/database-health
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

/** What an adapter can be asked about its connection. */
export interface InspectableAdapter {
  dialect: DatabaseHealth["dialect"];
  inspectConnection?: () => Promise<ConnectionInspection>;
}

/**
 * The database line, from the adapter's own read of its connection. An
 * adapter that cannot be asked, or whose read throws, is "unknown" and
 * remote: never encrypted, and never excused for an address not judged.
 */
export async function readDatabaseHealth(
  adapter: InspectableAdapter,
  production: boolean
): Promise<DatabaseHealth> {
  let inspection: ConnectionInspection = {
    encryption: "unknown",
    local: false,
  };
  try {
    if (adapter.inspectConnection !== undefined) {
      inspection = await adapter.inspectConnection();
    }
  } catch {
    // The adapters answer "unknown" rather than throw; one that throws anyway
    // is read the same way.
  }
  return {
    dialect: adapter.dialect,
    ...(inspection.serverVersion === undefined
      ? {}
      : { serverVersion: inspection.serverVersion }),
    ...(inspection.roundTripMs === undefined
      ? {}
      : { roundTripMs: inspection.roundTripMs }),
    encryption: inspection.encryption,
    exposed: production && !inspection.local,
  };
}

/**
 * What the connection asks of a reader, where it is exposed: a danger when it
 * is not encrypted, a warning when whether it is could not be read. Nothing
 * where it is encrypted, not applicable, or not exposed.
 */
export function connectionAttention(
  database: Pick<DatabaseHealth, "encryption" | "exposed">
): "unencrypted" | "unchecked" | undefined {
  if (!database.exposed) return undefined;
  if (database.encryption === "unencrypted") return "unencrypted";
  if (database.encryption === "unknown") return "unchecked";
  return undefined;
}
