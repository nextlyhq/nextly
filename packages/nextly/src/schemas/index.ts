/**
 * Public schemas barrel for Nextly.
 *
 * Single canonical entry point for the framework's system table definitions,
 * for user code that wants to query core tables directly. The package's own
 * pipeline callers (boot-apply, db-sync, migrate, migrate:create) ask
 * `./core-schema` instead, which loads only the running dialect's tables; this
 * entry also re-exports PostgreSQL's.
 *
 * Public contract:
 *   - getCoreSchema(dialect) → NextlySchemaSnapshot
 *   - CORE_TABLE_NAMES: readonly string[]
 *   - CORE_TABLE_PREFIXES: readonly string[]
 *   - Named Drizzle table re-exports (users, roles, etc.) under their
 *     canonical names.
 *
 * @module schemas
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

// The core schema and table names live in `./core-schema`; re-exported here,
// so `nextly/schemas` keeps every name it published.
export {
  CORE_TABLE_NAMES,
  CORE_TABLE_PREFIXES,
  type CoreSchemaOptions,
  getCoreSchema,
  getCoreTableNames,
} from "./core-schema";

// `getCoreSchema` reads a loaded dialect's tables, which creating the adapter
// loads; code that wants the schema without an adapter awaits this first.
export { loadDialectTables } from "../database/dialect-tables";

// =============================================================================
// Transitional re-exports — kept so existing consumers keep building during
// the feature-by-feature migration. Each existing export is dropped from this
// list as its replacement lands in schemas/<feature>/.
// =============================================================================

export * from "./_zod"; // Zod-only validators (user, rbac, validation)

// Plan A Task 5 — user identity tables. PG re-exports here for direct-query
// callers. Other dialects accessible via getCoreSchema(dialect).
export { users } from "./users/postgres";

// Plan A Task 6 — auth-token tables. PG re-exports for direct-query callers.
export {
  emailVerificationTokens,
  passwordResetTokens,
  userInviteTokens,
  refreshTokens,
} from "./auth-tokens/postgres";

// Plan A Task 7 — RBAC tables (Drizzle). PG re-exports for direct-query callers.
// Distinct from schemas/_zod/rbac.ts which holds the Zod validators.
export {
  roles,
  permissions,
  rolePermissions,
  userRoles,
  roleInherits,
} from "./rbac/postgres";

// Plan A Task 8 — media tables. PG re-exports for direct-query callers.
export { media, mediaFolders, imageSizes } from "./media/postgres";

// Plan A Task 9 — audit tables. PG re-exports for direct-query callers.
export { auditLog, activityLog } from "./audit/postgres";

// Plan A Task 10 — nextly_meta runtime key/value flags table.
export { nextlyMeta } from "./nextly-meta/postgres";
// Plan B — schema-events bookkeeping table. PG re-export for direct-query callers.
export { nextlySchemaEventsPg as nextlySchemaEvents } from "./schema-events/postgres";

// Content-versioning store. PG re-export for direct-query callers, matching the
// other managed core tables listed in CORE_TABLE_NAMES.
export { nextlyVersionsPg as nextlyVersions } from "./versions/postgres";
export * from "./dynamic-collections"; // dialect-aware barrel — kept; unchanged
export * from "./dynamic-field-groups"; // kept; unchanged
// Plan A Task 11 — apiKeys (Drizzle). PG re-exports for direct-query callers.
// The Zod validators (CreateApiKeySchema, UpdateApiKeySchema, etc.) live at
// schemas/_zod/api-keys.ts and are re-exported via `export * from "./_zod"`
// at the top of this file.
export { apiKeys } from "./api-keys/postgres";
// Webhook + event system tables. PG re-exports for direct-query callers who
// want to inspect the event/webhook/delivery ledger via the `nextly/schemas`
// subpath; other dialects are reachable through getCoreSchema(dialect).
export {
  nextlyEvents,
  nextlyWebhooks,
  nextlyWebhookDeliveries,
} from "./webhooks/postgres";
export * from "./security-config"; // Zod — review in Task 19

// Content-release lifecycle vocabulary. Types only: the admin renders a state
// and must not be able to name one the engine cannot produce, and a second
// spelling of these unions in a client is how a screen starts describing a
// state the server has never sent.
export type {
  ReleaseState,
  ReleaseKind,
  ReleaseMemberAction,
  ReleaseBlockerReason,
  ReleaseCapabilities,
} from "./releases/types";
// The one value a client needs to say a release is full or over the limit,
// from the declaration the server refuses with rather than a copy of it.
export { RELEASE_MEMBER_LIMIT } from "./releases/types";
