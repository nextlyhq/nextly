/**
 * Whether a start is a production start, the one question every step of a
 * start that behaves differently in production asks.
 *
 * A production start serves the bookkeeping `nextly migrate` wrote (the
 * registry rows, the permissions, the roles and their grants, the user field
 * definitions) and writes none of it: an older or a newer build starting
 * against the database leaves it as the deployment that migrated it left it.
 * Its only writes are its own: the setup token, the seals of stored secrets,
 * on SQLite the journal mode, and after it resolves the email templates'
 * reconciliation and on SQLite the one-time timestamp repair. A development
 * start (`next dev`) keeps the live sync, writing the bookkeeping from the
 * configuration as it changes.
 *
 * Read from `NODE_ENV` as it is at the call, as the start's other production
 * gates read it (the schema version report, the setup token, the development
 * schema lock), so the start's steps cannot disagree about which kind of start
 * they are in. `next start` and `next build` run with `NODE_ENV=production`.
 *
 * @module init/production-start
 */

/** Whether a start begun now is a production start. */
export function isProductionStart(): boolean {
  return process.env.NODE_ENV === "production";
}
