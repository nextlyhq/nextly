// What: the template address a promoted collection's entries are served at, read from the page
// builder's templates, and the line that declares it in code.
// Why: a collection made in the Schema Builder stores its template address on its template. Once
// promoted, it is a collection defined in code, whose address is declared in code; printing that
// declaration beside the collection's code keeps its entries at the address they are served at.
// The stored address keeps serving them until the declaration takes over at the next start.

import { sql, type SQL } from "drizzle-orm";

import { COMPANION_PARENT_COLUMN } from "../../domains/i18n/companion-columns";
import { mainTableFields } from "../../domains/i18n/per-language-storage";
import type { DynamicCollectionRecord } from "../../schemas/dynamic-collections";
import { STORAGE_FORMAT } from "../../schemas/storage-format";

/** The page builder's package, as its collections' registry source names it. */
const PAGE_BUILDER_SOURCE = "plugin:@nextlyhq/plugin-page-builder";

/** The page builder's templates collection, as the plugin names it before any rename. */
const TEMPLATES_COLLECTION = "templates";

/** The template fields read: the collection a template draws, and its stored address. */
const COLLECTION_COLUMN = "collection";
const ADDRESS_COLUMN = "address";

/** What the read needs: the registry's records, and a Drizzle statement run. */
export interface TemplateAddressReadDeps {
  getAllCollections(): Promise<DynamicCollectionRecord[]>;
  queryStatement(statement: SQL): Promise<Record<string, unknown>[]>;
}

/**
 * The address `collection`'s template stores, or null when it has none, the site has no page
 * builder templates, or they cannot be read. Never throws: the printout is a convenience beside the
 * promote, which goes ahead without it.
 */
export async function storedTemplateAddress(
  deps: TemplateAddressReadDeps,
  collection: string
): Promise<string | null> {
  try {
    const record = templatesRecord(await deps.getAllCollections());
    // No page builder, or templates that predate stored addresses: nothing
    // to read.
    if (!record?.tableName) return null;
    const rows = await deps.queryStatement(
      addressStatement(record, record.tableName, collection)
    );
    const address = rows.find(
      row => typeof row.address === "string" && row.address !== ""
    )?.address;
    return typeof address === "string" ? address : null;
  } catch {
    return null;
  }
}

/**
 * The read of the address `collection`'s template stores, from the table each of the two fields
 * is kept in: the templates' own table, or for a field whose values are kept per language, its
 * per-language table, whose rows each name the template they belong to. Every language's row is
 * read, and the first address found is the one printed.
 */
function addressStatement(
  record: DynamicCollectionRecord,
  tableName: string,
  collection: string
): SQL {
  const onMain = new Set(
    mainTableFields(
      record as { localized?: unknown },
      (record.fields ?? []) as { name?: string; type: string }[]
    ).map(field => field.name)
  );
  const main = sql.identifier("m");
  const languages = sql.identifier("l");
  const column = (name: string): SQL =>
    sql`${onMain.has(name) ? main : languages}.${sql.identifier(name)}`;
  const from =
    onMain.has(ADDRESS_COLUMN) && onMain.has(COLLECTION_COLUMN)
      ? sql`${sql.identifier(tableName)} ${main}`
      : sql`${sql.identifier(tableName)} ${main} JOIN ${sql.identifier(
          `${tableName}${STORAGE_FORMAT.companionSuffix}`
        )} ${languages} ON ${languages}.${sql.identifier(COMPANION_PARENT_COLUMN)} = ${main}.${sql.identifier("id")}`;
  return sql`SELECT ${column(ADDRESS_COLUMN)} AS ${sql.identifier(ADDRESS_COLUMN)} FROM ${from} WHERE ${column(COLLECTION_COLUMN)} = ${collection}`;
}

/**
 * The page builder's templates collection among the registry's records,
 * found by what it is rather than by its slug, which a site may rename: the
 * page builder's collection holding both a template's collection and its
 * address.
 */
function templatesRecord(
  records: readonly DynamicCollectionRecord[]
): DynamicCollectionRecord | undefined {
  const holdsAddresses = (record: DynamicCollectionRecord) => {
    const fields = (record.fields ?? []) as { name?: unknown }[];
    const names = new Set(fields.map(field => field.name));
    return names.has(COLLECTION_COLUMN) && names.has(ADDRESS_COLUMN);
  };
  // By the page builder's provenance first; a registry recording its
  // collections as code is read under the slug the plugin gives them.
  return (
    records.find(
      record => record.source === PAGE_BUILDER_SOURCE && holdsAddresses(record)
    ) ??
    records.find(
      record => record.slug === TEMPLATES_COLLECTION && holdsAddresses(record)
    )
  );
}

/**
 * The `pageBuilder()` option declaring `collection`'s template address in code: the line printed
 * beside its promoted code.
 */
export function templateAddressDeclaration(
  collection: string,
  address: string
): string {
  const key = /^[A-Za-z_$][\w$]*$/.test(collection)
    ? collection
    : JSON.stringify(collection);
  return `pageBuilder({ templates: { addresses: { ${key}: ${JSON.stringify(address)} } } })`;
}

/**
 * The lines that go with the collection's code when its template stores an address: what to
 * declare, and that the stored address serves until then.
 */
export function templateAddressNote(
  collection: string,
  address: string
): string[] {
  return [
    `Its entries are served at ${address}, the address its template stores. Declare it in code,`,
    "so they stay there once the collection is defined in code:",
    `  ${templateAddressDeclaration(collection, address)}`,
    "The stored address keeps serving them until the declared one takes over at the next start.",
  ];
}
