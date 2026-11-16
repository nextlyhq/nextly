/**
 * The refusal `nextly migrate` and the production boot step make before they
 * change anything: the configuration holds changes no migration records
 * (`unwritten-changes.ts`). It reads the database only to compare the
 * settings and permissions a snapshot written before they were recorded says
 * nothing about, once the database's first run on this release has recorded
 * them, and to tell a project whose database already holds its tables that
 * `migrate:baseline` comes first.
 *
 * Read-only, and called before the schema lock: taking the lock creates its
 * table, and a refused run changes nothing.
 *
 * **Runtime restriction (F11):** CLI and boot only; never import from runtime
 * code.
 *
 * @module domains/schema/migrate/refuse-unwritten-changes
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { isNull } from "drizzle-orm";

import { loadedDialect } from "../../../database/dialect-tables";
import { APP_OWNER } from "../../../plugins/permissions/collect-permissions";
import type { EntitySettingsChange } from "../migrate-create/entity-settings";
import type { Operation } from "../pipeline/diff/types";

import { configurationRegistryRows } from "./first-run";
import { readRegistryRecord } from "./registry-record";
import { rowsBehindSource } from "./registry-writer";
import {
  livePermissionsByOwner,
  unwrittenChangesError,
  unwrittenChangesOf,
  type LivePermissionRow,
  type RecordedInDatabase,
  type UnwrittenChangesArgs,
} from "./unwritten-changes";

/** What the refusal reads: the declared schema's inputs and the database. */
export type RefuseUnwrittenChangesArgs = Omit<
  UnwrittenChangesArgs,
  "recorded" | "logger"
> & {
  adapter: DrizzleAdapter;
  dialect: SupportedDialect;
  logger: { warn(message: string): void; error(message: string): void; debug?(message: string): void };
};

/**
 * Throws the refusal naming every change the configuration holds that no
 * migration records, before anything is changed; returns where there is none.
 */
export async function refuseUnwrittenChanges(
  args: RefuseUnwrittenChangesArgs
): Promise<void> {
  const changes = await unwrittenChangesOf({
    ...args,
    recorded: () => recordedInDatabase(args),
  });
  const error = unwrittenChangesError(changes, {
    baselineFirst:
      changes.noSnapshot &&
      (await holdsAnyAddedTable(args.adapter, changes.tables)),
  });
  if (error !== undefined) throw error;
}

/** `tableExists`, where the adapter has it. */
function tableExistsOf(
  adapter: DrizzleAdapter
): ((table: string) => Promise<boolean>) | undefined {
  const { tableExists } = adapter as unknown as {
    tableExists?: (table: string) => Promise<boolean>;
  };
  return typeof tableExists === "function"
    ? (table: string) => tableExists.call(adapter, table)
    : undefined;
}

/**
 * Whether the database already holds a table the comparison names as added:
 * a project made by `db:sync` or a development start, whose history has to
 * begin from those tables rather than create them.
 */
async function holdsAnyAddedTable(
  adapter: DrizzleAdapter,
  tables: readonly Operation[]
): Promise<boolean> {
  const exists = tableExistsOf(adapter);
  if (exists === undefined) return false;
  for (const op of tables) {
    if (op.type === "add_table" && (await exists(op.table.name))) return true;
  }
  return false;
}

/**
 * The settings and permissions the database records, once its first run on
 * this release has recorded them (the registry record exists); undefined
 * before that run, whose silence names nothing.
 *
 * - Settings: each code-first entity whose registry row the writer would
 *   rewrite from the configuration, as that first run wrote the rows from it.
 * - Permissions: the live ones not orphaned, the app's and each plugin's.
 */
async function recordedInDatabase(
  args: RefuseUnwrittenChangesArgs
): Promise<RecordedInDatabase | undefined> {
  const exists = tableExistsOf(args.adapter);
  if (exists === undefined || !(await exists("nextly_meta"))) return undefined;
  const db = args.adapter.getDrizzle();
  if ((await readRegistryRecord(db, args.dialect)) === undefined) {
    return undefined;
  }
  return {
    settingsDiffer: await settingsBehindConfiguration(args),
    permissions: livePermissionsByOwner(
      await livePermissionRows(db, args.dialect),
      APP_OWNER
    ),
  };
}

/** Each code-first entity whose registry row differs from what the configuration declares. */
async function settingsBehindConfiguration(
  args: RefuseUnwrittenChangesArgs
): Promise<EntitySettingsChange[]> {
  const { behind } = await rowsBehindSource(
    {
      kind: "snapshot",
      file: "the configuration",
      entities: configurationRegistryRows(args.config),
    },
    {
      adapter: args.adapter,
      logger: {
        debug: m => args.logger.debug?.(m),
        info: m => args.logger.debug?.(m),
        warn: m => args.logger.warn(m),
        error: m => args.logger.error(m),
      },
    }
  );
  return behind
    .filter(row => row.row === "differs")
    .map(row => ({
      kind: row.kind,
      slug: row.slug,
      changes: [
        "differs from the settings the database recorded",
        ...row.missingFields.map(name => `fields.${name} (added)`),
        ...row.extraFields.map(name => `fields.${name} (removed)`),
      ],
    }));
}

/** The live permissions not orphaned. */
async function livePermissionRows(
  db: unknown,
  dialect: SupportedDialect
): Promise<LivePermissionRow[]> {
  const { permissions } = loadedDialect(dialect).tables;
  const reader = db as {
    select(fields: Record<string, unknown>): {
      from(table: unknown): {
        where(condition: unknown): Promise<LivePermissionRow[]>;
      };
    };
  };
  return reader
    .select({
      slug: permissions.slug,
      action: permissions.action,
      resource: permissions.resource,
      name: permissions.name,
      description: permissions.description,
      permissionGroup: permissions.permissionGroup,
      owner: permissions.owner,
    })
    .from(permissions)
    .where(isNull(permissions.orphanedAt));
}
