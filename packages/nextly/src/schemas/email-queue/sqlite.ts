/**
 * `email_queue` — SQLite definition. The columns are PostgreSQL's
 * (`./postgres.ts`).
 *
 * @module schemas/email-queue/sqlite
 */
// fallow-ignore-file code-duplication

import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { EMAIL_QUEUE_TABLE } from "./table-name";

export const emailQueueSqlite = sqliteTable(
  EMAIL_QUEUE_TABLE,
  {
    id: text("id").primaryKey(),
    scope: text("scope").notNull(),
    state: text("state").notNull(),
    jobId: text("job_id"),
    message: text("message"),
    principalKind: text("principal_kind"),
    principalId: text("principal_id"),
    failure: text("failure"),
    templateSlug: text("template_slug"),
    messageKind: text("message_kind"),
    recipientKinds: text("recipient_kinds"),
    providerType: text("provider_type"),
    providerId: text("provider_id"),
    providerOrigin: text("provider_origin"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    settledAt: integer("settled_at"),
  },
  t => [
    index("email_queue_state_idx").on(t.state, t.settledAt),
    index("email_queue_principal_idx").on(t.principalKind, t.principalId),
    index("email_queue_created_idx").on(t.createdAt, t.id),
    index("email_queue_template_idx").on(t.templateSlug, t.createdAt),
    index("email_queue_provider_type_idx").on(t.providerType, t.createdAt),
    index("email_queue_provider_origin_idx").on(t.providerOrigin, t.createdAt),
  ]
);
