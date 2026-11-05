// What: implements `nextly db:sync --demote <slug>` which moves a
// code-owned collection (defined in nextly.config.ts) to UI-owned by
// writing it to dynamic_collections and instructing the user to delete
// the code block.
// collection in code hand off schema editing to the Visual Schema Builder
// without re-creating anything.

import { createHash } from "node:crypto";

import * as p from "@clack/prompts";
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { canPrompt } from "../../domains/schema/migrate/can-prompt";
import { serializeCollection } from "../../domains/schema/services/code-generator";
import type { DynamicCollectionInsert } from "../../schemas/dynamic-collections/types";
import type { CollectionRegistryService } from "../../services/collections/collection-registry-service";
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
  withCollectionRegistryWrite,
} from "./db-sync-registry";

async function loadNextlyConfig(cwd: string) {
  return loadConfig({ cwd });
}

/** A collection as `nextly.config.ts` defines it, in the parts a demote writes. */
export interface DemotedCollection {
  slug: string;
  labels?: { singular?: string; plural?: string };
  label?: string;
  fields?: unknown[];
  description?: string;
  dbName?: string;
}

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

  if (
    !(await args.confirm(
      serializeCollection({ slug, fields: fields as never[] })
    ))
  ) {
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
  return "demoted";
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
  const { slug } = collection;
  const fields = (collection.fields ?? []) as DynamicCollectionInsert["fields"];
  if (current) {
    await registry.updateCollection(slug, { fields, source: "ui" });
    logger.info(`Updated existing UI record for '${slug}'.`);
    return;
  }
  await registry.registerCollection(newDemotedRecord(collection, fields));
}

/**
 * The registry record a demoted collection is registered as. `registerCollection` expects a full
 * DynamicCollectionInsert; beyond what the config carries it needs the table name (the `dc_<slug>`
 * convention when the config names none), the source (always "ui": ownership passes to the
 * Builder) and a hash of the fields JSON, so later change detection works.
 */
function newDemotedRecord(
  collection: DemotedCollection,
  fields: DynamicCollectionInsert["fields"]
): DynamicCollectionInsert {
  const { slug } = collection;
  return {
    slug,
    labels: {
      singular: collection.labels?.singular ?? collection.label ?? slug,
      plural: collection.labels?.plural ?? slug,
    },
    tableName: collection.dbName ?? `dc_${slug}`,
    fields,
    source: "ui",
    schemaHash: createHash("sha256")
      .update(JSON.stringify(fields))
      .digest("hex"),
    ...(collection.description !== undefined && {
      description: collection.description,
    }),
    configPath: "demoted-from-code",
  };
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

export async function runDemote(
  slug: string,
  context: CommandContext
): Promise<void> {
  const { logger } = context;

  // 1. Load user config so we can find the target collection.
  let config: Awaited<ReturnType<typeof loadNextlyConfig>>["config"];
  try {
    const result = await loadNextlyConfig(context.cwd);
    config = result.config;
  } catch (err) {
    exitWithError(logger, err);
  }

  const collections = (config.collections ?? []) as DemotedCollection[];
  const collection = collections.find(c => c.slug === slug);
  if (!collection) {
    exitWithError(logger, demoteCollectionNotFound(slug));
  }

  // Its confirmation cannot be asked and `--yes` did not answer it: stop
  // before the database is opened, so nothing is changed.
  if (!confirmationAnswered(context) && !canPrompt()) {
    exitWithError(logger, syncConfirmationRequired("--demote", slug));
  }

  // 2. Database wiring.
  const { registry, adapter } = await openCollectionRegistry(logger);
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
