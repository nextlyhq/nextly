/**
 * What `nextly migrate:down` does with the registry record (`registry-record.ts`).
 *
 * Once the record exists, every point a rollback can leave the database at
 * has a registry source or the rollback is refused: the point's own snapshot,
 * where it carries the registry metadata, or the registry baseline, where the
 * point is the record's and has none. Any other point (a snapshot without the
 * metadata that is not the record's point, or the point before any app
 * migration where that is not the record's) has nothing recording the
 * registry, so the rollback is refused before anything changes, and a new
 * migration undoes the change instead.
 *
 * A rollback that reaches the record's point, where the record keeps a
 * baseline, undoes the rolled-back migrations' own changes to the
 * bookkeeping, and nothing else, in the transaction of the last migration it
 * rolls back:
 *
 * - every registry row the baseline holds goes back to it, as it stood when
 *   the record was written; the row of an entity a rolled-back migration
 *   added, which the baseline does not hold, is removed;
 * - a permission a rolled-back migration made live, because its snapshot
 *   declared it, is orphaned with its grants kept, unless the baseline holds
 *   it or the install of a plugin still recorded installed declares it; an
 *   entity's permissions go with its row this way;
 * - a mark is cleared only where the point it returns to declares the
 *   permission: the app's own, an entity's or core's where the baseline holds
 *   it, and a plugin's where the plugin is recorded installed and its current
 *   release declares it. A plugin's lifecycle otherwise keeps the mark.
 *
 * Every other permission keeps its state: core's own (no snapshot declares
 * one), one a plugin's install added or its uninstall orphaned, and one live
 * before the rolled-back migrations applied that none of them orphaned.
 *
 * @module domains/schema/migrate/rollback-to-record
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { compareMigrationBaseNames } from "../../../cli/utils/migration-discovery";
import { NextlyError } from "../../../errors/nextly-error";
import {
  APP_OWNER,
  collectCustomPermissions,
  type PermissionConfigSource,
} from "../../../plugins/permissions/collect-permissions";
import type { PluginDefinition } from "../../../plugins/plugin-context";
import { canonicalJson } from "../../../shared/lib/canonical-json";
import { adapterForReads } from "../../../shared/lib/read-transaction-scope";
import type { OrphanPassRow } from "../../auth/services/permission-seed-service";
import { dashboardPinsPresent } from "../../dashboard/dashboard-pins";
import { resolveRegistryTableName } from "../../field-groups/storage/resolve-storage-names";
import {
  mediaUsageTablePresent,
  type DashboardTables,
} from "../../versions/entity-teardown";
import { newestMigrationName } from "../build-schema-version";
import { isPluginLedgerRow } from "../events/ledger-scope";
import { standingsByFilename } from "../events/migration-state";
import type { SchemaEventRow } from "../events/schema-events-repository";
import type { EntitySettingsRecord } from "../migrate-create/entity-settings";
import {
  carriesRegistryMetadata,
  parseSnapshotFile,
  type SnapshotFile,
} from "../migrate-create/snapshot-io";
import { writeRegistryRows } from "../schema-version";

import {
  pluginsRecordedNotInstalled,
  pluginsStillDeclaring,
  rewriteOrphanMarksOnCommandConnection,
  type ServiceLogger,
} from "./command-access";
import {
  pointCarriesMetadata,
  snapshotMetadataOf,
  type AppMigrationStanding,
} from "./first-run";
import { permissionsDeclaredBy } from "./permission-orphans";
import { pluginCollectionSources } from "./plugin/plugin-collection-sources";
import {
  addedEntities,
  clearedSettings,
  touchedEntities,
} from "./registry-history";
import {
  readRegistryRecord,
  takeRegistryBaseline,
  type BaselineRow,
  type RegistryBaseline,
  type RegistryRecord,
} from "./registry-record";
import { removeRegistryRow, type RemovalScope } from "./registry-row-removal";
import {
  typeChangedRowsWriter,
  writeRegistryFromSource,
  type RegistryWriteDeps,
} from "./registry-writer";

/** A snapshot, as much of it as a rollback reads. */
type SnapshotPart = Pick<SnapshotFile, "entities" | "permissions">;

