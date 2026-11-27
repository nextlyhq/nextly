/**
 * `nextly_cli_credentials` on MySQL. See `postgres.ts` for what each column
 * is for. The user id is `varchar(191)`, as `users.id` is on MySQL.
 *
 * @module schemas/cli-credentials/mysql
 */
// The same table in each dialect's Drizzle builders: each dialect's column
// functions are distinct, so the declarations cannot be shared, and
// `sqlite-core-tables.test.ts` with the schema pipeline's own checks hold
// them in step.
// fallow-ignore-file code-duplication
import {
  bigint,
  index,
  int,
  mysqlTable,
  text,
  varchar,
} from "drizzle-orm/mysql-core";

import { users } from "../users/mysql";

import { CLI_CREDENTIALS_TABLE } from "./table-name";

export const nextlyCliCredentialsMysql = mysqlTable(
  CLI_CREDENTIALS_TABLE,
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    purpose: varchar("purpose", { length: 32 }).notNull(),
    userId: varchar("user_id", { length: 191 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    familyId: varchar("family_id", { length: 64 }).notNull(),
    parentId: varchar("parent_id", { length: 64 }),
    agentName: text("agent_name"),
    door: varchar("door", { length: 32 }).notNull(),
    machine: text("machine"),
    refreshTokenHash: varchar("refresh_token_hash", { length: 64 }),
    refreshGeneration: int("refresh_generation").notNull().default(0),
    sessionEpoch: int("session_epoch").notNull().default(0),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    lastUsedAt: bigint("last_used_at", { mode: "number" }),
    idleEndsAt: bigint("idle_ends_at", { mode: "number" }),
    endsAt: bigint("ends_at", { mode: "number" }).notNull(),
    revokedAt: bigint("revoked_at", { mode: "number" }),
    revokedReason: varchar("revoked_reason", { length: 32 }),
  },
  t => [
    index("ncc_user_id_idx").on(t.userId),
    index("ncc_family_id_idx").on(t.familyId),
    index("ncc_ends_at_idx").on(t.endsAt),
  ]
);
