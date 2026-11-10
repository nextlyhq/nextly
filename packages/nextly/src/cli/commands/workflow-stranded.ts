/**
 * Workflow stranded commands
 *
 * Implements `nextly workflow:stranded`, which lists every part of a document
 * recorded in a stage its workflow no longer has (and that the definition
 * names nowhere for), and `nextly workflow:move-stranded`, which moves them to
 * a named stage in one transaction, recording one event per document as the
 * person `--as` names, with `--comment` as its note.
 *
 * The workflows are the configuration's, checked as boot checks them; the
 * database is read and written through the workflows domain, which decides
 * what is stranded once for this list, the move and the `_strandedStage`
 * filter.
 *
 * **Runtime restriction:** CLI-only. Do NOT import from runtime code.
 *
 * @module cli/commands/workflow-stranded
 * @example
 * ```bash
 * nextly workflow:stranded
 * nextly workflow:move-stranded --to drafting --as editor@example.com --comment "Legal check was retired"
 * ```
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { Command } from "commander";

import { registerEntityRuntimeTables } from "../../di/register-runtime-tables";
import {
  buildWorkflowRegistry,
  type RegisteredWorkflow,
} from "../../domains/workflows/registry";
import {
  moveStrandedReviewStates,
  strandedReviewStates,
  type StrandedReviewState,
} from "../../domains/workflows/stranded-stages";
import type { FieldDefinition } from "../../schemas/dynamic-collections";
import type { CommandContext } from "../context";
import { exitWithError } from "../errors";
import {
  connectOrExit,
  requireDatabaseEnv,
} from "../utils/command-prerequisites";
import { loadConfig } from "../utils/config-loader";
import { installRegistryResolver } from "../utils/registry-resolver";

import { commandRun } from "./command-run";

/** What both commands run on: the database, and the configuration's workflows. */
interface StrandedRun {
  adapter: DrizzleAdapter;
  workflows: Iterable<RegisteredWorkflow>;
  /** Only this collection's documents. */
  collection?: string;
}

/** The stranded parts, ordered by document and part. */
function runListStranded(run: StrandedRun): Promise<StrandedReviewState[]> {
  return strandedReviewStates(run.adapter, {
    workflows: run.workflows,
    ...(run.collection !== undefined ? { collection: run.collection } : {}),
  });
}

/**
 * Moves the stranded parts to `to` as the person `as` names, with `comment`,
 * and answers the documents moved. Refused, moving nothing, as
 * `moveStrandedReviewStates` refuses.
 */
function runMoveStranded(
  run: StrandedRun & { to: string; as: string; comment: string }
) {
  return moveStrandedReviewStates(run.adapter, {
    workflows: run.workflows,
    ...(run.collection !== undefined ? { collection: run.collection } : {}),
    to: run.to,
    as: run.as,
    comment: run.comment,
  });
}

/**
 * Loads the configuration's workflows, checked as boot checks them, connects
 * to the database and hands both to `work`, disconnecting after. A command
 * reads the components the configuration defines from their definitions; any
 * other is judged at boot.
 */
async function withStrandedRun<T>(
  options: { config?: string; cwd?: string; collection?: string },
  context: CommandContext,
  work: (run: StrandedRun) => Promise<T>
): Promise<T> {
  const configResult = await loadConfig({
    configPath: options.config,
    cwd: options.cwd,
  });
  const registry = await buildWorkflowRegistry(
    configResult.config,
    configResult.configPath ?? null,
    { components: configResult.config.fieldGroups ?? [], readRegistry: false }
  );
  const dbValidation = requireDatabaseEnv(context.logger);
  const adapter = await connectOrExit(
    {
      dialect: dbValidation.dialect,
      databaseUrl: dbValidation.databaseUrl,
    },
    context.logger
  );
  try {
    const drizzleAdapter = adapter as unknown as DrizzleAdapter;
    await installStrandedRunResolver(drizzleAdapter, registry.values());
    return await work({
      adapter: drizzleAdapter,
      workflows: registry.values(),
      ...(options.collection !== undefined
        ? { collection: options.collection }
        : {}),
    });
  } finally {
    await adapter.disconnect();
  }
}