/** One migration a rollback undoes. */
export interface RolledBackMigration {
  /** Its snapshot, or null where it has none. */
  snapshot: SnapshotPart | null;
}

/** What the record makes of the point a rollback leaves the database at. */
export type RollbackPoint =
  /** No record, or a point whose own snapshot is its registry source: nothing of the record's to do. */
  | { kind: "own-source" }
  /** The record's point, where the record keeps the registry baseline. */
  | { kind: "baseline"; baseline: RegistryBaseline }
  /** A point nothing records the registry at: the rollback is refused. */
  | { kind: "refused"; refusal: NextlyError };

/** A point as the operator reads it named. */
function pointNamed(point: string | null): string {
  return point === null
    ? "the point before any app migration"
    : `\`${point}.sql\``;
}

/**
 * What the record makes of `point`, the point a rollback would leave the
 * database at. `remaining` is every app migration still applied there, in
 * run order, with what its snapshot says of the registry.
 */
export function judgeRollbackPoint(args: {
  record: RegistryRecord | undefined;
  remaining: readonly AppMigrationStanding[];
  point: string | null;
}): RollbackPoint {
  const { record, point } = args;
  // Before the record, no point has a source but its own snapshot, and the
  // rows and marks stay as they are where it has none.
  if (record === undefined) return { kind: "own-source" };
  if (pointCarriesMetadata(args.remaining, point))
    return { kind: "own-source" };
  if (point === record.point && record.baseline !== undefined) {
    return { kind: "baseline", baseline: record.baseline };
  }
  const why =
    point === null
      ? "no app migration is applied there"
      : "its snapshot carries no registry metadata";
  return {
    kind: "refused",
    refusal: NextlyError.invalidInput({
      message:
        `This rollback would leave the database at ${pointNamed(point)}, and nothing records the registry there: ` +
        `${why}, and the database's registry record was taken at ${pointNamed(record.point)}. ` +
        "Nothing was rolled back. To undo the change, write a new migration with " +
        "`nextly migrate:create` and apply it with `nextly migrate`.",
      logContext: {
        reason: "rollback-past-registry-record",
        point,
        recordPoint: record.point,
      },
    }),
  };
}

/** A permission's identity as marks are compared: action and resource, in any case. */
function keyOf(p: { action: string; resource: string }): string {
  return `${String(p.action).toLowerCase()}|${String(p.resource).toLowerCase()}`;
}

/**
 * The orphan marks a rollback to the record's point sets (true) and clears
 * (false), by permission id, judged by declaration alone: what the point it
 * returns to declares, and what each writer that is not a migration declares
 * now. No time a mark was set is read.
 *
 * - Made live by a rolled-back migration: a permission its snapshot declares
 *   that the baseline does not hold and no plugin still recorded installed
 *   declares (`installed`). Orphaned, or left orphaned, whatever else marked
 *   it since. An entity's built-in permissions are declared with it, so they
 *   leave with the row of an entity the baseline does not hold.
 * - Marked, and declared at the point it returns to: cleared. A plugin's
 *   permission is told apart by what each configured plugin declares
 *   (`pluginDeclared`), never by the owner key the app's own share with a
 *   plugin named `app`; a row owned by any other key is a plugin's too, one
 *   no longer configured. A plugin's is declared there only where the plugin
 *   is recorded installed and its current release declares it (`installed`),
 *   so a mark its uninstall set, or one its reinstalled release no longer
 *   lifts, stays. Any other permission (the app's own, an entity's, core's)
 *   is declared there where the baseline holds it.
 */
