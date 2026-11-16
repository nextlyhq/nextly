// What: implements `nextly db:sync --demote <slug>` which moves a
// code-owned collection (defined in nextly.config.ts) to UI-owned by
// writing it to dynamic_collections and instructing the user to delete
// the code block.
// collection in code hand off schema editing to the Visual Schema Builder
// without re-creating anything.

import { createHash } from "node:crypto";

import * as p from "@clack/prompts";
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import {
  toCodeFirstCollectionConfig,
  type CodeFirstCollectionSource,
} from "../../domains/collections/services/collection-sync-service";
import { assertNoMigrationInFlight } from "../../domains/field-groups/migration/sync-guard";
import { canPrompt } from "../../domains/schema/migrate/can-prompt";
import { serializeCollection } from "../../domains/schema/services/code-generator";
import { resolveCollectionTableName } from "../../domains/schema/utils/resolve-table-name";
import type { DynamicCollectionInsert } from "../../schemas/dynamic-collections/types";
import type { CollectionRegistryService } from "../../services/collections/collection-registry-service";
import { reportDryRun, type DryRunPlan } from "../dry-run";
import { exitWithError } from "../errors";
import {
  demoteCollectionNotFound,
  syncConfirmationRequired,
} from "../errors/areas/sync";
import type { CommandContext } from "../program";
// F1 PR 4: switched from the deleted wrapper/config-loader (jiti-based,
// took a positional cwd arg) to the canonical cli/utils/config-loader
// (bundle-require-based, takes an options object). The wrapper helper
// kept its own signature, so wrap the call here to preserve the
// downstream code's expectation of `{ config, configPath, ... }`.
import { loadConfig } from "../utils/config-loader";
import type { Logger } from "../utils/logger";
import { answered } from "../utils/prompt-cancelled";

import { confirmationAnswered } from "./db-sync-promote";
import {
  collectionChangedAfterConsent,
  openCollectionRegistry,
  sameCollectionRecord,
  syncRefusalOf,
  withCollectionRegistryWrite,
} from "./db-sync-registry";

async function loadNextlyConfig(cwd: string) {
  return loadConfig({ cwd });
}

/**
 * A collection as `nextly.config.ts` defines it, in the parts a demote reads: every option the
 * code-first sync stores on a registry record, and the code-only options a demote has to say it
 * cannot carry.
 */
export interface DemotedCollection extends CodeFirstCollectionSource<unknown> {
  /** An older spelling of the singular label. */
  label?: string;
  access?: unknown;
  hooks?: unknown;
  endpoints?: unknown;
  indexes?: unknown;
  search?: unknown;
  workflow?: unknown;
  custom?: unknown;
  sanitize?: unknown;
}

/**
 * The options a code collection can set that no registry record holds, each with what it is.
 * Functions (access rules, hooks, endpoints, a workflow) cannot be stored as data, and the rest
 * have no column, so the Schema Builder's collection goes without them.
 */
const NOT_CARRIED_BY_A_RECORD = {
  access: "access rules",
  hooks: "hooks",
  endpoints: "endpoints",
  indexes: "indexes",
  search: "search settings",
  workflow: "a workflow",
  db: "database options",
  custom: "custom settings",
  sanitize: "its input sanitizing setting",
} as const satisfies Partial<Record<keyof DemotedCollection, string>>;

/** What a demote acts on, with its prompt and its lock wait as seams a test can stand in for. */
export interface DemoteCollectionArgs {
  collection: DemotedCollection;
  logger: Logger;
  registry: CollectionRegistryService;
  /** The adapter the registry was opened on; the schema lock is taken on it. */
  adapter: DrizzleAdapter;
  /** Shows what will be written and answers whether to go ahead. Runs holding no lock. */
  confirm: (code: string) => Promise<boolean>;
  /** How long a held schema lock is waited for, in milliseconds. */
  lockWaitMs?: number;
}

/**
 * Demote one code-first collection: write it to the Schema Builder's registry, updating the record
 * already there or creating one.
 *
 * The operator is asked first, holding no lock, so a confirmation left open blocks nothing. The
 * record the confirmed write would replace is read before the prompt and again under the schema
 * lock: if it changed, appeared or vanished in between, nothing is written and the run stops with
 * `PLAN_CHANGED_AFTER_CONSENT`.
 */
