/**
 * A page's details, read from its own fields: the field a content type maps
 * to each detail, or else the first field named like it, each value taken as
 * the kind of fact the detail is (text, a date, a number, a person).
 *
 * Only what the page holds is read, so structured data states nothing the
 * page does not. A relationship holding only an id is read through to the
 * entry it names, since the id is not the fact the page shows.
 *
 * @module structured-data/values
 */
import {
  NextlyError,
  publicAddressOf,
  type PageMetadataImage,
  type PageMetadataInput,
  type PluginContext,
} from "@nextlyhq/plugin-sdk";

import { imageOf } from "../resolver/page-levels";

import { DETAIL_GUESSES, type StructuredDataDetail } from "./catalog";
import type { DetailSource } from "./rules";

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Text with something in it, trimmed; a number as its digits. */
export function textOf(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** A date or a date and time, as ISO 8601; nothing for anything else. */
export function dateOf(value: unknown): string | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  const text = typeof value === "string" ? value.trim() : undefined;
  if (text === undefined || text === "") return undefined;
  // Written as ISO 8601 (`2026-11-10`, `2026-11-10T09:00:00Z`), the form
  // structured data takes; any other spelling is not trusted as a date.
  if (!/^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(text)) {
    return undefined;
  }
  return Number.isNaN(Date.parse(text)) ? undefined : text.replace(" ", "T");
}

/** A finite number, from a number or a number written as text. */
export function numberOf(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  const text = textOf(value);
  if (text === undefined || !/^-?\d+(\.\d+)?$/.test(text)) return undefined;
  return Number(text);
}

/** A field's name as matched: letters and digits only, any case. */
const nameKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The value at a dotted path, such as `event.venue`, in the document. */
function atPath(
  document: Readonly<Record<string, unknown>>,
  path: string
): unknown {
  let value: unknown = document;
  for (const part of path.split(".")) {
    if (!isRecord(value)) return undefined;
    value = value[part];
  }
  return value;
}

/** Whether a value holds anything: not absent, blank or an empty list. */
function present(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === "string"
    ? value.trim() !== ""
    : value !== undefined && value !== null;
}

/**
 * A detail as the page holds it: its value, and where it was read from.
 * `field` is the page's field it came from or would come from; it is absent
 * where nothing is mapped and no field is named like the detail.
 */
export interface DetailRead {
  value: unknown;
  field?: string;
}

/** A detail of the page: the mapped field or fixed value, else a guess. */
export function readDetail(
  document: Readonly<Record<string, unknown>>,
  detail: StructuredDataDetail,
  source: DetailSource | undefined
): DetailRead {
  if (isRecord(source)) return { value: source.value };
  if (typeof source === "string") {
    return { value: atPath(document, source), field: source };
  }
  const fields = new Map(
    Object.keys(document).map(name => [nameKey(name), name])
  );
  // The first field named like the detail that holds something, else the
  // first that exists, so a problem can name the field to fill in.
  let empty: string | undefined;
  for (const guess of DETAIL_GUESSES[detail]) {
    const field = fields.get(nameKey(guess));
    if (field === undefined) continue;
    if (present(document[field])) return { value: document[field], field };
    empty ??= field;
  }
  return empty === undefined
    ? { value: undefined }
    : { value: undefined, field: empty };
}

/** A person or a thing, as structured data names it. */
export interface Named {
  name: string;
  /** Its own public address, where it has one. */
  url?: string;
}

/** The name an entry or a group is known by. */
function nameIn(record: Record<string, unknown>): string | undefined {
  return (
    textOf(record.name) ??
    textOf(record.title) ??
    textOf(record.fullName) ??
    textOf(record.displayName)
  );
}

/**
 * The collection a relationship field points at, where the page's field is
 * one with a single target; nothing for any other field or a Single's.
 */
async function relationTarget(
  ctx: PluginContext,
  input: PageMetadataInput,
  field: string | undefined
): Promise<string | undefined> {
  if (input.source.kind !== "entry" || field === undefined) return undefined;
  if (field.includes(".")) return undefined;
  try {
    const collection: unknown = await ctx.services.collections.getCollection(
      input.source.collection,
      {}
    );
    const fields = isRecord(collection)
      ? atPath(collection, "schemaDefinition.fields")
      : undefined;
    if (!Array.isArray(fields)) return undefined;
    const declared: unknown = fields.find(
      candidate => isRecord(candidate) && candidate.name === field
    );
    if (!isRecord(declared)) return undefined;
    return declared.type === "relationship" &&
      typeof declared.relationTo === "string"
      ? declared.relationTo
      : undefined;
  } catch (error) {
    if (NextlyError.isCode(error, "NOT_FOUND")) return undefined;
    throw error;
  }
}

/** An entry of `collection` with its own public address, where it has one. */
async function namedEntry(
  ctx: PluginContext,
  collection: string,
  entry: Record<string, unknown>,
  locale: string | undefined,
  origin: string
): Promise<Named | undefined> {
  const name = nameIn(entry);
  if (name === undefined) return undefined;
  const address = await publicAddressOf(
    { kind: "collection", slug: collection },
    entry,
    locale
  );
  return address.status === "resolved"
    ? { name, url: new URL(address.path, origin).href }
    : { name };
}

/**
 * The person or thing a detail names: text as the name, a populated entry or
 * group by its name, and an entry a relationship holds only the id of, read.
 * The first of a list where the field holds several.
 */
export async function namedOf(
  ctx: PluginContext,
  input: PageMetadataInput,
  read: DetailRead,
  origin: string
): Promise<Named | undefined> {
  const value: unknown = Array.isArray(read.value) ? read.value[0] : read.value;
  if (isRecord(value)) {
    // A relationship to several collections holds `{ relationTo, value }`.
    const inner = value.value;
    if (typeof value.relationTo === "string" && inner !== undefined) {
      if (isRecord(inner)) {
        return namedEntry(ctx, value.relationTo, inner, input.locale, origin);
      }
      return typeof inner === "string"
        ? entryById(ctx, value.relationTo, inner, input.locale, origin)
        : undefined;
    }
    const name = nameIn(value);
    return name === undefined ? undefined : { name };
  }
  const text = textOf(value);
  if (text === undefined) return undefined;
  const target = await relationTarget(ctx, input, read.field);
  return target === undefined
    ? { name: text }
    : entryById(ctx, target, text, input.locale, origin);
}

/** The entry `id` of `collection`, by its name; nothing where it is gone. */
async function entryById(
  ctx: PluginContext,
  collection: string,
  id: string,
  locale: string | undefined,
  origin: string
): Promise<Named | undefined> {
  let entry: unknown;
  try {
    entry = await ctx.services.collections.findEntryById(collection, id);
  } catch (error) {
    // A removed entry names nobody, so the detail is missing.
    if (NextlyError.isCode(error, "NOT_FOUND")) return undefined;
    throw error;
  }
  return isRecord(entry)
    ? namedEntry(ctx, collection, entry, locale, origin)
    : undefined;
}

/** The image a detail names: a media value read as the share image is. */
export async function pictureOf(
  ctx: PluginContext,
  read: DetailRead
): Promise<PageMetadataImage | undefined> {
  return imageOf(ctx, read.value);
}
