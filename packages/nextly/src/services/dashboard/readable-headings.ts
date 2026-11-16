/**
 * What the dashboard calls each document a row names, read as the reader reads
 * it now: the title, the collection's or Single's icon, its status and when it
 * was last updated.
 *
 * 🔴 The one place a dashboard row's title for a named document comes from.
 * Pins and Continue where you left off both name documents the reader chose
 * or saved earlier, and a title read once and kept (a pin's, the activity
 * trail's stored heading) may be one the reader can no longer read, or a
 * field a rule now withholds from them. So the heading is read through the
 * ordinary read path as the reader, at the moment of showing it: a document
 * they may not read now, or one that is gone, has no heading, and the row
 * naming it is left out rather than drawn with a placeholder.
 *
 * @module services/dashboard/readable-headings
 */

import {
  readAccessCaller,
  readableEntities,
} from "../../auth/entity-read-access";
import { container } from "../../di/container";
import { COMMON_TITLE_FIELDS } from "../../domains/collections/entry-title";
import { NextlyError } from "../../errors/nextly-error";
import { entryHeading } from "../../lib/entry-heading";
import {
  readableDocumentColumns,
  readableSingleColumns,
} from "../lib/readable-documents";

import type { ReadCaller } from "./readable-resources";

/** The title of a readable document whose title field holds nothing: never its id. */
const UNTITLED = "Untitled";

/**
 * A document a row names: an entry of a collection, or a Single (`entryId` ""),
 * in the language it is read in: `locale`, or the default language when it
 * names none (`null` or absent).
 */
export interface DocumentRef {
  kind: "collection" | "single";
  slug: string;
  entryId: string;
  locale?: string | null;
}

/** A document's heading, as the reader reads it now. */
export interface DocumentHeading {
  /** The entry's title from its title field ("Untitled" without one), or the Single's label. */
  title: string;
  /** The collection's or Single's icon name, when it names one. */
  icon?: string;
  /** Its status, for a collection or Single with a draft and published lifecycle. */
  status?: string;
  /** When the document was last updated, as an ISO instant. */
  updatedAt?: string;
}

/** The registries a heading reads the title field, the label and the icon from. */
export interface HeadingRegistries {
  getCollectionBySlug(slug: string): Promise<{
    status?: unknown;
    admin?: { useAsTitle?: string; icon?: string } | null;
  } | null>;
  getSingleBySlug(slug: string): Promise<{
    label: string;
    admin?: { icon?: string } | null;
  } | null>;
}

/**
 * The key a document's heading is filed under: the document and the language
 * it was read in, so one document read in two languages has two headings, each
 * its own language's title, status and update time.
 */
export function headingKey(ref: DocumentRef): string {
  return JSON.stringify([
    ref.kind,
    ref.slug,
    ref.kind === "single" ? "" : ref.entryId,
    ref.locale ?? null,
  ]);
}

/** `value` when it is a non-empty string. */
function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** An instant as an ISO string, from the Date or string a driver returns. */
function instant(value: unknown): string | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  return text(value);
}

