/**
 * A page's details, read from its own fields: the field a content type maps
 * to each detail, or else the first field named like it, each value taken as
 * the kind of fact the detail is (text, a date, a number, a person).
 *
 * Only what the route read for the page is used, so structured data states
 * nothing the page could not show: a relationship is named only where the
 * route read the entry it holds, never read again here, so the route's own
 * access, language and cache tags govern it as they govern the page.
 *
 * @module structured-data/values
 */
import {
  addressableFields,
  NextlyError,
  type PageMetadataImage,
  type PageMetadataInput,
  type PluginContext,
} from "@nextlyhq/plugin-sdk";

import { addressOf, imageOf } from "../resolver/page-levels";

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
  /** A person's role, where their entry gives one. */
  jobTitle?: string;
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

/** The fields the page's content type declares, or none where it is gone. */
async function declaredFields(
  ctx: PluginContext,
  input: PageMetadataInput
): Promise<unknown> {
  const { source } = input;
  try {
    if (source.kind === "entry") {
      const collection: unknown = await ctx.services.collections.getCollection(
        source.collection,
        {}
      );
      return isRecord(collection)
        ? atPath(collection, "schemaDefinition.fields")
        : undefined;
    }
    const singles = await ctx.services.singles.list({
      slugAllowlist: [source.slug],
    });
    return singles.data.find(single => single.slug === source.slug)?.fields;
  } catch (error) {
    if (NextlyError.isCode(error, "NOT_FOUND")) return undefined;
    throw error;
  }
}

/** A relationship field as declared, and the one collection it targets. */
interface Relation {
  /** The collection it holds entries of, where it targets only one. */
  target?: string;
}

/**
 * The relationship a field at a dotted path is, where it is one: each step
 * read among the fields its level stores, groups' children included.
 */
function relationAt(fields: unknown, path: string): Relation | undefined {
  let level: unknown = fields;
  const parts = path.split(".");
  for (const [at, part] of parts.entries()) {
    const field: unknown = addressableFields(level).find(
      candidate => isRecord(candidate) && candidate.name === part
    );
    if (!isRecord(field)) return undefined;
    if (at < parts.length - 1) {
      level = field.fields;
      continue;
    }
    if (field.type !== "relationship" && field.type !== "upload") {
      return undefined;
    }
    return typeof field.relationTo === "string"
      ? { target: field.relationTo }
      : {};
  }
  return undefined;
}

/** The relationship the page's field holding a detail is, where it is one. */
async function relationOf(
  ctx: PluginContext,
  input: PageMetadataInput,
  field: string | undefined
): Promise<Relation | undefined> {
  if (field === undefined) return undefined;
  return relationAt(await declaredFields(ctx, input), field);
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
  // The entry's address in the page's language, as the page's own canonical
  // is formed: the language's prefix or its own domain included.
  const address = await addressOf(
    ctx,
    { type: { kind: "collection", slug: collection }, key: collection },
    entry,
    locale,
    undefined
  );
  const jobTitle = jobTitleIn(entry);
  return {
    name,
    ...(address === undefined
      ? {}
      : { url: new URL(address, `${origin}/`).href }),
    ...(jobTitle === undefined ? {} : { jobTitle }),
  };
}

/** A person's role, as an author's entry may hold it. */
function jobTitleIn(record: Record<string, unknown>): string | undefined {
  return (
    textOf(record.jobTitle) ?? textOf(record.role) ?? textOf(record.position)
  );
}

/** A detail's value, the first of a list where the field holds several. */
function firstOf(read: DetailRead): unknown {
  return Array.isArray(read.value) ? read.value[0] : read.value;
}

/**
 * The person or thing a detail names: text as the name, and an entry or a
 * group by its name, an entry linked to its own page. A relationship the
 * route read without the entry it holds names nobody: its id is not a name.
 */
