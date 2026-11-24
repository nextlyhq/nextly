/**
 * The development server's report of the changes not yet in a migration: the drift indicator of
 * the push loop, which keeps pushing a configuration to the development database and says which
 * of its changes no migration file captures yet.
 *
 * Said at a development start and after each reload that applies a change from the configuration
 * (`reload-config.ts`), and when a migration is written or the Schema Builder's definition file
 * changes (`drift-watch.ts`): one block naming each entity and what changed in it
 * (`entityChangesOf`) and the command that captures them. Nothing while nothing is pending, and
 * an unchanged block is never said again. Once a migration captures the last of them, it says so
 * once; a change undone in the configuration, which no migration captured, says nothing.
 *
 * It reads the one comparison `migrate:check` reports from (`unwrittenChangesOf`), with no
 * database. Loaded only behind `driftReportAllowed`, so a production start loads none of it.
 *
 * @module init/drift-block
 */
import { join } from "node:path";

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import {
  type UnwrittenChangesArgs,
  unwrittenChangesOf,
} from "../domains/schema/migrate/unwritten-changes";
import { newestSnapshotName } from "../domains/schema/migrate-create/snapshot-io";
import {
  type EntityChanges,
  entityChangesOf,
} from "../domains/schema/pending/entity-changes";
import { processGlobal } from "../shared/process-global";
import { consoleLogger } from "../shared/types";

import { driftReportAllowed } from "./drift-gate";
import { ensureDriftWatch } from "./drift-watch";

/** The block's first line. */
export const DRIFT_HEADER = "Schema changes not yet in a migration:";

/** The block's last line: the command that captures them. */
export const DRIFT_NEXT = "Run `nextly migrate:create` to capture them.";

/** What is said once a migration has captured the last of them. */
export const FULLY_CAPTURED =
  "The schema is fully captured: every change is in a migration.";

/** The block naming `entities`, each with what changed in it. */
export function renderDriftBlock(entities: readonly EntityChanges[]): string {
  return [
    DRIFT_HEADER,
    ...entities.map(
      ({ label, changes }) => `  - ${label}: ${changes.join(", ")}`
    ),
    DRIFT_NEXT,
  ].join("\n");
}

/** What the report found: the block, or null where nothing is pending, and the newest snapshot. */
export interface DriftFound {
  block: string | null;
  newest: string | null;
}

/**
 * What to say, given what was found last and now: a block that differs from the last one; that
 * the schema is fully captured, where a block was said and the list emptied as a migration was
 * written (the newest snapshot changed); otherwise nothing.
 */
export function nextDriftReport(
  last: DriftFound | undefined,
  now: DriftFound
): string | undefined {
  if (now.block !== null) {
    return now.block === last?.block ? undefined : now.block;
  }
  if (last === undefined || last.block === null) return undefined;
  return now.newest !== last.newest ? FULLY_CAPTURED : undefined;
}

/** The configuration a report compares, as the reload that landed read it. */
export type DriftInputs = Pick<
  UnwrittenChangesArgs,
  "config" | "deferredExtends"
>;

/** The process's one report: what it found last, its inputs, and the run under way. */
interface DriftState {
  last?: DriftFound;
  inputs?: DriftInputs;
  running?: Promise<void>;
  again: boolean;
}

const state = (): DriftState =>
  processGlobal("driftReport", () => ({ again: false }));

/**
 * Report the changes not yet in a migration, with `inputs` where a reload hands new ones, else
 * the last ones. One report runs at a time; one asked for while it runs follows it once.
 */
export function reportPendingChanges(inputs?: DriftInputs): Promise<void> {
  if (!driftReportAllowed()) return Promise.resolve();
  const report = state();
  if (inputs !== undefined) report.inputs = inputs;
  if (report.running !== undefined) {
    report.again = true;
    return report.running;
  }
  report.running = (async () => {
    do {
      report.again = false;
      await reportOnce(report);
    } while (report.again);
  })().finally(() => {
    report.running = undefined;
  });
  return report.running;
}

/** The comparison's warnings and errors are the configuration's, which the reload reports. */
const QUIET = { warn: () => undefined, error: () => undefined };

async function reportOnce(report: DriftState): Promise<void> {
  const inputs = report.inputs;
  if (inputs === undefined) return;
  try {
    const { startProject } = await import("./boot-apply");
    const project = await startProject();
    const dialect = await adapterDialect();
    if (dialect === undefined) return;
    const changes = await unwrittenChangesOf({
      ...inputs,
      projectRoot: project.root,
      migrationsDir: project.migrationsDir,
      dialect,
      logger: QUIET,
    });
    const entities = entityChangesOf(changes);
    const now: DriftFound = {
      block: entities.length === 0 ? null : renderDriftBlock(entities),
      newest:
        (await newestSnapshotName(join(project.migrationsDir, "meta"))) ?? null,
    };
    const said = nextDriftReport(report.last, now);
    report.last = now;
    if (said === FULLY_CAPTURED) consoleLogger.info(said);
    else if (said !== undefined) consoleLogger.warn(said);
    ensureDriftWatch(
      {
        migrationsDir: project.migrationsDir,
        definitionFile: join(project.root, inputs.config.db.uiSchemaFile),
      },
      () => void reportPendingChanges()
    );
  } catch (error) {
    // The report never stands in a reload's way: a comparison that cannot be made (a definition
    // the reload has yet to accept, a history `migrate:check` refuses) is said by those.
    consoleLogger.debug(
      `The changes not yet in a migration could not be read: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/** The dialect of the database the development server runs on, where one is registered. */
async function adapterDialect(): Promise<SupportedDialect | undefined> {
  const { container } = await import("../di/container");
  if (!container.has("adapter")) return undefined;
  return container.get<{ dialect: SupportedDialect }>("adapter").dialect;
}
