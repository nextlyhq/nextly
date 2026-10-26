/**
 * `email_queue` — MySQL definition. The columns are PostgreSQL's
 * (`./postgres.ts`).
 *
 * @module schemas/email-queue/mysql
 */
// fallow-ignore-file code-duplication

import {
  bigint,
  index,
  longtext,
  mysqlTable,
  text,
  varchar,
} from "drizzle-orm/mysql-core";

import { EMAIL_QUEUE_TABLE } from "./table-name";

export const emailQueueMysql = mysqlTable(
  EMAIL_QUEUE_TABLE,
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    scope: text("scope").notNull(),
    state: varchar("state", { length: 16 }).notNull(),
    jobId: varchar("job_id", { length: 36 }),
    // `longtext`: a message carries its whole body, and `text` stops at 64 KB.
    message: longtext("message"),
    principalKind: varchar("principal_kind", { length: 191 }),
    principalId: varchar("principal_id", { length: 191 }),
    failure: text("failure"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
    settledAt: bigint("settled_at", { mode: "number" }),
  },
  t => [
    index("email_queue_state_idx").on(t.state, t.settledAt),
    index("email_queue_principal_idx").on(t.principalKind, t.principalId),
  ]
);