export async function namedOf(
  ctx: PluginContext,
  input: PageMetadataInput,
  read: DetailRead,
  origin: string
): Promise<Named | undefined> {
  const value = firstOf(read);
  if (isRecord(value)) {
    // A relationship to several collections holds `{ relationTo, value }`.
    const inner = value.value;
    if (typeof value.relationTo === "string" && inner !== undefined) {
      return isRecord(inner)
        ? namedEntry(ctx, value.relationTo, inner, input.locale, origin)
        : undefined;
    }
    const target = (await relationOf(ctx, input, read.field))?.target;
    if (target !== undefined) {
      return namedEntry(ctx, target, value, input.locale, origin);
    }
    const name = nameIn(value);
    if (name === undefined) return undefined;
    const jobTitle = jobTitleIn(value);
    return jobTitle === undefined ? { name } : { name, jobTitle };
  }
  const text = textOf(value);
  if (text === undefined) return undefined;
  return (await relationOf(ctx, input, read.field)) === undefined
    ? { name: text }
    : undefined;
}

/**
 * Whether a detail is held by a relationship the route read without the
 * entry it names: the page has it, but not in a form that can be stated.
 */
export async function heldUnread(
  ctx: PluginContext,
  input: PageMetadataInput,
  read: DetailRead
): Promise<boolean> {
  const value = firstOf(read);
  const unread =
    typeof value === "string" ||
    typeof value === "number" ||
    (isRecord(value) &&
      typeof value.relationTo === "string" &&
      !isRecord(value.value));
  return (
    unread &&
    String(isRecord(value) ? value.value : value).trim() !== "" &&
    (await relationOf(ctx, input, read.field)) !== undefined
  );
}

/** The image a detail names: a media value read as the share image is. */
export async function pictureOf(
  ctx: PluginContext,
  read: DetailRead
): Promise<PageMetadataImage | undefined> {
  return imageOf(ctx, read.value);
}

/**
 * The names a detail lists, such as a post's tags: text, entries or groups
 * by their name, each once. A relationship read without its entries names
 * nothing, since an id is not a name.
 */
export function namesOf(value: unknown): string[] {
  const each = Array.isArray(value) ? value : [value];
  const names = each.flatMap(item => {
    if (isRecord(item)) {
      const inner = isRecord(item.value) ? item.value : item;
      return nameIn(inner) ?? [];
    }
    return typeof item === "string" ? (textOf(item) ?? []) : [];
  });
  return [...new Set(names)];
}

/**
 * The words of a value as a reader sees them: text as it is, and rich text
 * (a tree of nodes holding `text`) with its words in order. Nothing else.
 */
export function plainTextOf(value: unknown): string {
  const words: string[] = [];
  const walk = (node: unknown, depth: number): void => {
    // Rich text nests a few levels deep; a deeper value is not page text.
    if (depth > 64) return;
    if (typeof node === "string") {
      words.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) walk(child, depth + 1);
      return;
    }
    if (!isRecord(node)) return;
    if (typeof node.text === "string") words.push(node.text);
    if (node.root !== undefined) walk(node.root, depth + 1);
    if (node.children !== undefined) walk(node.children, depth + 1);
  };
  walk(value, 0);
  return words.join(" ").replace(/\s+/g, " ").trim();
}

/** How many words a text has. */
export function wordCountOf(text: string): number {
  return text === "" ? 0 : text.split(" ").length;
}

/** One question a page answers, as its reader sees it. */
export interface Question {
  question: string;
  answer: string;
}

/**
 * The questions and answers a field holds: a list of items, each with its
 * question (`question`, `q`, `name` or `title`) and its answer (`answer`,
 * `a` or `text`, plain or rich text). An item missing either is left out.
 */
export function questionsOf(value: unknown): Question[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!isRecord(item)) return [];
    const question =
      textOf(item.question) ??
      textOf(item.q) ??
      textOf(item.name) ??
      textOf(item.title);
    const answer = plainTextOf(item.answer ?? item.a ?? item.text);
    return question === undefined || answer === ""
      ? []
      : [{ question, answer }];
  });
}