export async function demoteCollection(
  args: DemoteCollectionArgs
): Promise<"demoted" | "cancelled"> {
  const { collection, logger, registry } = args;
  const { slug } = collection;
  const fields = collection.fields ?? [];

  const confirmed = await registry.getCollectionBySlug(slug);
  const note = droppedOnDemoteNote(collection);
  const preview = [
    serializeCollection({ slug, fields: fields as never[] }),
    ...note.map(line => `// ${line}`),
  ].join("\n");

  if (!(await args.confirm(preview))) {
    logger.info("Demote cancelled.");
    return "cancelled";
  }

  await withCollectionRegistryWrite(
    {
      adapter: args.adapter,
      logger,
      label: "db:sync --demote",
      waitMs: args.lockWaitMs,
    },
    async () => {
      const current = await registry.getCollectionBySlug(slug);
      if (!sameCollectionRecord(confirmed, current)) {
        throw collectionChangedAfterConsent({
          slug,
          command: "nextly db:sync --demote",
          confirmed,
          current,
        });
      }

      await writeDemotedRecord(registry, collection, current, logger);
    }
  );

  logger.info(
    `Collection '${slug}' written to UI source. Remove its entry from your nextly.config.ts collections array, then restart dev server.`
  );
  if (note.length > 0) logger.info(note.join("\n"));
  return "demoted";
}

/**
 * The registry write a demote makes, given the record the registry holds for the slug now: an
 * update of that record (a second `--demote`, or a slug the registry already holds), or a new
 * record registered.
 */
type DemotedWrite =
  | {
      kind: "update";
      slug: string;
      data: Parameters<CollectionRegistryService["updateCollection"]>[1];
    }
  | { kind: "register"; record: DynamicCollectionInsert };

/** The write a demote of `collection` makes over `current`, the record the registry holds now. */
function demotedWrite(
  collection: DemotedCollection,
  current: Awaited<ReturnType<CollectionRegistryService["getCollectionBySlug"]>>
): DemotedWrite {
  // The options the collection already had as code, so a demote keeps its names, admin options and
  // lifecycle (`demotedOptions`).
  const options = demotedOptions(collection);
  if (current) {
    return {
      kind: "update",
      slug: collection.slug,
      data: { ...options, source: "ui" },
    };
  }
  return {
    kind: "register",
    record: {
      slug: collection.slug,
      ...options,
      source: "ui",
      schemaHash: createHash("sha256")
        .update(JSON.stringify(options.fields))
        .digest("hex"),
      configPath: "demoted-from-code",
    },
  };
}

/**
 * Asks the registry the questions `write` would be refused on, writing nothing: what an update
 * refuses (such as a record defined in code), or what a registration refuses.
 */
async function assertDemotedWriteAllowed(
  registry: CollectionRegistryService,
  write: DemotedWrite
): Promise<void> {
  if (write.kind === "update") {
    await registry.assertUpdatable(write.slug, write.data);
    return;
  }
  await registry.assertRegistrable(write.record.slug);
}

/**
 * The lines that go with a demote when the collection sets options no registry record holds:
 * the Schema Builder's collection goes without them, so they stop applying once its code entry
 * is removed. None where it sets no such option.
 */
export function droppedOnDemoteNote(collection: DemotedCollection): string[] {
  const dropped: string[] = Object.entries(NOT_CARRIED_BY_A_RECORD)
    .filter(([key]) => collection[key as keyof DemotedCollection] !== undefined)
    .map(([, what]) => what);
  const admin = collection.admin as { preview?: unknown } | undefined;
  if (admin?.preview !== undefined) dropped.push("its preview link");
  if (dropped.length === 0) return [];
  return [
    "It sets options the Schema Builder cannot hold, which stop once its code entry is removed:",
    `${dropped.join(", ")}.`,
  ];
}

/**
 * Write a demoted collection to the Schema Builder's registry: update the record already there
 * (a second `--demote`, or a slug the registry already holds), or register a new one.
 * Runs under the schema lock, after the record has been read again and found unchanged.
 */
async function writeDemotedRecord(
  registry: CollectionRegistryService,
  collection: DemotedCollection,
  current: Awaited<
    ReturnType<CollectionRegistryService["getCollectionBySlug"]>
  >,
  logger: Logger
): Promise<void> {
  const write = demotedWrite(collection, current);
  if (write.kind === "update") {
    await registry.updateCollection(write.slug, write.data);
    logger.info(`Updated existing UI record for '${write.slug}'.`);
    return;
  }
  await registry.registerCollection(write.record);
}

/**
 * What `db:sync --demote <slug> --dry-run` reports: the registry write the real demote makes, from
 * the same record it reads, with the refusals it asks along the way, in its order (a field-group
 * storage migration in flight, then what the registry refuses the write on), and nothing asked,
 * locked or written.
 */
async function previewDemotion(args: {
  collection: DemotedCollection;
  registry: CollectionRegistryService;
  adapter: DrizzleAdapter;
  logger: Logger;
}): Promise<DryRunPlan> {
  try {
    const current = await args.registry.getCollectionBySlug(
      args.collection.slug
    );
    await assertNoMigrationInFlight({
      adapter: args.adapter,
      logger: args.logger,
      action: "db:sync --demote",
    });
    const write = demotedWrite(args.collection, current);
    await assertDemotedWriteAllowed(args.registry, write);
    const note = droppedOnDemoteNote(args.collection);
    return {
      ...(note.length > 0 ? { notes: [note.join("\n")] } : {}),
      changes: [
        write.kind === "update"
          ? {
              action: "set",
              target: `the registry record of collection '${write.slug}' in the collection registry to:\n${JSON.stringify(write.data, null, 2)}`,
            }
          : {
              action: "record",
              target: `collection '${write.record.slug}' in the collection registry, as:\n${JSON.stringify(write.record, null, 2)}`,
            },
      ],
    };
  } catch (error) {
    const refusal = syncRefusalOf(error);
    if (refusal === undefined) throw error;
    return { changes: [], refusals: [refusal] };
  }
}

