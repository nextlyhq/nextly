/**
 * Which reported documents, and which of their blocks fields, the person
 * asking may read: read as them, through core's own gate, so the report never
 * shows a row of a field their field rules hide, nor of a document they may
 * not open.
 *
 * One read per collection (a few, for many documents), selecting each
 * document's title and the blocks fields its rows are in: a field the read
 * leaves out is one the caller may not read. Each Single is read on its own.
 *
 * @module bindings-report/readable
 */
import { NextlyError, type PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { requireNextly } from "nextly/runtime";

import { labelOf, pluralLabelOf } from "../collection-labels";
import { titleFieldIn } from "../entries-route";
import { entryOf, findAsCaller } from "../entry-reads";
import { readingAsUser, type IdentifiedCaller } from "../library-route";

import type { BindingReportRow } from "./rows";
import type { StoredDocumentReport } from "./store";

/**
 * Who the report is read as, and the services a collection's naming is read
 * through: a route's request, or a dashboard card's reader.
 */
export type ReadableContext = IdentifiedCaller & {
  readonly services: Pick<PluginRouteContext["services"], "collections">;
};

/** What the caller may read of one reported document. */
export interface ReadableDocument {
  /** The document as they know it: an entry's title, a Single's slug. */
  readonly title: string;
  /** The top-level blocks fields of it they may read. */
  readonly fields: ReadonlySet<string>;
  /** Its collection's name as the admin shows it; a Single's slug. */
  readonly collectionLabel: string;
}

/** How many ids one read asks for. */
const IDS_PER_READ = 200;

/** A row's top-level blocks field: the first segment of its dotted path. */
function topFieldOf(blocksField: string | undefined): string {
  return (blocksField ?? "").split(".")[0] ?? "";
}

/** The blocks fields a document's rows are in. */
function fieldsNamed(entry: StoredDocumentReport): string[] {
  return [
    ...new Set(entry.rows.map(row => topFieldOf(row.blocksField))),
  ].filter(field => field !== "");
}

/** The fields of `fields` a read as the caller returned. */
function present(
  row: Record<string, unknown>,
  fields: readonly string[]
): ReadonlySet<string> {
  return new Set(fields.filter(field => Object.hasOwn(row, field)));
}

/**
 * Where a collection's registry record is read: all {@link collectionNaming}
 * asks of a route's collections service, so any route holding it can ask.
 */
export interface CollectionConfigs {
  getCollection(name: string, context: Record<string, never>): Promise<unknown>;
}

/**
 * A collection's title field and its names, plural and one entry's, from its
 * registry record.
 */
export async function collectionNaming(
  ctx: { readonly services: { readonly collections: CollectionConfigs } },
  slug: string
): Promise<
  | {
      readonly titleField?: string;
      readonly label: string;
      readonly singular: string;
    }
  | undefined
> {
  let record: Record<string, unknown>;
  try {
    record = (await ctx.services.collections.getCollection(
      slug,
      undefined as never
    )) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const titleField = titleFieldIn(record)?.name;
  return {
    ...(titleField === undefined ? {} : { titleField }),
    label: pluralLabelOf(record).pluralLabel ?? labelOf(record, slug),
    singular: labelOf(record, slug),
  };
}

/** One read as the caller of up to `IDS_PER_READ` documents; `null` when refused. */
async function readAsCaller(
  ctx: IdentifiedCaller,
  slug: string,
  ids: readonly string[],
  select: Record<string, boolean>
): Promise<readonly unknown[] | null> {
  try {
    const page = await findAsCaller(ctx, {
      collection: slug,
      where: { id: { in: [...ids] } },
      select,
      limit: ids.length,
    });
    return page.items;
  } catch (error) {
    // A caller refused the whole collection may read none of it.
    if (NextlyError.isForbidden(error)) return null;
    throw error;
  }
}

/** One collection's reported documents, as the caller may read them. */
async function readCollection(
  ctx: ReadableContext,
  slug: string,
  entries: readonly StoredDocumentReport[],
  found: Map<string, ReadableDocument>
): Promise<void> {
  const naming = await collectionNaming(ctx, slug);
  if (naming === undefined) return;
  const { titleField, label } = naming;
  const select = {
    id: true,
    ...(titleField === undefined ? {} : { [titleField]: true }),
    ...Object.fromEntries(
      [...new Set(entries.flatMap(fieldsNamed))].map(field => [field, true])
    ),
  };
  const byId = new Map(entries.map(entry => [entry.documentId ?? "", entry]));
  const ids = [...byId.keys()];
  for (let start = 0; start < ids.length; start += IDS_PER_READ) {
    const rows = await readAsCaller(
      ctx,
      slug,
      ids.slice(start, start + IDS_PER_READ),
      select
    );
    if (rows === null) return;
    for (const row of rows) {
      const entry = entryOf(row, titleField);
      const stored = entry === undefined ? undefined : byId.get(entry.id);
      if (entry === undefined || stored === undefined) continue;
      found.set(stored.documentKey, {
        title: entry.title,
        fields: present(row as Record<string, unknown>, fieldsNamed(stored)),
        collectionLabel: label,
      });
    }
  }
}

/**
 * A Single as the caller reads it: its row, `"refused"` when core's gate
 * refuses them, or `"none"` when it has no row yet. Core judges the read
 * before it looks for the row, so `"none"` is a Single they may read.
 */
async function singleAsCaller(
  ctx: IdentifiedCaller,
  slug: string
): Promise<{ readonly row: unknown } | "refused" | "none"> {
  try {
    return {
      row: await requireNextly().findSingle({
        slug,
        createIfMissing: false,
        depth: 0,
        ...(await readingAsUser(ctx)),
      }),
    };
  } catch (error) {
    if (NextlyError.isForbidden(error)) return "refused";
    if (NextlyError.isNotFound(error)) return "none";
    throw error;
  }
}

/**
 * Which of these Singles the caller may read, each read as them through
 * core's gate: the report names a Single a binding reads by its label only
 * for a reader who may read it, and by the slug the binding holds otherwise.
 * A Single with no row yet is one they may read, and has a label all the same.
 */
export async function readableSingles(
  ctx: IdentifiedCaller,
  slugs: ReadonlySet<string>
): Promise<ReadonlySet<string>> {
  const readable = new Set<string>();
  for (const slug of slugs) {
    if ((await singleAsCaller(ctx, slug)) !== "refused") readable.add(slug);
  }
  return readable;
}

/** One reported Single, as the caller may read it. */
async function readSingle(
  ctx: IdentifiedCaller,
  entry: StoredDocumentReport,
  found: Map<string, ReadableDocument>
): Promise<void> {
  const read = await singleAsCaller(ctx, entry.slug);
  if (typeof read !== "object") return;
  const { row } = read;
  if (typeof row !== "object" || row === null) return;
  found.set(entry.documentKey, {
    title: entry.slug,
    fields: present(row as Record<string, unknown>, fieldsNamed(entry)),
    collectionLabel: entry.slug,
  });
}

/** Each reported document the caller may read, by its key. */
export async function readableAsCaller(
  ctx: ReadableContext,
  entries: readonly StoredDocumentReport[]
): Promise<ReadonlyMap<string, ReadableDocument>> {
  const found = new Map<string, ReadableDocument>();
  const bySlug = new Map<string, StoredDocumentReport[]>();
  for (const entry of entries) {
    if (entry.kind === "single") {
      await readSingle(ctx, entry, found);
      continue;
    }
    const list = bySlug.get(entry.slug) ?? [];
    list.push(entry);
    bySlug.set(entry.slug, list);
  }
  for (const [slug, list] of bySlug) {
    await readCollection(ctx, slug, list, found);
  }
  return found;
}

/** A document's rows in the blocks fields the caller may read. */
export function readableRows(
  entry: StoredDocumentReport,
  readable: ReadableDocument | undefined
): readonly BindingReportRow[] {
  if (readable === undefined) return [];
  return entry.rows.filter(row =>
    readable.fields.has(topFieldOf(row.blocksField))
  );
}

/** How many broken bindings of the report the caller may see. */
export async function visibleBindings(
  ctx: ReadableContext,
  stored: readonly StoredDocumentReport[]
): Promise<number> {
  const readable = await readableAsCaller(ctx, stored);
  return stored.reduce(
    (sum, entry) =>
      sum + readableRows(entry, readable.get(entry.documentKey)).length,
    0
  );
}
