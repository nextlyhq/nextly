/**
 * Phase A — Schema seed (visual approach only).
 *
 * Two steps for visual projects:
 *   1. Register metadata via the registry services so the admin UI shows
 *      the new collections and singles.
 *   2. Run applyDesiredSchema so the physical `dc_<slug>` / `single_<slug>`
 *      tables exist before Phase C inserts any content. Without step 2 the
 *      registry rows say "pending" forever and every subsequent insert
 *      fails with "no such table: dc_<slug>".
 *
 * For code-first projects this is a no-op: schemas are already registered
 * from the user's nextly.config.ts at boot time and the dev-server's
 * auto-sync owns table creation.
 *
 * Idempotency: lookup-then-create on the registry side; applyDesiredSchema
 * is itself idempotent — tables that already exist are diffed to a no-op.
 */

import {
  applyDesiredSchema,
  container,
  type DesiredCollection,
  type DesiredSingle,
  type Nextly,
} from "nextly";

import type { SchemaManifest } from "../schema-manifest";

export interface PhaseAOptions {
  approach: "codefirst" | "visual";
}

export interface PhaseAResult {
  registeredCollections: string[];
  registeredSingles: string[];
  warnings: string[];
}

interface CollectionRegistryLike {
  getCollectionBySlug(slug: string): Promise<unknown | null>;
  registerCollection(meta: Record<string, unknown>): Promise<unknown>;
}

interface SingleRegistryLike {
  getSingleBySlug(slug: string): Promise<unknown | null>;
  registerSingle(meta: Record<string, unknown>): Promise<unknown>;
}

interface UserFieldDefinitionServiceLike {
  exists?(name: string): Promise<boolean>;
  register?(field: {
    name: string;
    type: string;
    maxLength?: number;
  }): Promise<unknown>;
}

export async function runPhaseA(
  nextly: Nextly,
  manifest: SchemaManifest,
  options: PhaseAOptions
): Promise<PhaseAResult> {
  const result: PhaseAResult = {
    registeredCollections: [],
    registeredSingles: [],
    warnings: [],
  };

  if (options.approach === "codefirst") {
    return result;
  }

  // Resolve services from the DI container — `container` is exported
  // directly from `nextly` for cases like this where a
  // template needs an internal service that isn't part of the public
  // Nextly instance API. `nextly.meta` is the high-level surface;
  // schema-registry services are lower-level and only used here.
  // (Confirms availability via getNextly() boot above — the container
  // is populated by the time the seed POST handler runs.)
  void nextly; // initialisation is the side-effect we needed
  const collectionRegistry = container.get<CollectionRegistryLike>(
    "collectionRegistryService"
  );
  const singleRegistry = container.get<SingleRegistryLike>(
    "singleRegistryService"
  );

  // ---- Collections ----
  for (const col of manifest.collections) {
    try {
      const existing = await collectionRegistry.getCollectionBySlug(col.slug);
      if (existing) continue;
      await collectionRegistry.registerCollection({
        slug: col.slug,
        tableName: col.tableName,
        labels: col.labels,
        fields: col.fields,
        source: "ui",
        locked: false,
        // Why: forward the manifest's built-in Draft/Published flag so
        // visual scaffolds register the same status capability that the
        // code-first `defineCollection({ status: true })` would.
        status: col.status === true,
      });
      result.registeredCollections.push(col.slug);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.warnings.push(`collection "${col.slug}": ${msg}`);
    }
  }

  // ---- Singles ----
  for (const single of manifest.singles) {
    try {
      const existing = await singleRegistry.getSingleBySlug(single.slug);
      if (existing) continue;
      await singleRegistry.registerSingle({
        slug: single.slug,
        tableName: single.tableName,
        label: single.label,
        fields: single.fields,
        source: "ui",
        locked: false,
      });
      result.registeredSingles.push(single.slug);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.warnings.push(`single "${single.slug}": ${msg}`);
    }
  }

  // ---- Apply schema: create the physical dc_<slug> / single_<slug> tables ----
  // registerCollection / registerSingle only insert the registry rows
  // (migration_status: "pending"). The visual admin UI ships a separate
  // "apply" click that runs applyDesiredSchema; without that step here, the
  // tables never exist and Phase C's content inserts all 500 with
  // "no such table". Idempotent — already-existing tables diff to a no-op.
  const desiredCollections: Record<string, DesiredCollection> = {};
  for (const col of manifest.collections) {
    const tableName = col.tableName.startsWith("dc_")
      ? col.tableName
      : `dc_${col.tableName}`;
    desiredCollections[col.slug] = {
      slug: col.slug,
      tableName,
      fields: col.fields as DesiredCollection["fields"],
      // Why: feed the built-in Draft/Published flag into the schema
      // pipeline so applyDesiredSchema injects the system `status` column
      // (NOT NULL, default 'draft') alongside user-defined fields.
      status: col.status === true,
    };
  }
  const desiredSingles: Record<string, DesiredSingle> = {};
  for (const single of manifest.singles) {
    const tableName = single.tableName.startsWith("single_")
      ? single.tableName
      : `single_${single.tableName}`;
    desiredSingles[single.slug] = {
      slug: single.slug,
      tableName,
      fields: single.fields as DesiredSingle["fields"],
    };
  }

  try {
    const applyResult = await applyDesiredSchema(
      {
        collections: desiredCollections,
        singles: desiredSingles,
        components: {},
      },
      "ui",
      { promptChannel: "terminal" }
    );
    if (!applyResult.success) {
      result.warnings.push(
        `applyDesiredSchema (${applyResult.error.code}): ${applyResult.error.message}`
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.warnings.push(`applyDesiredSchema: ${msg}`);
  }

  // ---- User-extension fields ----
  // Best-effort: the user-fields service may not expose `exists` /
  // `register` consistently across versions. Skip with a warning if the
  // service isn't available rather than blocking the seed.
  if (manifest.userExtensionFields.length > 0) {
    try {
      const userFields = container.get<UserFieldDefinitionServiceLike>(
        "userFieldDefinitionService"
      );
      // Some Nextly versions register the service without get/register
      // shorthands; we degrade gracefully.
      if (userFields.exists && userFields.register) {
        for (const field of manifest.userExtensionFields) {
          const has = await userFields.exists(field.name).catch(() => false);
          if (has) continue;
          await userFields.register({
            name: field.name,
            type: field.type,
            ...(field.maxLength !== undefined
              ? { maxLength: field.maxLength }
              : {}),
          });
        }
      } else {
        result.warnings.push(
          "userFieldDefinitionService missing exists/register — user-extension fields skipped"
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.warnings.push(`user-extension fields: ${msg}`);
    }
  }

  return result;
}
