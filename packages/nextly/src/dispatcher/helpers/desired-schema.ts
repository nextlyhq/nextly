/**
 * Build a complete DesiredSchema that includes ALL currently-registered
 * collections, singles, and components.
 *
 * Why this helper exists:
 * drizzle-kit's pushSchema introspects the live DB and diffs it against the
 * desired schema we supply. Any managed table present in the live DB but
 * absent from the desired schema is treated as "to be dropped", which causes
 * drizzle-kit's tablesResolver to offer it as a rename candidate for new
 * tables. Without this helper every dispatcher that called the pipeline with
 * only its own entity type populated triggered false-positive rename prompts:
 *   - collection save → singles in live DB offered as rename sources
 *   - single save    → collections in live DB offered as rename sources
 *
 * The callers override the one entry they are actually saving; this helper
 * pre-populates the rest so the schema handed to drizzle-kit is complete.
 */

import type {
  DesiredCollection,
  DesiredComponent,
  DesiredSchema,
  DesiredSingle,
} from "../../domains/schema/pipeline/types";
import {
  getCollectionRegistryFromDI,
  getComponentRegistryFromDI,
  getSingleRegistryFromDI,
} from "./di";

export async function buildFullDesiredSchema(): Promise<DesiredSchema> {
  const desired: DesiredSchema = {
    collections: {},
    singles: {},
    components: {},
  };

  const collectionRegistry = getCollectionRegistryFromDI();
  if (collectionRegistry) {
    try {
      const all = await collectionRegistry.getAllCollections();
      for (const c of all) {
        if (!c.slug || !c.tableName) continue;
        desired.collections[c.slug] = {
          slug: c.slug,
          tableName: c.tableName,
          fields: (c.fields ?? []) as DesiredCollection["fields"],
        };
      }
    } catch {
      // Non-fatal: worst case the pipeline sees fewer known tables.
    }
  }

  const singleRegistry = getSingleRegistryFromDI();
  if (singleRegistry) {
    try {
      const all = await singleRegistry.getAllSingles();
      for (const s of all) {
        if (!s.slug || !s.tableName) continue;
        desired.singles[s.slug] = {
          slug: s.slug,
          tableName: s.tableName,
          fields: (s.fields ?? []) as DesiredSingle["fields"],
        };
      }
    } catch {
      // Non-fatal.
    }
  }

  const componentRegistry = getComponentRegistryFromDI();
  if (componentRegistry) {
    try {
      const all = await componentRegistry.getAllComponents();
      for (const c of all) {
        if (!c.slug || !c.tableName) continue;
        desired.components[c.slug] = {
          slug: c.slug,
          tableName: c.tableName,
          fields: (c.fields ?? []) as DesiredComponent["fields"],
        };
      }
    } catch {
      // Non-fatal.
    }
  }

  return desired;
}
