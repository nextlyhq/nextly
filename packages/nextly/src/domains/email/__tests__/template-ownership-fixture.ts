/**
 * A real `email_templates` table on each dialect, for the ownership suites.
 *
 * Built from the production table definition through drizzle-kit, in a
 * database of the suite's own (Postgres and MySQL) or in memory (SQLite):
 * `email_templates` is a fixed-name system table every suite in a run shares,
 * so building it in place would leave this suite's shape for the others.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { createMySqlAdapter } from "@nextlyhq/adapter-mysql";
import { createPostgresAdapter } from "@nextlyhq/adapter-postgres";
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";

import {
  createScratchDatabase,
  type ScratchDatabase,
} from "../../../__tests__/helpers/fresh-database";
import { getDrizzleKitForDialect } from "../../../database/drizzle-kit-lazy";
import { emailTemplatesMysql } from "../../../schemas/email-templates/mysql";
import { emailTemplatesPg } from "../../../schemas/email-templates/postgres";
import { emailTemplatesSqlite } from "../../../schemas/email-templates/sqlite";
import { splitStatements } from "../../schema/pipeline/sql-statement-utils";
import { EmailTemplateService } from "../services/email-template-service";

export interface TemplateStoreDialect {
  dialect: SupportedDialect;
  url: string | null;
}

/** Every dialect, with SQLite always present and the others when their URL is set. */
export const TEMPLATE_STORE_DIALECTS: TemplateStoreDialect[] = [
  { dialect: "postgresql", url: process.env.TEST_POSTGRES_URL ?? null },
  { dialect: "mysql", url: process.env.TEST_MYSQL_URL ?? null },
  { dialect: "sqlite", url: "memory" },
];

export const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** The parameters the adapter accepts with a statement. */
type SqlParams = Parameters<DrizzleAdapter["executeQuery"]>[1];

export interface TemplateStore {
  adapter: DrizzleAdapter;
  /** A fresh service, as a new boot would construct it. */
  newService(): EmailTemplateService;
  /** Run one statement, with `?` placeholders on every dialect. */
  exec(sql: string, params?: SqlParams): Promise<void>;
  /** Read rows, with `?` placeholders on every dialect. */
  query<T>(sql: string, params?: SqlParams): Promise<T[]>;
  /** Quote an identifier for this dialect. */
  q(id: string): string;
  /** Remove every template. */
  clear(): Promise<void>;
  close(): Promise<void>;
}

export async function openTemplateStore(
  entry: TemplateStoreDialect
): Promise<TemplateStore> {
  let scratch: ScratchDatabase | undefined;
  if (entry.dialect !== "sqlite") {
    scratch = await createScratchDatabase(entry.dialect, "nextly_email_owners");
  }
  const url = scratch?.url ?? (entry.url as string);
  const adapter = (entry.dialect === "postgresql"
    ? createPostgresAdapter({ url })
    : entry.dialect === "mysql"
      ? createMySqlAdapter({ url })
      : createSqliteAdapter({ memory: true })) as unknown as DrizzleAdapter;
  await adapter.connect();

  const kit = await getDrizzleKitForDialect(entry.dialect);
  const table =
    entry.dialect === "postgresql"
      ? { emailTemplatesPg }
      : entry.dialect === "mysql"
        ? { emailTemplatesMysql }
        : { emailTemplatesSqlite };
  const statements = await kit.generateMigration(
    await kit.generateDrizzleJson({}),
    await kit.generateDrizzleJson(table)
  );
  for (const statement of splitStatements(statements)) {
    await adapter.executeQuery(statement);
  }

  const q = (id: string) =>
    entry.dialect === "mysql" ? `\`${id}\`` : `"${id}"`;
  // Postgres numbers its placeholders; the suites write `?` everywhere.
  const placeholders = (sql: string) => {
    if (entry.dialect !== "postgresql") return sql;
    let n = 0;
    return sql.replace(/\?/g, () => `$${++n}`);
  };

  return {
    adapter,
    newService: () => new EmailTemplateService(adapter, silentLogger),
    exec: async (sql, params) => {
      await adapter.executeQuery(placeholders(sql), params);
    },
    query: async <T>(sql: string, params?: SqlParams) =>
      (await adapter.executeQuery<T>(placeholders(sql), params)) as T[],
    q,
    clear: async () => {
      await adapter.executeQuery(`DELETE FROM ${q("email_templates")}`);
    },
    close: async () => {
      try {
        await adapter.disconnect();
      } finally {
        await scratch?.drop();
      }
    },
  };
}

/**
 * Make every stored row look as it did before ownership existed: the
 * columns an upgrade adds are empty until the reconciliation fills them.
 */
export async function forgetOwnership(store: TemplateStore): Promise<void> {
  const q = store.q;
  await store.exec(
    `UPDATE ${q("email_templates")} SET ${q("owner_kind")} = NULL, ${q("owner_name")} = NULL, ${q("overridden")} = NULL, ${q("base_digest")} = NULL, ${q("base_version")} = NULL`
  );
}