export function orphanMarksUndone(args: {
  rows: readonly OrphanPassRow[];
  baseline: readonly string[];
  rolledBack: readonly RolledBackMigration[];
  installed: readonly { action: string; resource: string }[];
  pluginDeclared: readonly {
    action: string;
    resource: string;
    owner: string;
  }[];
}): Map<string, boolean> {
  const held = new Set(args.baseline);
  const installed = new Set(args.installed.map(keyOf));
  const pluginOf = new Map(args.pluginDeclared.map(p => [keyOf(p), p.owner]));
  const declared = new Set(
    args.rolledBack.flatMap(m =>
      (permissionsDeclaredBy(m.snapshot) ?? []).map(keyOf)
    )
  );
  /** Whether the point the rollback returns to declares `row`. */
  const declaredAtPoint = (row: OrphanPassRow, key: string): boolean => {
    const plugin =
      pluginOf.get(key) ??
      (row.owner !== null && row.owner !== APP_OWNER ? row.owner : undefined);
    return plugin === undefined ? held.has(row.slug) : installed.has(key);
  };
  const marks = new Map<string, boolean>();
  for (const row of args.rows) {
    const key = keyOf(row);
    if (declared.has(key) && !held.has(row.slug) && !installed.has(key)) {
      marks.set(String(row.id), true);
    } else if (row.orphanedAt !== null && declaredAtPoint(row, key)) {
      marks.set(String(row.id), false);
    }
  }
  return marks;
}

/** The three registries, as the baseline keeps them, and the kind each deletes its rows as. */
const REGISTRIES = [
  { kind: "collection", rows: "collections" },
  { kind: "single", rows: "singles" },
  { kind: "fieldGroup", rows: "fieldGroups" },
] as const;

type RegistryKey = (typeof REGISTRIES)[number]["rows"];

/** The registry table each kind's rows are stored in, read on `adapter`. */
async function registryTableOf(
  key: RegistryKey,
  adapter: DrizzleAdapter
): Promise<string> {
  if (key === "collections") return "dynamic_collections";
  if (key === "singles") return "dynamic_singles";
  return resolveRegistryTableName(adapter);
}

/** Whether two registry rows, as the baseline keeps them, hold the same, whatever their key order. */
function sameRow(a: BaselineRow, b: BaselineRow): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/**
 * The columns that store `row`, a registry row as the baseline keeps it (its
 * service's reading, through JSON), as the registry services write them: each
 * key in snake case, a date back from its text, and the rest as it is (the
 * adapter encodes an object for a JSON column). A key `current` has and
 * `row` lacks was empty when the baseline was taken, so it is cleared. The
 * slug, and on an update the id, are not rewritten.
 */
function storedColumns(
  row: BaselineRow,
  current: BaselineRow | undefined
): Record<string, unknown> {
  const keys = new Set([...Object.keys(row), ...Object.keys(current ?? {})]);
  keys.delete("slug");
  if (current !== undefined) keys.delete("id");
  const stored: Record<string, unknown> = {};
  for (const key of keys) {
    const value = row[key] ?? null;
    const column = key.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
    stored[column] =
      key.endsWith("At") && typeof value === "string" ? new Date(value) : value;
  }
  return stored;
}

/** A `where` naming one registry row by slug. */
function bySlug(slug: string): {
  and: { column: string; op: "="; value: string }[];
} {
  return { and: [{ column: "slug", op: "=", value: slug }] };
}

/** One registry's rows, as the baseline keeps them and as they stand now, and its table. */
interface RegistryRows {
  kind: (typeof REGISTRIES)[number]["kind"];
  table: string;
  baseline: Record<string, BaselineRow>;
  current: Record<string, BaselineRow>;
}

/**
 * Write each row of `rows.baseline` back where it differs from the stored
 * one, or is missing, through `view`. Returns each row written, as
 * `<kind> <slug>`.
 */
async function writeBaselineRows(
  view: DrizzleAdapter,
  rows: RegistryRows
): Promise<string[]> {
  const written: string[] = [];
  for (const [slug, row] of Object.entries(rows.baseline)) {
    const now = rows.current[slug];
    if (now !== undefined && sameRow(now, row)) continue;
    if (now === undefined) {
      await view.insert(rows.table, { slug, ...storedColumns(row, undefined) });
    } else {
      await view.update(rows.table, storedColumns(row, now), bySlug(slug));
    }
    written.push(`${rows.kind} ${slug}`);
  }
  return written;
}

