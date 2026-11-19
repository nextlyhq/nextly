/**
 * What the declared schema holds that no migration records yet: the one
 * comparison `nextly migrate`, the production boot step and `migrate:check`
 * make before anything runs, so none of them reports a database as up to date
 * while the configuration is ahead of its migrations.
 *
 * It compares two end states, never a history: the declared schema, compiled
 * as `migrate:create` compiles it (`appMigrationInputs`: the configuration,
 * the plugins, the Schema Builder's entities and the app's extension tables),
 * with the newest snapshot in the build's migration folder. Everything a
 * snapshot records is compared, in both directions:
 *
 * - the tables: each table, column, index, check and key added, removed or
 *   changed (its type, size, whether it is required or unique, its default, a
 *   relation);
 * - the settings of each collection, Single and field group;
 * - the permissions the app and each plugin declare.
 *
 * A snapshot written before snapshots recorded settings or permissions says
 * nothing about them, so its silence is never a difference. There the
 * settings and permissions are compared with what the database's first run on
 * this release recorded of them, once and for good (the registry record's
 * rows and owned permissions), and nothing is named before that run.
 *
 * **Runtime restriction (F11):** CLI and boot only; never import from runtime
 * code.
 *
 * @module domains/schema/migrate/unwritten-changes
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { CliError } from "../../../cli/errors";
import {
  appMigrationInputs,
  type AppMigrationInputsArgs,
} from "../migrate-create/app-migration-inputs";
import {
  appStreamSnapshots,
  type AppStreamTables,
} from "../migrate-create/app-stream";
import {
  declaredPermissionsOf,
  describePermissionChange,
  permissionChanges,
  type OwnerPermissions,
  type PermissionChange,
  type PermissionRecord,
} from "../migrate-create/declared-permissions";
import {
  describeSettingsChange,
  settingsChangesFor,
  type EntitySettingsChange,
} from "../migrate-create/entity-settings";
import {
  buildDesiredSnapshotFromConfig,
  type MinimalConfigEntity,
} from "../migrate-create/generate";
import {
  EMPTY_SNAPSHOT,
  type SnapshotFile,
} from "../migrate-create/snapshot-io";
import { describeOp } from "../pipeline/diff/describe-operation";
import { diffSnapshots } from "../pipeline/diff/diff";
import type { Operation } from "../pipeline/diff/types";

/** The declared entities, as `migrate:create` generates from them. */
export interface DeclaredEntities {
  collections: readonly MinimalConfigEntity[];
  singles: readonly MinimalConfigEntity[];
  components: readonly MinimalConfigEntity[];
}

/**
 * What the database records of the settings and permissions, for a newest
 * snapshot that predates recording them. Absent before the database's first
 * run on this release has recorded them, which names nothing.
 */
export interface RecordedInDatabase {
  /**
   * The entities whose registry row the writer would rewrite from the
   * declared settings: each one's settings differ from what is recorded.
   */
  settingsDiffer?: readonly EntitySettingsChange[];
  /**
   * The app's and each plugin's permissions, by owner: as the registry record
   * kept them, or, where the database has no such record of them, the live
   * ones not orphaned.
   */
  permissions?: Pick<PermissionRecord, "app" | "plugins">;
  /**
   * Every permission slug a registry record kept, where it was written before
   * owners were kept. A declared permission not among them was added since;
   * one removed cannot be named, since a slug alone does not say whose it was.
   */
  permissionSlugs?: readonly string[];
}

/** Everything the declared schema holds that the newest snapshot does not. */
export interface UnwrittenChanges {
  /** Each table change, in the diff's order. */
  tables: readonly Operation[];
  settings: readonly EntitySettingsChange[];
  /** Only an app's or a plugin's permissions added or removed. */
  permissions: readonly Extract<PermissionChange, { kind: "owner" }>[];
  /** Whether the folder holds no snapshot at all. */
  noSnapshot: boolean;
}

/** Whether `changes` names nothing. */
export function nothingUnwritten(changes: UnwrittenChanges): boolean {
  return (
    changes.tables.length === 0 &&
    changes.settings.length === 0 &&
    changes.permissions.length === 0
  );
}

/**
 * The declared schema compared with the newest snapshot (`latest`, null where
 * the folder has none). Pure: every input is read by the caller.
 */
