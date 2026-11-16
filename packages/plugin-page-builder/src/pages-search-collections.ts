/**
 * Which collections hold pages, and what the search knows about each: its
 * Page Builder field, its title and slug fields, its write limits, its
 * template fields, and whether its schema is live.
 *
 * Part of the pages search. `pages-search-route.ts` is the entry, and its
 * header explains what the search reads, who decides access, and paging.
 *
 * @module pages-search-collections
 */
import type { DocumentKind } from "@nextlyhq/blocks-engine";
import { resolvedCollectionView } from "@nextlyhq/plugin-sdk";
import { previewUrlFromTemplate } from "nextly/config";

import { labelOf, pluralLabelOf } from "./collection-labels";
import { titleFieldIn, type TitleField } from "./entries-route";
import { acceptedKinds, acceptsKind } from "./fields/blocks-options";
import { editorBlocksFields } from "./nested-blocks-fields";

/**
 * One collection that holds pages, with what each of its items needs and what
 * a new page of it is made with.
 */
export interface PageCollection {
  readonly slug: string;
  readonly label: string;
  /** The plural name the registry holds, when it holds one. */
  readonly pluralLabel?: string;
  /**
   * The Page Builder field the editor opens for, by its form path: the first
   * one the editor reaches that accepts page documents.
   */
  readonly field: string;
  /** The field that names its entries, or `undefined` for none. */
  readonly title?: TitleField;
  /** Whether it has the Draft/Published lifecycle, and so a status column. */
  readonly lifecycle: boolean;
  /**
   * The document kinds that field declares, or `undefined` where it declares
   * none: what the field's own empty document is made from.
   */
  readonly kinds?: readonly DocumentKind[];
  /**
   * The top-level text field named `slug`, where the collection has one, and
   * whether its values must be unique.
   */
  readonly slugField?: { readonly name: string; readonly unique: boolean };
  /**
   * Where this collection's pages are served, as the host stated it
   * (`pagePreviewPath`, such as `/{slug}`), for the plugin's own Pages only.
   * Each item's `path` is resolved from it here, on the server, by the same
   * interpolation the collection's preview uses. Absent for any other
   * collection, whose address is the host's own code.
   */
  readonly pathTemplate?: string;
  /**
   * The fields `pathTemplate` reads, each a top-level field the collection
   * declares, so a row is read with every value its address is made from
   * (`/{noHeaderFooter}/{slug}` needs both). Present with `pathTemplate`.
   */
  readonly pathFields?: readonly string[];
  /**
   * Required top-level fields a new page would leave empty: not the title, the
   * slug, the Page Builder field or the status, and with no default. Where any
   * exist, a page cannot be made from a title alone.
   */
  readonly needsMore?: readonly string[];
  /**
   * Whether another top-level field must be unique. A copy carries its value
   * over, which core then refuses, so such pages cannot be copied as they are.
   */
  readonly uncopyable?: true;
}

/**
 * The page collections among the registry's records, each slug once, in
 * registry order. Both the search and the Pages panel's writes read them; only
 * the search orders them, through {@link inListingOrder}.
 */
export function pageCollections(
  records: readonly unknown[],
  stores: ReadonlySet<string>
): PageCollection[] {
  const found = new Map<string, PageCollection>();
  for (const value of records) {
    const source = pageCollectionOf(value, stores);
    if (source !== undefined && !found.has(source.slug)) {
      found.set(source.slug, source);
    }
  }
  return [...found.values()];
}

/**
 * One registry record as a page collection, or `undefined` when it is not one.
 *
 * A record counts when its schema is live, it declares a blocks field at an
 * addressable path and it is not one of `stores`, the plugin's composition
 * stores. A record whose slug cannot be read is skipped: there is no
 * collection to address. Where a
 * collection declares several blocks fields, its pages are listed once, under
 * the first: a page is one result however many fields it has.
 */
function pageCollectionOf(
  value: unknown,
  stores: ReadonlySet<string>
): PageCollection | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const slug = slugOf(record);
  if (slug === undefined || stores.has(slug)) return undefined;
  if (!schemaIsLive(record)) return undefined;
  // The editor's own reading of which blocks fields it opens (top level or
  // inside groups, by form path), and the field's own kinds: a field that
  // holds only components or patterns does not make its rows pages.
  const field = editorBlocksFields(record).find(declared =>
    acceptsKind(declared.declaration, "page")
  );
  if (field === undefined) return undefined;
  return {
    slug,
    label: labelOf(record, slug),
    ...pluralLabelOf(record),
    field: field.path,
    // Core's projection of a registry record, which reads the lifecycle
    // switch only when it is a real boolean.
    lifecycle: resolvedCollectionView(record).status === true,
    ...declaredFacts(record, field.declaration),
    ...writeLimits(record, field.path, titleFieldIn(record)?.name),
  };
}

/**
 * What a page collection's record declares that only some collections do:
 * the field naming its pages, the kinds its Page Builder field accepts, and a
 * slug field. Each is left out where the record declares none.
 */
function declaredFacts(
  record: Record<string, unknown>,
  declaration: object
): Pick<PageCollection, "title" | "kinds" | "slugField"> {
  const title = titleFieldIn(record);
  const kinds = acceptedKinds(declaration);
  const slugField = slugFieldOf(record);
  return {
    ...(title === undefined ? {} : { title }),
    ...(kinds === undefined ? {} : { kinds }),
    ...(slugField === undefined ? {} : { slugField }),
  };
}