/**
 * Remove the stored row of each entity in `added`, with what goes with a
 * deleted collection or Single (`deleteEntityRegistryRow`). Returns each row
 * removed, as `<kind> <slug>`.
 */
async function removeAddedRows(
  view: DrizzleAdapter,
  rows: RegistryRows,
  added: ReadonlySet<string>,
  teardown: Omit<RemovalScope, "view">
): Promise<string[]> {
  const removed: string[] = [];
  for (const slug of Object.keys(rows.current).filter(s => added.has(s))) {
    await removeRegistryRow({ ...teardown, view }, rows.kind, slug);
    removed.push(`${rows.kind} ${slug}`);
  }
  return removed;
}

/**
 * Bring the registry rows back to `baseline`, on the registry write the
 * caller holds: each row it holds written back where it differs (or is
 * missing), and the row of each entity in `added` removed. Returns each row
 * written and removed, as `<kind> <slug>`.
 */
async function restoreRows(args: {
  adapter: DrizzleAdapter;
  db: unknown;
  tx: RemovalScope["tx"];
  dialect: SupportedDialect;
  baseline: RegistryBaseline;
  added: Record<RegistryKey, ReadonlySet<string>>;
  tables: DashboardTables;
  logger: ServiceLogger;
}): Promise<{ restored: string[]; removed: string[] }> {
  const view = adapterForReads(args.adapter);
  // The rows as they stand, read as the baseline was taken, so the two compare.
  const current = await takeRegistryBaseline({
    adapter: args.adapter,
    db: args.db,
    dialect: args.dialect,
    logger: args.logger,
  });
  const restored: string[] = [];
  const removed: string[] = [];
  for (const { kind, rows: key } of REGISTRIES) {
    const rows: RegistryRows = {
      kind,
      table: await registryTableOf(key, view),
      baseline: args.baseline[key],
      current: current[key],
    };
    restored.push(...(await writeBaselineRows(view, rows)));
    removed.push(
      ...(await removeAddedRows(view, rows, args.added[key], {
        tx: args.tx,
        tables: args.tables,
      }))
    );
  }
  return { restored, removed };
}

/** `content` parsed as JSON, or undefined where it is not JSON. */
function jsonOf(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return undefined;
  }
}

/** A migration's snapshot, or null where it has none or it is not a migration snapshot. */
async function readMigrationSnapshot(
  metaDir: string,
  name: string
): Promise<SnapshotFile | null> {
  const file = `${name}.snapshot.json`;
  let content: string;
  try {
    content = await readFile(resolve(metaDir, file), "utf-8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return null;
    throw NextlyError.internal({ cause: error as Error });
  }
  // A template's own metadata file (collections and Singles, no migration
  // hash) is no migration snapshot, as `nextly migrate` reads it.
  const parsed = jsonOf(content);
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    !("migrationHash" in parsed) &&
    ("collections" in parsed || "singles" in parsed)
  ) {
    return null;
  }
  return parseSnapshotFile(content, file);
}

/** What a rollback does with the registry record, decided before it rolls anything back. */
export interface RollbackBookkeeping {
  /** Where the point it leaves has no registry source: thrown before anything changes. */
  refusal?: NextlyError;
  /**
   * The rolled-back migrations' own registry changes undone, run in the
   * transaction of the last migration rolled back, after its statements and
   * before its rollback is recorded, so the two commit together or neither
   * does. Where the point is the record's and the record keeps a baseline,
   * the bookkeeping that baseline keeps; where the point has a snapshot of
   * its own recording the registry, each row a rolled-back migration
   * changed goes back to it, and the row of an entity one of them added,
   * which it does not record, is removed (`undoToOwnSource`).
   */
  restore?: () => Promise<void>;
  /**
   * By rolled-back filename: the registry rows written with that DOWN, those
   * of the entities whose field types it changes back, in its transaction
   * where it runs in one (`typeChangedRowsWriter`).
   */
  perFile?: ReadonlyMap<string, () => Promise<void>>;
  /** What a dry run says of it. */
  summary?: string;
}