export function compareWithNewestSnapshot(args: {
  entities: DeclaredEntities;
  appStream: AppStreamTables;
  permissions: PermissionRecord;
  latest: { data: SnapshotFile } | null;
  dialect: SupportedDialect;
  /** What the database records, read only where the newest snapshot predates a record. */
  recorded?: RecordedInDatabase;
}): UnwrittenChanges {
  const { entities, latest } = args;
  const existing = latest?.data.snapshot ?? EMPTY_SNAPSHOT;
  const stream = appStreamSnapshots({
    previous: existing,
    previousContributions: latest?.data.contributions ?? {},
    desired: buildDesiredSnapshotFromConfig(
      [...entities.collections],
      [...entities.singles],
      [...entities.components],
      args.dialect,
      existing
    ),
    tables: args.appStream,
  });
  return {
    tables: diffSnapshots(stream.previous, stream.desired),
    settings: settingsDifferences(entities, latest, args.recorded),
    permissions: permissionDifferences(args.permissions, latest, args.recorded),
    noSnapshot: latest === null,
  };
}

/**
 * The settings changes: against the newest snapshot's record, or, where it
 * predates the record, the registry's. With no snapshot at all every entity is
 * new, which its tables already name.
 */
function settingsDifferences(
  entities: DeclaredEntities,
  latest: { data: SnapshotFile } | null,
  recorded: RecordedInDatabase | undefined
): readonly EntitySettingsChange[] {
  if (latest === null) return [];
  if (latest.data.entities === undefined) return recorded?.settingsDiffer ?? [];
  return settingsChangesFor(entities, latest.data.entities);
}

/**
 * The app's and the plugins' permissions added or removed: against the newest
 * snapshot's record, or, where there is no snapshot or it predates the
 * record, the live permissions. No snapshot says nothing about permissions
 * either: a site's first run records the ones it finds, as it does over an
 * earlier version's snapshot, and the tables a real site declares are named
 * as added in any case.
 */
export function permissionDifferences(
  declared: PermissionRecord,
  latest: { data: SnapshotFile } | null,
  recorded: RecordedInDatabase | undefined
): Extract<PermissionChange, { kind: "owner" }>[] {
  const previous =
    latest?.data.permissions ?? recordedPermissions(declared, recorded);
  // Over a snapshot that predates the record and a database that records none
  // yet, there is nothing to compare: `permissionChanges` names that "recorded".
  if (previous === undefined) return [];
  return permissionChanges(previous, declared).filter(
    (change): change is Extract<PermissionChange, { kind: "owner" }> =>
      change.kind === "owner"
  );
}

/**
 * The owners' permissions the database records, as a permission record:
 * undefined where it records none. Over slugs alone (`permissionSlugs`), each
 * declared permission whose slug was kept, so only an added one differs.
 */
function recordedPermissions(
  declared: PermissionRecord,
  recorded: RecordedInDatabase | undefined
): PermissionRecord | undefined {
  if (recorded?.permissions !== undefined) {
    return { ...recorded.permissions, collections: {}, singles: {} };
  }
  if (recorded?.permissionSlugs === undefined) return undefined;
  const keptSlugs = new Set(recorded.permissionSlugs);
  const keptOf = (owned: OwnerPermissions): OwnerPermissions =>
    Object.fromEntries(
      Object.entries(owned).filter(([slug]) => keptSlugs.has(slug))
    );
  return {
    app: keptOf(declared.app),
    plugins: Object.fromEntries(
      Object.entries(declared.plugins).map(([name, owned]) => [
        name,
        keptOf(owned),
      ])
    ),
    collections: {},
    singles: {},
  };
}

/** One permission row as the database stores it, for {@link livePermissionsByOwner}. */
export interface LivePermissionRow {
  slug: string;
  action: string;
  resource: string;
  name: string;
  description: string | null;
  permissionGroup: string | null;
  owner: string | null;
}

/**
 * The live permissions not orphaned as a record of the app's and each
 * plugin's: a row with no owner is Nextly's own or an entity's built-in one,
 * which no plugin release changes.
 */
export function livePermissionsByOwner(
  rows: readonly LivePermissionRow[],
  appOwner: string
): Pick<PermissionRecord, "app" | "plugins"> {
  const app: OwnerPermissions = {};
  const plugins: Record<string, OwnerPermissions> = {};
  for (const row of rows) {
    if (row.owner === null) continue;
    const owned = row.owner === appOwner ? app : (plugins[row.owner] ??= {});
    owned[row.slug] = {
      action: row.action,
      resource: row.resource,
      name: row.name,
      description: row.description,
      group: row.permissionGroup,
      danger: false,
    };
  }
  return { app, plugins };
}

/** A table change as a line: `+` added, `-` removed, `~` changed. */
function tableLine(op: Operation): string {
  const sign = op.type.startsWith("add_")
    ? "+"
    : op.type.startsWith("drop_")
      ? "-"
      : "~";
  return `${sign} ${describeOp(op)}`;
}

/** Every difference as a line, tables first, then settings, then permissions. */
export function unwrittenChangeLines(changes: UnwrittenChanges): string[] {
  return [
    ...changes.tables.map(tableLine),
    ...changes.settings.map(
      change => `~ settings ${describeSettingsChange(change)}`
    ),
    ...changes.permissions.map(
      change => `~ permissions ${describePermissionChange(change)}`
    ),
  ];
}

