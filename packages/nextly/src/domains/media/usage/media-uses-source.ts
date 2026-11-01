/**
 * The booted instance's answer to "where is this item used", for one reader:
 * the usage record read on the adapter, the entries' and Singles' headings
 * read as the reader through the dashboard's one heading path, and the email
 * templates' names given to a holder of `read-email-templates`.
 *
 * @module domains/media/usage/media-uses-source
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import {
  callerHoldsPermission,
  readAccessCaller,
} from "../../../auth/entity-read-access";
import { container } from "../../../di/container";
import { NextlyError } from "../../../errors/nextly-error";
import {
  bootedHeadingRegistries,
  headingKey,
  readableHeadings,
  type DocumentRef,
} from "../../../services/dashboard/readable-headings";
import type { ReadCaller } from "../../../services/dashboard/readable-resources";
import {
  readableDocumentColumns,
  readableSingleColumns,
} from "../../../services/lib/readable-documents";
import { configuredLocales } from "../../i18n/configured-locales";

import { keptAddresses } from "./address-uses";
import { listIdentifiedMediaUsage } from "./media-usage-store";
import {
  mediaUseReadKey,
  type MediaUseDocument,
  type MediaUseHeading,
  type MediaUseRead,
  type MediaUsesSource,
} from "./media-uses";

/** What a template is filed under among the record's subjects. */
const TEMPLATES_OWNER = "Email templates";

/**
 * The registry a collection's or Single's display name, and the names of its
 * fields now, are read from.
 */
interface OwnerRegistries {
  getCollectionBySlug(slug: string): Promise<{
    labels?: { plural?: string; singular?: string };
    fields?: readonly unknown[];
  } | null>;
  getSingleBySlug(
    slug: string
  ): Promise<{ label?: string; fields?: readonly unknown[] } | null>;
}

/** The name a collection or Single is shown under, or its slug. */
async function ownerOf(
  document: MediaUseDocument,
  registries: OwnerRegistries
): Promise<string> {
  if (document.kind === "single") {
    const single = await registries.getSingleBySlug(document.slug);
    return single?.label || document.slug;
  }
  const collection = await registries.getCollectionBySlug(document.slug);
  return collection?.labels?.plural || document.slug;
}

/**
 * The names of the templates among `ids`, for a reader who may read
 * templates; none for one who may not.
 */
async function templateHeadings(
  adapter: DrizzleAdapter,
  reads: readonly MediaUseRead[],
  caller: ReadCaller
): Promise<Map<string, MediaUseHeading>> {
  const ids = reads.map(read => read.documentId);
  const headings = new Map<string, MediaUseHeading>();
  if (ids.length === 0) return headings;
  if (
    !(await callerHoldsPermission(
      "read-email-templates",
      readAccessCaller(caller)
    ))
  ) {
    return headings;
  }
  // In runs the adapter's statement limit allows, each id binding one value,
  // so an item many templates use is still named rather than refused.
  const run = Math.max(1, adapter.getCapabilities().maxParamsPerQuery);
  const rows: Array<Record<string, unknown>> = [];
  for (let start = 0; start < ids.length; start += run) {
    rows.push(
      ...(await adapter.select<Record<string, unknown>>("email_templates", {
        columns: ["id", "name"],
        where: {
          and: [
            { column: "id", op: "IN", value: ids.slice(start, start + run) },
          ],
        },
      }))
    );
  }
  for (const row of rows) {
    const id = typeof row.id === "string" ? row.id : String(row.id);
    const name = typeof row.name === "string" && row.name ? row.name : id;
    headings.set(
      mediaUseReadKey({
        kind: "email-template",
        slug: "",
        documentId: id,
        locale: null,
      }),
      // A template has no field rules: the grant reads all of it.
      {
        title: name,
        owner: TEMPLATES_OWNER,
        paths: new Set(reads.find(read => read.documentId === id)?.paths ?? []),
      }
    );
  }
  return headings;
}

