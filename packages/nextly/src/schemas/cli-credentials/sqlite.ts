/**
 * `nextly_cli_credentials` on SQLite. See `postgres.ts` for what each column
 * is for. `database/sqlite-core-tables.ts` creates the same table for a
 * SQLite database bootstrapped without migrations.
 *
 * @module schemas/cli-credentials/sqlite
 */
// The same table in each dialect's Drizzle builders: each dialect's column
// functions are distinct, so the declarations cannot be shared, and
// `sqlite-core-tables.test.ts` with the schema pipeline's own checks hold
// them in step.
// fallow-ignore-file code-duplication
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { users } from "../users/sqlite";

import { CLI_CREDENTIALS_TABLE } from "./table-name";

export const nextlyCliCredentialsSqlite = sqliteTable(
  CLI_CREDENTIALS_TABLE,
  {
    id: text("id").primaryKey(),
    purpose: text("purpose").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    familyId: text("family_id").notNull(),
    parentId: text("parent_id"),
    agentName: text("agent_name"),
    door: text("door").notNull(),
    machine: text("machine"),
    refreshTokenHash: text("refresh_token_hash"),
    refreshGeneration: integer("refresh_generation").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    lastUsedAt: integer("last_used_at"),
    idleEndsAt: integer("idle_ends_at"),
    endsAt: integer("ends_at").notNull(),
    revokedAt: integer("revoked_at"),
    revokedReason: text("revoked_reason"),
  },
  t => [
    index("ncc_user_id_idx").on(t.userId),
    index("ncc_family_id_idx").on(t.familyId),
    index("ncc_ends_at_idx").on(t.endsAt),
  ]
);
