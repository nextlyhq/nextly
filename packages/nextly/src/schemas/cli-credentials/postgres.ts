/**
 * `nextly_cli_credentials` — the credentials the command line and agents
 * hold for a site, PostgreSQL.
 *
 * One row per CLI sign-in and per agent pass (and, later, per chat-app
 * pass). Kept apart from `refresh_tokens`, whose rows belong to the admin's
 * cookie session and follow its rules.
 *
 * - `purpose` is what the credential is: `cli-sign-in`, `agent-pass` or
 *   `chat-app-pass`. A token is accepted only for its row's purpose.
 * - `door` is where it may be used: `command` (the CLI's door) or
 *   `chat-app`. A credential is refused at any other door.
 * - `family_id` is the sign-in a credential descends from: a sign-in's own
 *   id, and for an agent pass the sign-in it was made from, which
 *   `parent_id` also names. Revoking a sign-in revokes its whole family.
 * - `refresh_token_hash` is the SHA-256 of the sign-in's current refresh
 *   token, never the token itself, and null on a pass, which has none.
 *   `refresh_generation` counts its replacements: every renewal moves it,
 *   so a renewal can be a compare-and-set on it and an earlier token is
 *   recognised as replaced.
 * - Times are milliseconds since the epoch, the same integer on every
 *   dialect. `idle_ends_at` is when an unused sign-in ends (null on a pass);
 *   `ends_at` is the end nothing extends. `revoked_at` and `revoked_reason`
 *   say when and why it was ended early.
 *
 * @module schemas/cli-credentials/postgres
 */
// The same table in each dialect's Drizzle builders: each dialect's column
// functions are distinct, so the declarations cannot be shared, and
// `sqlite-core-tables.test.ts` with the schema pipeline's own checks hold
// them in step.
// fallow-ignore-file code-duplication
import {
  bigint,
  index,
  integer,
  pgTable,
  text,
  varchar,
} from "drizzle-orm/pg-core";

import { users } from "../users/postgres";

import { CLI_CREDENTIALS_TABLE } from "./table-name";

export const nextlyCliCredentialsPg = pgTable(
  CLI_CREDENTIALS_TABLE,
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    purpose: varchar("purpose", { length: 32 }).notNull(),
    // Deleted with the account, so a credential never outlives its person.
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    familyId: varchar("family_id", { length: 64 }).notNull(),
    parentId: varchar("parent_id", { length: 64 }),
    agentName: text("agent_name"),
    door: varchar("door", { length: 32 }).notNull(),
    machine: text("machine"),
    refreshTokenHash: varchar("refresh_token_hash", { length: 64 }),
    refreshGeneration: integer("refresh_generation").notNull().default(0),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    lastUsedAt: bigint("last_used_at", { mode: "number" }),
    idleEndsAt: bigint("idle_ends_at", { mode: "number" }),
    endsAt: bigint("ends_at", { mode: "number" }).notNull(),
    revokedAt: bigint("revoked_at", { mode: "number" }),
    revokedReason: varchar("revoked_reason", { length: 32 }),
  },
  t => [
    // A person's credentials, for listing and revoking them.
    index("ncc_user_id_idx").on(t.userId),
    // A sign-in's family, revoked together.
    index("ncc_family_id_idx").on(t.familyId),
    // Ended rows, for clearing them out.
    index("ncc_ends_at_idx").on(t.endsAt),
  ]
);