/** Each app migration the ledger records applied, by base name. */
function appliedAppMigrations(rows: readonly SchemaEventRow[]): Set<string> {
  const applied = new Set<string>();
  for (const [filename, standing] of standingsByFilename(rows)) {
    if (isPluginLedgerRow(filename) || standing.state !== "applied") continue;
    applied.add(baseNameOf(filename));
  }
  return applied;
}

/** A ledger filename's base name, as the record names a point. */
function baseNameOf(filename: string): string {
  return filename.replace(/\.sql$/i, "");
}

/**
 * The app migrations still applied once `targets` are rolled back, in run
 * order, each with what its snapshot says of the registry.
 */
async function remainingStandings(
  metaDir: string,
  applied: ReadonlySet<string>,
  targets: ReadonlySet<string>
): Promise<AppMigrationStanding[]> {
  const remaining: AppMigrationStanding[] = [];
  const names = [...applied]
    .filter(name => !targets.has(name))
    .sort(compareMigrationBaseNames);
  for (const name of names) {
    const snapshot = await readMigrationSnapshot(metaDir, name);
    remaining.push({
      name,
      applied: true,
      metadata: snapshotMetadataOf(snapshot),
    });
  }
  return remaining;
}

/**
 * Each rolled-back migration with its snapshot, and the entities they record
 * that `baseline` does not hold: the ones they added.
 */
async function rolledBackMigrations(
  metaDir: string,
  targets: ReadonlySet<string>,
  baseline: RegistryBaseline
): Promise<{
  rolledBack: RolledBackMigration[];
  added: Record<RegistryKey, Set<string>>;
}> {
  const rolledBack: RolledBackMigration[] = [];
  const added: Record<RegistryKey, Set<string>> = {
    collections: new Set(),
    singles: new Set(),
    fieldGroups: new Set(),
  };
  for (const name of targets) {
    const snapshot = await readMigrationSnapshot(metaDir, name);
    rolledBack.push({ snapshot });
    if (snapshot === null || !carriesRegistryMetadata(snapshot)) continue;
    for (const { rows } of REGISTRIES) {
      Object.keys(snapshot.entities[rows])
        .filter(slug => !(slug in baseline[rows]))
        .forEach(slug => added[rows].add(slug));
    }
  }
  return { rolledBack, added };
}

/**
 * Decide, reading only, what a rollback of `rolledBack` (ledger filenames)
 * does with the registry record: nothing, a refusal, or the bookkeeping to
 * undo once it reaches the record's point. `rows` are the app's ledger rows
 * the rollback chose its targets from.
 */
export async function planRollbackBookkeeping(args: {
  adapter: DrizzleAdapter;
  dialect: SupportedDialect;
  migrationsDir: string;
  config: PermissionConfigSource & { plugins?: PluginDefinition[] };
  rows: readonly SchemaEventRow[];
  rolledBack: readonly string[];
  logger: ServiceLogger;
}): Promise<RollbackBookkeeping> {
  const { adapter, dialect } = args;
  if (args.rolledBack.length === 0) return {};
  // A database `nextly migrate` has not prepared keeps no registry
  // bookkeeping, and has no table to store a write's schema version in.
  if (!(await adapter.tableExists("nextly_meta"))) return {};
  const record = await readRegistryRecord(adapter.getDrizzle(), dialect);

  const targets = new Set(args.rolledBack.map(baseNameOf));
  const applied = appliedAppMigrations(args.rows);
  const metaDir = resolve(args.migrationsDir, "meta");
  const remaining = await remainingStandings(metaDir, applied, targets);
  const point = newestMigrationName(remaining.map(m => m.name)) ?? null;
  const judged = judgeRollbackPoint({ record, remaining, point });
  if (judged.kind === "refused") return { refusal: judged.refusal };
  const writeDeps: RegistryWriteDeps = {
    adapter,
    logger: args.logger,
    collectionSources: pluginCollectionSources(args.config.plugins ?? []),
  };
  const perFile = await typeChangedRowsPerDown({
    metaDir,
    applied,
    rolledBack: args.rolledBack,
    deps: writeDeps,
  });
  if (judged.kind === "own-source") {
    return {
      perFile,
      ...(await undoToOwnSource({
        metaDir,
        point,
        remaining: remaining.map(m => m.name),
        targets,
        deps: writeDeps,
      })),
    };
  }
  return {
    perFile,
    summary: `The registry would go back to the baseline the database's registry record keeps at ${pointNamed(point)}.`,
    restore: await baselineRestore({
      ...args,
      point,
      baseline: judged.baseline,
      ...(await rolledBackMigrations(metaDir, targets, judged.baseline)),
    }),
  };
}

