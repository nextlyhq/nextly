// What: implements `nextly db:sync --demote <slug>` which moves a
// code-owned collection (defined in nextly.config.ts) to UI-owned by
// writing it to dynamic_collections and instructing the user to delete
// the code block.
// collection in code hand off schema editing to the Visual Schema Builder
// without re-creating anything.

import { createHash } from "node:crypto";

import * as p from "@clack/prompts";
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { serializeCollection } from "../../domains/schema/services/code-generator";
import type { DynamicCollectionInsert } from "../../schemas/dynamic-collections/types";
import type { CollectionRegistryService } from "../../services/collections/collection-registry-service";
import { exitWithError } from "../errors";
import { demoteCollectionNotFound } from "../errors/areas/sync";
import type { CommandContext } from "../program";
// F1 PR 4: switched from the deleted wrapper/config-loader (jiti-based,
// took a positional cwd arg) to the canonical cli/utils/config-loader
// (bundle-require-based, takes an options object). The wrapper helper
// kept its own signature, so wrap the call here to preserve the
// downstream code's expectation of `{ config, configPath, ... }`.
import { loadConfig } from "../utils/config-loader";
import type { Logger } from "../utils/logger";

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

      // Upsert the UI record. If the user ran --demote twice or the slug already exists, update
      // rather than fail.
      if (current) {
        await registry.updateCollection(slug, {
          fields: fields as DynamicCollectionInsert["fields"],
          source: "ui",
        });
        logger.info(`Updated existing UI record for '${slug}'.`);
        return;
      }
      // registerCollection expects a full DynamicCollectionInsert. The required fields beyond what
      // the user's config carries are tableName (fall back to dc_<slug> convention), source
      // (always "ui" here since we are handing ownership to the UI), and schemaHash (stable hash
      // of fields JSON so future change detection works).
      const tableName = collection.dbName ?? `dc_${slug}`;
      const fieldsJson = JSON.stringify(fields);
      const schemaHash = createHash("sha256").update(fieldsJson).digest("hex");
      await registry.registerCollection({
        slug,
        labels: {
          singular: collection.labels?.singular ?? collection.label ?? slug,
          plural: collection.labels?.plural ?? slug,
        },
        tableName,
        fields: fields as DynamicCollectionInsert["fields"],
        source: "ui",
        schemaHash,
        ...(collection.description !== undefined && {
          description: collection.description,
        }),
        configPath: "demoted-from-code",
      });
    }
  );

  logger.info(
    `Collection '${slug}' written to UI source. Remove its entry from your nextly.config.ts collections array, then restart dev server.`
  );
  return "demoted";
}

/** The terminal's confirmation for a demote: what will be written, then a yes or no. */
async function askToDemote(slug: string, code: string): Promise<boolean> {
  p.note(code, `About to move '${slug}' to UI source`);
  const confirm = await p.confirm({
    message: "Write to dynamic_collections so the Schema Builder can edit it?",
  });
  return !p.isCancel(confirm) && confirm;
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

  // 2. Database wiring.
  const { registry, adapter } = await openCollectionRegistry(logger);
  try {
    await demoteCollection({
      collection,
      logger,
      registry,
      adapter,
      confirm: code => askToDemote(slug, code),
    });
  } finally {
    await adapter.disconnect();
  }
}
