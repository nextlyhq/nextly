/**
 * Phase A — Schema seed (visual approach only).
 *
 * Programmatically registers the template's collections, singles, and
 * user-extension fields via the same internal services the visual schema
 * builder admin UI uses. After Phase A completes, permission rows still
 * need to be created for the new resources — Phase B handles that.
 *
 * For code-first projects this is a no-op: schemas are already registered
 * from the user's nextly.config.ts at boot time.
 *
 * Idempotency: lookup-then-create. dynamicCollectionRegistryService
 * throws plain Error on duplicate slug (no error code), so we use
 * collectionExists / getSingle as the gate. See
 * findings/02-phase-0-verifications.md.
 */

import type { Nextly } from "@revnixhq/nextly";

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
  collectionExists(slug: string): Promise<boolean>;
  registerCollection(meta: Record<string, unknown>): Promise<unknown>;
}

interface SingleRegistryLike {
  getSingle(slug: string): Promise<unknown>;
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

  // Resolve services lazily — we tolerate environments where one of
  // them isn't registered (e.g., singles registry name varies). Failures
  // become warnings, not throws, so a partial Phase A doesn't poison
  // the rest of the seed.
  const container = (
    nextly as unknown as {
      container: {
        get: <T>(name: string) => T;
        has?: (name: string) => boolean;
      };
    }
  ).container;

  const collectionRegistry = container.get<CollectionRegistryLike>(
    "dynamicCollectionRegistryService"
  );
  const singleRegistry = container.get<SingleRegistryLike>(
    "dynamicSingleRegistryService"
  );

  // ---- Collections ----
  for (const col of manifest.collections) {
    try {
      const exists = await collectionRegistry.collectionExists(col.slug);
      if (exists) continue;
      await collectionRegistry.registerCollection({
        slug: col.slug,
        tableName: col.tableName,
        labels: col.labels,
        fields: col.fields,
        source: "ui",
        locked: false,
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
      const existing = await singleRegistry
        .getSingle(single.slug)
        .catch(() => null);
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

  // ---- User-extension fields ----
  // Best-effort: the user-fields service may not expose `exists` /
  // `register` consistently across versions. Skip with a warning if the
  // service isn't available rather than blocking the seed.
  if (manifest.userExtensionFields.length > 0) {
    try {
      const userFields = container.get<UserFieldDefinitionServiceLike>(
        "userFieldDefinitionService"
      );
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