/**
 * Everything a demoted collection's record stores about it: its names, description, table,
 * fields, admin options and every collection-level option that changes how it behaves (its
 * Draft/Published lifecycle, drafts and history, translations, timestamps, cache and webhook
 * opt-outs). Taken from the projection the code-first sync stores a collection with
 * (`toCodeFirstCollectionConfig`), so the record is the one the collection already had while its
 * code owned it, and promoting it again prints the same collection. An option the collection does
 * not set is written as cleared, so an update leaves nothing of an older record behind.
 *
 * Besides that, the record needs a source (always "ui": ownership passes to the Builder) and a
 * hash of its fields, which the caller adds.
 */
function demotedOptions(collection: DemotedCollection) {
  const config = toCodeFirstCollectionConfig(collection);
  return {
    labels: {
      singular:
        collection.labels?.singular ??
        collection.label ??
        config.labels.singular,
      plural: config.labels.plural,
    },
    description: config.description ?? null,
    // The table the code-first sync named, so the entries stay where they are.
    tableName: resolveCollectionTableName(collection.slug, collection.dbName),
    fields: config.fields as DynamicCollectionInsert["fields"],
    timestamps: config.timestamps,
    admin: config.admin ?? null,
    status: config.status,
    versions: config.versions ?? null,
    localized: config.localized,
    revalidate: config.revalidate ?? null,
    webhooks: config.webhooks ?? null,
  } satisfies Partial<DynamicCollectionInsert>;
}

/** The terminal's confirmation for a demote: what will be written, then a yes or no. */
async function askToDemote(slug: string, code: string): Promise<boolean> {
  p.note(code, `About to move '${slug}' to UI source`);
  // Ctrl+C at the prompt ends the run with exit 130 (`answered`); a no is a declined demote.
  return answered(
    await p.confirm({
      message:
        "Write to dynamic_collections so the Schema Builder can edit it?",
    })
  );
}

/**
 * The collection `nextly.config.ts` defines under `slug`, which a demote moves, or undefined when it
 * defines none, which a demote refuses. A configuration that cannot be loaded ends the run.
 */
async function findDemotedCollection(
  slug: string,
  context: CommandContext
): Promise<DemotedCollection | undefined> {
  let config: Awaited<ReturnType<typeof loadNextlyConfig>>["config"];
  try {
    config = (await loadNextlyConfig(context.cwd)).config;
  } catch (err) {
    exitWithError(context.logger, err);
  }
  const collections = (config.collections ?? []) as DemotedCollection[];
  return collections.find(c => c.slug === slug);
}

/**
 * `db:sync --demote <slug> --dry-run`: the demote's registry write, read over a read-only
 * connection, with no confirmation asked and no lock taken. A collection the configuration does not
 * define is named as the real run's refusal; a database that is not there has been said and ends
 * the run.
 */
export async function runDemoteDryRun(
  slug: string,
  context: CommandContext
): Promise<void> {
  const { logger } = context;
  const collection = await findDemotedCollection(slug, context);
  if (!collection) {
    reportDryRun(logger, {
      changes: [],
      refusals: [demoteCollectionNotFound(slug).what],
    });
    return;
  }
  const opened = await openCollectionRegistry(logger, true);
  if (opened === undefined) return;
  try {
    reportDryRun(
      logger,
      await previewDemotion({
        collection,
        registry: opened.registry,
        adapter: opened.adapter,
        logger,
      })
    );
  } finally {
    await opened.adapter.disconnect();
  }
}

export async function runDemote(
  slug: string,
  context: CommandContext
): Promise<void> {
  const { logger } = context;

  // 1. Load user config so we can find the target collection.
  const collection = await findDemotedCollection(slug, context);
  if (!collection) {
    exitWithError(logger, demoteCollectionNotFound(slug));
  }

  // Its confirmation cannot be asked and `--yes` did not answer it: stop
  // before the database is opened, so nothing is changed.
  if (!confirmationAnswered(context) && !canPrompt()) {
    exitWithError(logger, syncConfirmationRequired("--demote", slug));
  }

  // 2. Database wiring.
  const opened = await openCollectionRegistry(logger);
  if (opened === undefined) return;
  const { registry, adapter } = opened;
  try {
    await demoteCollection({
      collection,
      logger,
      registry,
      adapter,
      // `--yes` answers the confirmation: write, without asking.
      confirm: code =>
        confirmationAnswered(context)
          ? Promise.resolve(true)
          : askToDemote(slug, code),
    });
  } finally {
    await adapter.disconnect();
  }
}