const CREATE_MIGRATION =
  'Run `nextly migrate:create --name="<migration-name>"`, commit the result, then run `nextly migrate` again.';

const BASELINE_FIRST =
  "If this database already holds these tables (made by `nextly db:sync` or a development start), " +
  "run `nextly migrate:baseline` first, so the history starts from them.";

/**
 * The refusal for `changes`, or undefined where there are none. Every
 * difference is listed. A schema or permission change is `SCHEMA_DRIFT`; a
 * change to settings alone is `SETTINGS_CHANGE_WITHOUT_MIGRATION`, as
 * `migrate:check` has always reported it.
 */
export function unwrittenChangesError(
  changes: UnwrittenChanges,
  options: { baselineFirst?: boolean } = {}
): CliError | undefined {
  if (nothingUnwritten(changes)) return undefined;
  const lines = unwrittenChangeLines(changes);
  const count = lines.length;
  const next =
    options.baselineFirst === true
      ? `${CREATE_MIGRATION}\n${BASELINE_FIRST}`
      : CREATE_MIGRATION;
  const why = [
    "The database is not reported as up to date while the configuration holds changes no migration records. Nothing was changed.",
    ...lines,
  ].join("\n");
  const settingsOnly =
    changes.tables.length === 0 && changes.permissions.length === 0;
  return settingsOnly
    ? new CliError("SETTINGS_CHANGE_WITHOUT_MIGRATION", {
        what: `${count} entit${count === 1 ? "y's" : "ies'"} settings changed with no migration.`,
        why,
        next,
        context: { lines },
      })
    : new CliError("SCHEMA_DRIFT", {
        what: `${count} change${count === 1 ? "" : "s"} in the configuration with no migration.`,
        why,
        next,
        context: { lines },
      });
}

/** What {@link unwrittenChangesOf} reads the declared schema from. */
export type UnwrittenChangesArgs = Pick<
  AppMigrationInputsArgs,
  | "config"
  | "deferredExtends"
  | "projectRoot"
  | "migrationsDir"
  | "dialect"
  | "logger"
> & {
  /**
   * What the database records, asked only where the newest snapshot predates
   * recording settings or permissions. Absent (`migrate:check`, which reads no
   * database), such a snapshot's silence names nothing.
   */
  recorded?: (
    entities: DeclaredEntities,
    /** The newest snapshot's migration, by base name; null where there is none. */
    newest: string | null
  ) => Promise<RecordedInDatabase | undefined>;
  /**
   * Whether `config` carries everything a permission is declared from (the
   * app's own permissions and its workflows, besides the plugins). A caller
   * handed only the schema's part of the configuration passes false, and no
   * permission is compared: compared, the app's would all read as removed.
   */
  comparePermissions?: boolean;
};

/**
 * The declared schema, compiled as `migrate:create` compiles it, compared with
 * the newest snapshot in the folder. A declaration `migrate:create` would
 * refuse is thrown, as it throws it.
 */
export async function unwrittenChangesOf(
  args: UnwrittenChangesArgs
): Promise<UnwrittenChanges> {
  const inputs = await appMigrationInputs({
    config: args.config,
    ...(args.deferredExtends === undefined
      ? {}
      : { deferredExtends: args.deferredExtends }),
    projectRoot: args.projectRoot,
    migrationsDir: args.migrationsDir,
    dialect: args.dialect,
    logger: args.logger,
  });
  const entities: DeclaredEntities = {
    collections: inputs.collections,
    singles: inputs.singles,
    components: inputs.components,
  };
  const latest = inputs.latest;
  // A template's older-format snapshot is read as the tables its listed
  // entities were made with (`template-start.ts`), so a collection, a Single
  // or a top-level field added or removed since is a table difference like
  // any other. It records no settings and no permissions, and what the
  // database holds of them was never written from it, so neither is compared.
  const predatesRecord =
    latest === null ||
    (latest.template !== true &&
      (latest.data.entities === undefined ||
        latest.data.permissions === undefined));
  const changes = compareWithNewestSnapshot({
    entities,
    appStream: inputs.appStream,
    permissions: declaredPermissionsOf(args.config, {
      collections: inputs.collections,
      singles: inputs.singles,
    }),
    latest,
    dialect: args.dialect,
    ...(predatesRecord && args.recorded !== undefined
      ? {
          recorded: await args.recorded(
            entities,
            latest === null
              ? null
              : latest.filename.replace(/\.snapshot\.json$/, "")
          ),
        }
      : {}),
  });
  return args.comparePermissions === false
    ? { ...changes, permissions: [] }
    : changes;
}
