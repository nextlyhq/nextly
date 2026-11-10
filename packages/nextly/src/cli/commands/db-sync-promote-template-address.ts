// What: the template address a promoted collection's entries are served at, read from the page
// builder's templates, and the line that declares it in code.
// Why: a collection made in the Schema Builder stores its template address on its template. Once
// promoted, it is a collection defined in code, whose address is declared in code; printing that
// declaration beside the collection's code keeps its entries at the address they are served at.
// The stored address keeps serving them until the declaration takes over at the next start.

import { sql, type SQL } from "drizzle-orm";

import type { DynamicCollectionRecord } from "../../schemas/dynamic-collections";

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
      sql`SELECT ${sql.identifier(ADDRESS_COLUMN)} FROM ${sql.identifier(record.tableName)} WHERE ${sql.identifier(COLLECTION_COLUMN)} = ${collection}`
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