/**
 * For each rolled-back migration whose DOWN changes a field's type back, the
 * registry rows written with that DOWN: brought from its snapshot to the one
 * the database stands at once it has run (the newest applied migration
 * before it that has a snapshot). Keyed by the filename as rolled back.
 */
async function typeChangedRowsPerDown(args: {
  metaDir: string;
  applied: ReadonlySet<string>;
  rolledBack: readonly string[];
  deps: RegistryWriteDeps;
}): Promise<Map<string, () => Promise<void>>> {
  const perFile = new Map<string, () => Promise<void>>();
  const inOrder = [...args.applied].sort(compareMigrationBaseNames);
  for (const filename of args.rolledBack) {
    const name = baseNameOf(filename);
    const at = inOrder.indexOf(name);
    if (at < 0) continue;
    const from = await readMigrationSnapshot(args.metaDir, name);
    let to: SnapshotFile | null = null;
    for (const earlier of inOrder.slice(0, at).reverse()) {
      to = await readMigrationSnapshot(args.metaDir, earlier);
      if (to !== null) break;
    }
    const write = typeChangedRowsWriter({
      from,
      to,
      file: filename,
      deps: args.deps,
    });
    if (write !== undefined) perFile.set(filename, write);
  }
  return perFile;
}

/**
 * What a rollback to `point`, whose own snapshot records the registry, does
 * with the rows with its last DOWN (`RollbackBookkeeping.restore`):
 * nothing where the point's snapshot records nothing (an earlier release's,
 * or none), so such a point's rows stay as they are.
 */
async function undoToOwnSource(args: {
  metaDir: string;
  point: string | null;
  remaining: readonly string[];
  targets: ReadonlySet<string>;
  deps: RegistryWriteDeps;
}): Promise<Pick<RollbackBookkeeping, "restore" | "summary">> {
  if (args.point === null) return {};
  const at = await readMigrationSnapshot(args.metaDir, args.point);
  if (at === null || !carriesRegistryMetadata(at)) return {};
  // The records the database stood at before the rollback: the rolled-back
  // migrations' and the applied ones' before the point, back to the first
  // that records nothing.
  const earlier: EntitySettingsRecord[] = [];
  for (const name of [...args.remaining].reverse().slice(1)) {
    const snapshot = await readMigrationSnapshot(args.metaDir, name);
    if (snapshot === null) continue;
    if (!carriesRegistryMetadata(snapshot)) break;
    earlier.push(snapshot.entities);
  }
  const undone: EntitySettingsRecord[] = [];
  for (const name of args.targets) {
    const snapshot = await readMigrationSnapshot(args.metaDir, name);
    if (snapshot !== null && carriesRegistryMetadata(snapshot)) {
      undone.push(snapshot.entities);
    }
  }
  const source = {
    kind: "snapshot" as const,
    file: `${args.point}.snapshot.json`,
    entities: at.entities,
  };
  const plan = {
    // The rows the rolled-back migrations changed, and no other (D26).
    only: touchedEntities(undone, at.entities),
    remove: addedEntities(undone, at.entities),
    cleared: clearedSettings(at.entities, [...earlier, ...undone]),
    // Inside the last DOWN's transaction: a row that cannot be written
    // fails the DOWN, rather than committing it with the registry behind.
    strict: true,
  };
  const named = pointNamed(args.point);
  return {
    summary: `The registry rows would go back to what ${named} records.`,
    restore: async () => {
      const outcome = await writeRegistryRows(
        args.deps.adapter,
        () => writeRegistryFromSource(source, args.deps, plan),
        {
          wrote: written =>
            written.removed.length > 0 ||
            Object.values(written.written).some(count => count > 0),
        }
      );
      const rewritten = Object.values(outcome.written).reduce(
        (sum, count) => sum + count,
        0
      );
      // Strict, so nothing was left unwritten; a registry that could not be
      // read for a removal is the one way a row stays, and it fails too.
      if (outcome.failed.length > 0) {
        throw NextlyError.internal({
          logContext: {
            reason: "rollback registry rows not undone",
            rows: outcome.failed,
          },
        });
      }
      args.deps.logger.info(
        `The registry rows are back to what ${named} records: ` +
          `${rewritten} row(s) written back, ${outcome.removed.length} removed.`
      );
    },
  };
}

