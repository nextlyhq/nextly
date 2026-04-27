// Projects the in-memory registry state into a DesiredSchema snapshot.
// Callers (admin handler, HMR listener) use this to capture "current
// state" then optionally splice in their own overrides before calling
// applyDesiredSchema().
//
// The registry-reading methods (getAllCollectionsRecords etc.) are
// typed minimally here — the helper only needs slug + tableName +
// fields for each kind. The full registry interface is intentionally
// not imported to keep this module testable with stub registries and
// to avoid pulling SchemaRegistry's DI graph into the pipeline module.

import type {
  DesiredCollection,
  DesiredComponent,
  DesiredSchema,
  DesiredSingle,
} from "./types.js";

interface RegistryRecord {
  slug: string;
  tableName: string;
  fields: unknown[];
}

interface RegistryReader {
  getAllCollectionsRecords(): RegistryRecord[] | Promise<RegistryRecord[]>;
  getAllSinglesRecords(): RegistryRecord[] | Promise<RegistryRecord[]>;
  getAllComponentsRecords(): RegistryRecord[] | Promise<RegistryRecord[]>;
}

export interface DesiredSchemaOverrides {
  collections?: Record<string, DesiredCollection>;
  singles?: Record<string, DesiredSingle>;
  components?: Record<string, DesiredComponent>;
}

// Synchronous variant — used in test contexts where the registry is a
// plain in-memory stub. The async variant below is used in production
// where the registry reads from the DB.
export function buildDesiredSchemaFromRegistry(
  registry: RegistryReader,
  overrides?: DesiredSchemaOverrides
): DesiredSchema {
  const collectionsResult = registry.getAllCollectionsRecords();
  const singlesResult = registry.getAllSinglesRecords();
  const componentsResult = registry.getAllComponentsRecords();

  // Reject async results in the sync helper — callers needing async
  // should use buildDesiredSchemaFromRegistryAsync instead.
  if (
    collectionsResult instanceof Promise ||
    singlesResult instanceof Promise ||
    componentsResult instanceof Promise
  ) {
    throw new Error(
      "buildDesiredSchemaFromRegistry: registry returned a Promise. " +
        "Use buildDesiredSchemaFromRegistryAsync for async registries."
    );
  }

  const collections = projectRecords<DesiredCollection>(collectionsResult);
  const singles = projectRecords<DesiredSingle>(singlesResult);
  const components = projectRecords<DesiredComponent>(componentsResult);

  return {
    collections: { ...collections, ...(overrides?.collections ?? {}) },
    singles: { ...singles, ...(overrides?.singles ?? {}) },
    components: { ...components, ...(overrides?.components ?? {}) },
  };
}

// Async variant for production callers reading from a DB-backed registry.
export async function buildDesiredSchemaFromRegistryAsync(
  registry: RegistryReader,
  overrides?: DesiredSchemaOverrides
): Promise<DesiredSchema> {
  const [collectionsResult, singlesResult, componentsResult] =
    await Promise.all([
      registry.getAllCollectionsRecords(),
      registry.getAllSinglesRecords(),
      registry.getAllComponentsRecords(),
    ]);

  const collections = projectRecords<DesiredCollection>(collectionsResult);
  const singles = projectRecords<DesiredSingle>(singlesResult);
  const components = projectRecords<DesiredComponent>(componentsResult);

  return {
    collections: { ...collections, ...(overrides?.collections ?? {}) },
    singles: { ...singles, ...(overrides?.singles ?? {}) },
    components: { ...components, ...(overrides?.components ?? {}) },
  };
}

function projectRecords<
  T extends { slug: string; tableName: string; fields: unknown[] },
>(records: RegistryRecord[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const r of records) {
    out[r.slug] = {
      slug: r.slug,
      tableName: r.tableName,
      fields: r.fields,
    } as T;
  }
  return out;
}