/** `read()`, asked once per key. */
function memoized<T>(
  cache: Map<string, Promise<T>>,
  key: string,
  read: () => Promise<T>
): Promise<T> {
  const found = cache.get(key);
  if (found) return found;
  const pending = read();
  cache.set(key, pending);
  return pending;
}

/** A collection entry or a Single: a document the read path judges. */
function isContentRead(
  read: MediaUseRead
): read is MediaUseRead & { kind: DocumentRef["kind"] } {
  return read.kind !== "email-template";
}

/**
 * The headings of `refs`, all in one language, as the reader may read them.
 * A language the read path refuses as a request (one no longer active, say)
 * is one the reader is told nothing in, rather than a failure of the whole
 * answer; any other failure is a real one and is thrown.
 */
async function headingsInOneLanguage(
  refs: readonly DocumentRef[],
  caller: ReadCaller
): Promise<Map<string, { title: string }>> {
  try {
    return await readableHeadings(refs, caller, bootedHeadingRegistries());
  } catch (error) {
    if (NextlyError.isValidation(error)) return new Map();
    throw error;
  }
}

/**
 * The headings of the entries and Singles among `reads`, each read as the
 * reader in its own language, by {@link headingKey}.
 */
async function contentHeadings(
  reads: ReadonlyArray<MediaUseRead & { kind: DocumentRef["kind"] }>,
  caller: ReadCaller
): Promise<Map<string, { title: string }>> {
  const byLanguage = new Map<string | null, DocumentRef[]>();
  for (const read of reads) {
    const refs = byLanguage.get(read.locale) ?? [];
    refs.push({
      kind: read.kind,
      slug: read.slug,
      entryId: read.documentId,
      locale: read.locale,
    });
    byLanguage.set(read.locale, refs);
  }
  const answers = await Promise.all(
    [...byLanguage.values()].map(refs => headingsInOneLanguage(refs, caller))
  );
  return new Map(answers.flatMap(answer => [...answer]));
}

/** The names of a collection's or Single's fields now. */
function fieldNames(
  record: { fields?: readonly unknown[] } | null
): Set<string> {
  const names = new Set<string>();
  for (const field of record?.fields ?? []) {
    const name = (field as { name?: unknown } | null)?.name;
    if (typeof name === "string" && name !== "") names.add(name);
  }
  return names;
}

/**
 * Whether a document as read holds a value at `path` (`hero.image`), through
 * groups, field groups and each row of a repeater: a field a read rule
 * withholds is removed from what the read returns, so it holds none.
 */
function holdsPath(value: unknown, path: readonly string[]): boolean {
  if (path.length === 0) return value !== undefined;
  if (Array.isArray(value)) return value.some(item => holdsPath(item, path));
  if (typeof value !== "object" || value === null) return false;
  const [name, ...rest] = path;
  return (
    Object.prototype.hasOwnProperty.call(value, name) &&
    holdsPath((value as Record<string, unknown>)[name], rest)
  );
}

/** A read the read path refuses as a request, or the reader may not make. */
function readRefused(error: unknown): boolean {
  return (
    NextlyError.isValidation(error) ||
    NextlyError.isForbidden(error) ||
    NextlyError.isNotFound(error)
  );
}

/**
 * The documents of one collection or Single in one language, as the reader
 * reads them, with the fields `columns` names: the ordinary read, so each
 * field read access withholds from them is gone from what it returns. None
 * when the read is refused.
 */
async function documentsAsRead(
  kind: DocumentRef["kind"],
  slug: string,
  ids: readonly string[],
  columns: readonly string[],
  caller: ReadCaller,
  locale: string | null
): Promise<Map<string, Record<string, unknown>>> {
  try {
    if (kind === "collection") {
      return await readableDocumentColumns(slug, ids, caller, columns, locale);
    }
    const single = await readableSingleColumns(slug, caller, columns, locale);
    return new Map(single ? [["", single]] : []);
  } catch (error) {
    if (readRefused(error)) return new Map();
    throw error;
  }
}