/** A registry row as a command reads it to register its entity's tables. */
interface EntityRow {
  slug: string;
  tableName: string;
  fields: unknown;
  status: unknown;
  localized: unknown;
}

/** A registry's stored `fields`, from either form a driver returns. */
function storedFields(value: unknown): FieldDefinition[] {
  const parsed: unknown =
    typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  return Array.isArray(parsed) ? (parsed as FieldDefinition[]) : [];
}

/**
 * Installs the table resolver a stranded-stage command reads and writes through: the system
 * tables, and the tables of every collection and Single `workflows` are attached to, read from
 * their registry rows. A move locks each document's own row, and a command has no boot to have
 * registered those tables.
 *
 * @experimental
 */
export async function installStrandedRunResolver(
  adapter: DrizzleAdapter,
  workflows: Iterable<RegisteredWorkflow>
): Promise<void> {
  const schemaRegistry = installRegistryResolver(adapter);
  const { dialect } = adapter.getCapabilities();
  const attached = [...workflows];
  const registries = [
    ["dynamic_collections", attached.flatMap(each => each.collections)],
    ["dynamic_singles", attached.flatMap(each => each.singles)],
  ] as const;
  for (const [registry, slugs] of registries) {
    if (slugs.length === 0) continue;
    const rows = await adapter.select<EntityRow>(registry, {
      columns: ["slug", "tableName", "fields", "status", "localized"],
      where: { and: [{ column: "slug", op: "IN", value: [...slugs] }] },
    });
    for (const row of rows) {
      registerEntityRuntimeTables(
        schemaRegistry,
        {
          slug: row.slug,
          tableName: row.tableName,
          fields: storedFields(row.fields),
          status: Boolean(row.status),
          localized: Boolean(row.localized),
        },
        dialect
      );
    }
  }
}

/** One stranded part as a table row: its document, part, stage and workflow. */
function strandedRow(state: StrandedReviewState): string[] {
  return [
    `${state.scopeKind} ${state.scopeSlug}`,
    state.entryId,
    state.part ?? "shared",
    state.message,
    state.workflow,
  ];
}

/** The action of `nextly workflow:stranded`, loaded when it runs. */
export async function workflowStrandedAction(
  cmdOptions: { collection?: string },
  cmd: Command
): Promise<void> {
  const { context, options } = commandRun(cmdOptions, cmd);
  try {
    context.logger.header("Stranded documents");
    const stranded = await withStrandedRun(options, context, runListStranded);
    if (stranded.length === 0) {
      context.logger.success(
        "No document is in a stage its workflow no longer has."
      );
      return;
    }
    context.logger.table(
      ["Collection", "Document", "Part", "Why", "Workflow"],
      stranded.map(strandedRow)
    );
    context.logger.info(
      "Move them with `nextly workflow:move-stranded --to <stage> --as <email> --comment <why>`."
    );
  } catch (error) {
    exitWithError(context.logger, error);
  }
}

/** The action of `nextly workflow:move-stranded`, loaded when it runs. */
export async function workflowMoveStrandedAction(
  cmdOptions: { to: string; as: string; comment: string; collection?: string },
  cmd: Command
): Promise<void> {
  const { context, options } = commandRun(cmdOptions, cmd);
  try {
    context.logger.header("Move stranded documents");
    const moved = await withStrandedRun(options, context, run =>
      runMoveStranded({ ...run, ...cmdOptions })
    );
    context.logger.success(
      `Moved ${moved.length} ${moved.length === 1 ? "document" : "documents"} to "${cmdOptions.to}".`
    );
  } catch (error) {
    exitWithError(context.logger, error);
  }
}