/** A top-level field as a registry record declares it, as far as writes care. */
interface DeclaredField {
  name?: unknown;
  required?: unknown;
  unique?: unknown;
  defaultValue?: unknown;
}

/**
 * What a page write cannot supply on its own: the other required fields with
 * no default, and whether another field must be unique. Top-level fields only,
 * the ones a create body names; the fields a write does fill are left out.
 */
function writeLimits(
  record: Record<string, unknown>,
  pageField: string,
  titleName: string | undefined
): Pick<PageCollection, "needsMore" | "uncopyable"> {
  const filled = new Set([
    pageField.split(".")[0] ?? pageField,
    SLUG_FIELD,
    "status",
    ...(titleName === undefined ? [] : [titleName]),
  ]);
  const fields = (Array.isArray(record.fields) ? record.fields : []).filter(
    (value): value is DeclaredField & { name: string } =>
      typeof value === "object" &&
      value !== null &&
      typeof (value as DeclaredField).name === "string" &&
      !filled.has((value as { name: string }).name)
  );
  const needsMore = fields
    .filter(
      field => field.required === true && field.defaultValue === undefined
    )
    .map(field => field.name);
  return {
    ...(needsMore.length === 0 ? {} : { needsMore }),
    ...(fields.some(field => field.unique === true)
      ? { uncopyable: true }
      : {}),
  };
}

/** The registry record whose slug is `slug`, or `undefined` for none. */
export function recordNamed(
  records: readonly unknown[],
  slug: string
): Record<string, unknown> | undefined {
  for (const value of records) {
    if (typeof value !== "object" || value === null) continue;
    const record = value as Record<string, unknown>;
    if (slugOf(record) === slug) return record;
  }
  return undefined;
}

/**
 * The fields a path template reads, among the top-level fields `record`
 * declares.
 *
 * Read off core's own interpolation rather than a second reading of the
 * template's syntax: the template is resolved once against a stand-in entry
 * that answers every field and records which ones were asked for, so the
 * fields selected are exactly the ones the path is later made from, whatever
 * placeholder spelling core accepts. Only declared fields are kept, so a
 * placeholder naming no field selects nothing (the page then has no path, as
 * core's resolution says for an unfilled placeholder).
 */
export function templateFields(
  template: string,
  record: Record<string, unknown> | undefined
): readonly string[] {
  const asked = new Set<string>();
  const standIn = new Proxy<Record<string, unknown>>(
    {},
    {
      get: (_target, key) => {
        if (typeof key === "string") asked.add(key);
        return "x";
      },
    }
  );
  previewUrlFromTemplate(template)(standIn);
  const declared = new Set(
    (Array.isArray(record?.fields) ? record.fields : []).flatMap(
      (field: unknown) => {
        const name =
          typeof field === "object" && field !== null
            ? (field as { name?: unknown }).name
            : undefined;
        return typeof name === "string" ? [name] : [];
      }
    )
  );
  return [...asked].filter(name => declared.has(name));
}

/** The field name a page's address is conventionally stored under. */
const SLUG_FIELD = "slug";

/**
 * A record's top-level `slug` text field, and whether it is unique, or
 * `undefined` where it has none. Read from the same record the rest of the
 * collection is, so a write derives a slug only where one is stored.
 */
function slugFieldOf(
  record: Record<string, unknown>
): PageCollection["slugField"] {
  const fields = Array.isArray(record.fields) ? record.fields : [];
  for (const value of fields) {
    if (typeof value !== "object" || value === null) continue;
    const field = value as { name?: unknown; type?: unknown; unique?: unknown };
    if (field.name === SLUG_FIELD && field.type === "text") {
      return { name: SLUG_FIELD, unique: field.unique === true };
    }
  }
  return undefined;
}

/**
 * The page collection `slug` names among the registry's records, or
 * `undefined` when it names none: no such collection, a collection without an
 * addressable Page Builder field, one of `stores`, or one whose schema is not
 * live.
 */
export function pageCollectionIn(
  records: readonly unknown[],
  stores: ReadonlySet<string>,
  slug: string
): PageCollection | undefined {
  return pageCollections(records, stores).find(source => source.slug === slug);
}

/**
 * The registry's `migrationStatus` values under which a collection's table is
 * known to match its schema: `synced` (a code-first collection, synced at
 * boot) and `applied` (a change whose migration ran and whose table was
 * verified). `pending`, `generated` and `failed` mean the schema may name a
 * column the table lacks yet, so reading it would fail.
 */
const LIVE_SCHEMA_STATES: ReadonlySet<string> = new Set(["synced", "applied"]);

/**
 * Whether a registry record's schema is live, by core's own `migrationStatus`.
 * A record that carries none is read: nothing says it is not live, and a read
 * that fails anyway drops only that collection (see `searchCollection`).
 */
export function schemaIsLive(record: Record<string, unknown>): boolean {
  const state = record.migrationStatus;
  return typeof state !== "string" || LIVE_SCHEMA_STATES.has(state);
}

/** A record's slug, when it has a usable one. */
export function slugOf(record: Record<string, unknown>): string | undefined {
  return typeof record.slug === "string" && record.slug !== ""
    ? record.slug
    : undefined;
}
