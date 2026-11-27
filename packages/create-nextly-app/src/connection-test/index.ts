/**
 * The connection test for a PostgreSQL or MySQL project, run before anything
 * is written: connect, read the version, see what the database holds, offer
 * to create a missing database on this machine, and say plainly what is wrong.
 */
export {
  connectedLine,
  testConnection,
  NEXTLY_TABLES,
} from "./test-connection";
export { createDatabase } from "./create-database";
export {
  connectInteractively,
  TESTED_BEFORE_CREATING,
  type ConnectionOutcome,
  type ConnectionPromptIO,
} from "./prompt";
export type {
  Connect,
  Connected,
  ConnectionResult,
  NotConnected,
  ServerDialect,
} from "./types";
