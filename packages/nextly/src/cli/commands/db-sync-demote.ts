// What: implements `nextly db:sync --demote <slug>` which moves a
// code-owned collection (defined in nextly.config.ts) to UI-owned by
// writing it to dynamic_collections and instructing the user to delete
// the code block.
// Why: Task 11 reverse of --promote. Lets users who originally wrote a
// collection in code hand off schema editing to the visual builder
// without re-creating anything.

import { createHash } from "node:crypto";

import * as p from "@clack/prompts";
import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";

import { serializeCollection } from "../../domains/schema/services/code-generator";
import { CollectionRegistryService } from "../../services/collections/collection-registry-service";
import type { CommandContext } from "../program";
import { createAdapter, validateDatabaseEnv } from "../utils/adapter";
// F1 PR 4: switched from the deleted wrapper/config-loader (jiti-based,
// took a positional cwd arg) to the canonical cli/utils/config-loader
// (bundle-require-based, takes an options object). The wrapper helper
// kept its own signature, so wrap the call here to preserve the
// downstream code's expectation of `{ config, configPath, ... }`.
import { loadConfig } from "../utils/config-loader";

async function loadNextlyConfig(cwd: string) {
  return loadConfig({ cwd });
}

export async function runDemote(
  slug: string,
  context: CommandContext
): Promise<void> {
  const { logger } = context;

  // 1. Load user config via jiti so we can find the target collection.
  let config: Awaited<ReturnType<typeof loadNextlyConfig>>["config"];
  try {
    const result = await loadNextlyConfig(context.cwd);
    config = result.config;
  } catch (err) {
    logger.error(
      `Could not load nextly config: ${err instanceof Error ? err.message : String(err)}`
    );
    process.exit(1);
  }

  const collections = (config.collections ?? []) as Array<{
    slug: string;
    labels?: { singular?: string; plural?: string };
    label?: string;
    fields?: unknown[];
    description?: string;
    dbName?: string;
  }>;
  const collection = collections.find(c => c.slug === slug);
  if (!collection) {
    logger.error(
      `Collection '${slug}' not found in nextly.config.ts collections.`
    );
    process.exit(1);
  }

  // 2. Database wiring.
  const env = validateDatabaseEnv();
  if (!env.valid) {
    logger.error(env.errors.join("; "));
    process.exit(1);
  }
  const adapter = await createAdapter({ logger });
  const registry = new CollectionRegistryService(
    adapter as unknown as DrizzleAdapter,
    {
      info: (msg: string) => logger.debug(msg),
      warn: (msg: string) => logger.warn(msg),
      error: (msg: string) => logger.error(msg),
      debug: (msg: string) => logger.debug(msg),
    }
  );

  // 3. Prompt before any write.
  const fields = collection.fields ?? [];
  p.note(
    serializeCollection({ slug, fields: fields as never[] }),
    `About to move '${slug}' to UI source`
  );
  const confirm = await p.confirm({
    message: "Write to dynamic_collections so the Schema Builder can edit it?",
  });
  if (p.isCancel(confirm) || !confirm) {
    logger.info("Demote cancelled.");
    return;
  }

  // 4. Upsert the UI record. If the user accidentally ran --demote twice
  // or the slug somehow already exists, update rather than fail.
  const existing = await registry.getCollectionBySlug(slug);
  if (existing) {
    await registry.updateCollection(slug, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fields: fields as any,
      source: "ui",
    });
    logger.info(`Updated existing UI record for '${slug}'.`);
  } else {
    // registerCollection expects a full DynamicCollectionInsert. The
    // required fields beyond what the user's config carries are tableName
    // (fall back to dc_<slug> convention), source (always "ui" here since
    // we are handing ownership to the UI), and schemaHash (stable hash of
    // fields JSON so future change detection works).
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fields: fields as any,
      source: "ui",
      schemaHash,
      ...(collection.description !== undefined && {
        description: collection.description,
      }),
      configPath: "demoted-from-code",
    });
  }

  logger.info(
    `Collection '${slug}' written to UI source. Remove its entry from your nextly.config.ts collections array, then restart dev server.`
  );
}
