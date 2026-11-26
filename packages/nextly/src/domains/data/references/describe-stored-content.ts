/**
 * The description of where a site keeps its content that
 * `rewriteStoredReferences` reads: every collection, Single and field group
 * from its registry, with the table the registry records and the
 * translations table beside it where one is there.
 *
 * Read off any transaction, before the rewrite opens one: the registries and
 * the catalog are read on the pool, which a transaction holding a connection
 * would otherwise wait behind.
 *
 * @module domains/data/references/describe-stored-content
 */

import type { FieldConfig } from "../../../collections/fields/types";
import { storesPerLanguage } from "../../i18n/per-language-storage";
import { localizedFieldRefs } from "../../i18n/runtime/companion-io";

import type { StoredContentSite, StoredEntity } from "./rewrite-stored-references";

/** One registry row, as each of the three registries gives it. */
interface RegistryRecord {
  slug: string;
  tableName: string;
  fields: FieldConfig[];
  localized?: boolean;
}

/** The services the description is read from. */
export interface StoredContentServices {
  collections: { getAllCollections(): Promise<RegistryRecord[]> };
  singles: { getAllSingles(): Promise<RegistryRecord[]> };
  fieldGroups: { getAllComponents(): Promise<RegistryRecord[]> };
  /** Whether the database has the table: the adapter's `tableExists`. */
  tableExists(table: string): Promise<boolean>;
}

/**
 * The entity a registry row describes. Its translatable values are in its
 * translations table where it keeps values per language, has a field to
 * translate, and the table is there; before the translations migration has
 * made it, they are still on the main row, which is read anyway.
 */
async function entityOf(
  record: RegistryRecord,
  tableExists: StoredContentServices["tableExists"]
): Promise<StoredEntity> {
  const entity: StoredEntity = {
    slug: record.slug,
    table: record.tableName,
    fields: record.fields,
  };
  const translationsTable = `${record.tableName}_locales`;
  const translates =
    storesPerLanguage(record) &&
    localizedFieldRefs(record.fields).length > 0 &&
    (await tableExists(translationsTable));
  return translates ? { ...entity, translationsTable } : entity;
}

/** Every collection, Single and field group the site keeps content in. */
export async function describeStoredContent(
  services: StoredContentServices
): Promise<StoredContentSite> {
  const all = async (records: RegistryRecord[]) => {
    const entities: StoredEntity[] = [];
    for (const record of records) {
      entities.push(await entityOf(record, services.tableExists));
    }
    return entities;
  };
  return {
    collections: await all(await services.collections.getAllCollections()),
    singles: await all(await services.singles.getAllSingles()),
    fieldGroups: await all(await services.fieldGroups.getAllComponents()),
  };
}