/** The status and the update time a read document carries, each when present. */
function stateOf(
  row: Record<string, unknown> | null
): Pick<DocumentHeading, "status" | "updatedAt"> {
  const status = text(row?.status);
  const updatedAt = instant(row?.updatedAt);
  return {
    ...(status === undefined ? {} : { status }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
  };
}

/** Whether a read failed because the reader may not read it, which shows nothing. */
function refused(error: unknown): boolean {
  return NextlyError.isForbidden(error) || NextlyError.isNotFound(error);
}

/**
 * The headings of the entries among `ids` the reader may read in `slug`, in
 * `locale`: one read, as the reader, of every one of them. None when the
 * collection is gone or the read refuses outright; any other failure is a real
 * one and is thrown.
 */
async function collectionHeadings(
  { slug, locale, ids }: EntryGroup,
  caller: ReadCaller,
  registries: HeadingRegistries
): Promise<Map<string, DocumentHeading>> {
  const collection = await registries.getCollectionBySlug(slug);
  if (collection === null) return new Map();
  const titleField = collection.admin?.useAsTitle ?? "title";
  const icon = text(collection.admin?.icon);
  let documents: Map<string, Record<string, unknown>>;
  try {
    documents = await readableDocumentColumns(
      slug,
      ids,
      caller,
      [
        titleField,
        ...COMMON_TITLE_FIELDS,
        // Asked only of a collection that has one: the read refuses a field
        // the collection does not have.
        ...(collection.status === true ? ["status"] : []),
      ],
      locale
    );
  } catch (error) {
    if (refused(error)) return new Map();
    throw error;
  }
  return new Map(
    [...documents].map(([id, row]) => [
      id,
      {
        title: entryHeading(row, titleField, UNTITLED),
        ...(icon === undefined ? {} : { icon }),
        ...stateOf(row),
      },
    ])
  );
}

/**
 * A Single's heading, its label, when the reader may read it and it still
 * exists; its status and update time from its document read as the reader, in
 * `locale`.
 */
async function singleHeading(
  { slug, locale }: SingleGroup,
  caller: ReadCaller,
  registries: HeadingRegistries
): Promise<DocumentHeading | undefined> {
  const single = await registries.getSingleBySlug(slug);
  if (single === null) return undefined;
  let document: Record<string, unknown> | null;
  try {
    document = await readableSingleColumns(slug, caller, ["status"], locale);
  } catch (error) {
    if (refused(error)) return undefined;
    throw error;
  }
  const icon = text(single.admin?.icon);
  return {
    title: single.label,
    ...(icon === undefined ? {} : { icon }),
    ...stateOf(document),
  };
}

/** One collection's entries read in one language, by one read. */
interface EntryGroup {
  slug: string;
  locale: string | null;
  ids: string[];
}

/** One Single read in one language. */
interface SingleGroup {
  slug: string;
  locale: string | null;
}

/**
 * `refs` grouped for reading: each collection's entry ids per language, and
 * each Single per language, so every (document, language) is read once and a
 * read names one language.
 */
function grouped(refs: readonly DocumentRef[]): {
  entries: EntryGroup[];
  singles: SingleGroup[];
} {
  const entries = new Map<string, EntryGroup>();
  const singles = new Map<string, SingleGroup>();
  for (const ref of refs) {
    const locale = ref.locale ?? null;
    const key = JSON.stringify([ref.slug, locale]);
    if (ref.kind === "single") {
      singles.set(key, { slug: ref.slug, locale });
      continue;
    }
    const group = entries.get(key) ?? { slug: ref.slug, locale, ids: [] };
    if (!group.ids.includes(ref.entryId)) group.ids.push(ref.entryId);
    entries.set(key, group);
  }
  return { entries: [...entries.values()], singles: [...singles.values()] };
}

/**
 * The heading of each of `refs` the reader may read now, by {@link headingKey}.
 * A document absent from the answer is one they may not read, or one that is
 * gone: its row is left out, never titled from anything else.
 *
 * One entity check for every collection and Single named, then one read per
 * collection and language for all its entries in it at once, and one per
 * Single and language, all as the reader.
 */
export async function readableHeadings(
  refs: readonly DocumentRef[],
  caller: ReadCaller,
  registries: HeadingRegistries
): Promise<Map<string, DocumentHeading>> {
  const headings = new Map<string, DocumentHeading>();
  if (refs.length === 0) return headings;
  const readable = await readableEntities(
    [...new Set(refs.map(ref => ref.slug))],
    readAccessCaller(caller)
  );
  const { entries, singles } = grouped(
    refs.filter(ref => readable.has(ref.slug))
  );
  await Promise.all([
    ...entries.map(async group => {
      const found = await collectionHeadings(group, caller, registries);
      for (const [entryId, heading] of found) {
        headings.set(
          headingKey({
            kind: "collection",
            slug: group.slug,
            entryId,
            locale: group.locale,
          }),
          heading
        );
      }
    }),
    ...singles.map(async group => {
      const heading = await singleHeading(group, caller, registries);
      if (heading !== undefined) {
        headings.set(
          headingKey({
            kind: "single",
            slug: group.slug,
            entryId: "",
            locale: group.locale,
          }),
          heading
        );
      }
    }),
  ]);
  return headings;
}

/**
 * The booted instance's registries, as every dashboard reader of headings
 * takes them, so pins and Continue name a document from the same records.
 */
export function bootedHeadingRegistries(): HeadingRegistries {
  const collections = container.get<
    Pick<HeadingRegistries, "getCollectionBySlug">
  >("collectionRegistryService");
  const singles = container.get<Pick<HeadingRegistries, "getSingleBySlug">>(
    "singleRegistryService"
  );
  return {
    getCollectionBySlug: slug => collections.getCollectionBySlug(slug),
    getSingleBySlug: slug => singles.getSingleBySlug(slug),
  };
}