/**
 * The fields among each read's `paths` the reader may read, by
 * {@link mediaUseReadKey}: each collection's (or Single's) documents read in
 * each language as the reader, with the fields the record names that the
 * collection still has, and a path told only where the read still holds a
 * value at it. The field read access the ordinary read applies is the one
 * that decides, so a field it withholds is never named here.
 */
async function readableFields(
  reads: ReadonlyArray<MediaUseRead & { kind: DocumentRef["kind"] }>,
  caller: ReadCaller,
  registries: OwnerRegistries
): Promise<Map<string, Set<string>>> {
  const groups = new Map<string, Array<(typeof reads)[number]>>();
  for (const read of reads) {
    const key = JSON.stringify([read.kind, read.slug, read.locale]);
    groups.set(key, [...(groups.get(key) ?? []), read]);
  }
  const answers = await Promise.all(
    [...groups.values()].map(async group => {
      const { kind, slug, locale } = group[0];
      const has = fieldNames(
        kind === "collection"
          ? await registries.getCollectionBySlug(slug)
          : await registries.getSingleBySlug(slug)
      );
      const columns = [
        ...new Set(group.flatMap(read => read.paths.map(p => p.split(".")[0]))),
      ].filter(name => has.has(name));
      // No field the record names is still there: none to tell.
      if (columns.length === 0) {
        return group.map((read): [string, Set<string>] => [
          mediaUseReadKey(read),
          new Set(),
        ]);
      }
      const documents = await documentsAsRead(
        kind,
        slug,
        [...new Set(group.map(read => read.documentId))],
        columns,
        caller,
        locale
      );
      return group.map((read): [string, Set<string>] => {
        const document = documents.get(read.documentId);
        return [
          mediaUseReadKey(read),
          new Set(
            document
              ? read.paths.filter(path => holdsPath(document, path.split(".")))
              : []
          ),
        ];
      });
    })
  );
  return new Map(answers.flat());
}

/** The usage of items, as `caller` may be told it, on this instance. */
export function bootedMediaUsesSource(
  adapter: DrizzleAdapter,
  caller: ReadCaller
): MediaUsesSource {
  return {
    rows: mediaId => listIdentifiedMediaUsage(adapter, mediaId),
    keptAddresses: mediaId => keptAddresses(adapter, mediaId),
    // The configured languages as they are now; none where the site has no
    // localization or its languages cannot be read, which tells no language.
    languages: () => Promise.resolve([...(configuredLocales() ?? [])]),
    headings: async reads => {
      const content = reads.filter(isContentRead);
      const templates = reads.filter(read => read.kind === "email-template");
      const owners: OwnerRegistries = {
        getCollectionBySlug: slug =>
          container
            .get<OwnerRegistries>("collectionRegistryService")
            .getCollectionBySlug(slug),
        getSingleBySlug: slug =>
          container
            .get<OwnerRegistries>("singleRegistryService")
            .getSingleBySlug(slug),
      };
      const [read, fields, named] = await Promise.all([
        contentHeadings(content, caller),
        readableFields(content, caller, owners),
        templateHeadings(adapter, templates, caller),
      ]);
      // Each collection's or Single's name is read once, however many of its
      // documents use the item.
      const ownerNames = new Map<string, Promise<string>>();
      for (const document of content) {
        const heading = read.get(
          headingKey({
            kind: document.kind,
            slug: document.slug,
            entryId: document.documentId,
            locale: document.locale,
          })
        );
        if (!heading) continue;
        named.set(mediaUseReadKey(document), {
          paths: fields.get(mediaUseReadKey(document)) ?? new Set(),
          title: heading.title,
          owner: await memoized(
            ownerNames,
            `${document.kind} ${document.slug}`,
            () => ownerOf(document, owners)
          ),
        });
      }
      return named;
    },
  };
}