/**
 * The bookkeeping a rollback to the record's `point` undoes (see the module
 * comment), as one registry write, which joins the transaction of the DOWN
 * it runs in. What it judges by that can be read before that transaction
 * opens is read now: a plugin's lifecycle is written under the lock this run
 * holds, so it cannot change before the marks are judged, and a table probe
 * inside the transaction would abort it on PostgreSQL where the table is
 * missing.
 */
async function baselineRestore(args: {
  adapter: DrizzleAdapter;
  dialect: SupportedDialect;
  config: PermissionConfigSource & { plugins?: PluginDefinition[] };
  logger: ServiceLogger;
  point: string | null;
  baseline: RegistryBaseline;
  rolledBack: RolledBackMigration[];
  added: Record<RegistryKey, ReadonlySet<string>>;
}): Promise<() => Promise<void>> {
  const { adapter, baseline } = args;
  const notInstalled = await pluginsRecordedNotInstalled(adapter);
  const plugins = args.config.plugins ?? [];
  // Each configured plugin's declarations, told from the app's own by their
  // source, and those of the plugins still declaring theirs.
  const pluginDeclared = collectCustomPermissions(args.config, plugins).filter(
    p => p.source === "plugin"
  );
  const installed = collectCustomPermissions(
    args.config,
    pluginsStillDeclaring(plugins, notInstalled)
  ).filter(p => p.source === "plugin");
  const tables: DashboardTables = {
    dashboardPinsPresent: await dashboardPinsPresent(adapter),
    mediaUsagePresent: await mediaUsageTablePresent(adapter),
  };
  const decide = (rows: readonly OrphanPassRow[]) =>
    orphanMarksUndone({
      rows,
      baseline: baseline.permissions,
      rolledBack: args.rolledBack,
      installed,
      pluginDeclared,
    });
  return async () => {
    const outcome = await writeRegistryRows(
      adapter,
      async tx => ({
        ...(await restoreRows({
          adapter,
          db: tx.getDrizzle(),
          tx,
          dialect: args.dialect,
          baseline,
          added: args.added,
          tables,
          logger: args.logger,
        })),
        marks: await rewriteOrphanMarksOnCommandConnection(
          adapter,
          decide,
          args.logger
        ),
      }),
      {
        wrote: ({ restored, removed }) => restored.length + removed.length > 0,
        migration: () => args.point,
      }
    );
    args.logger.info(
      `The registry is back to the baseline the database's registry record keeps at ${pointNamed(args.point)}: ` +
        `${outcome.restored.length} row(s) written back, ${outcome.removed.length} removed, ` +
        `${outcome.marks} orphan mark(s) set or cleared.`
    );
  };
}
