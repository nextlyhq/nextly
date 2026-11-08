/**
 * The fields the inspector's picker offers a binding: the entry the page
 * shows, each Single and the site settings, each field with whether the
 * public may read it and a short preview of its value.
 *
 * ## Whose view
 *
 * The person editing's. Each source is read once, as the caller, through
 * core's one access gate (`editorReaderAsCaller`), and only what that read
 * returns is listed: a source the gate refuses is left out whole, and a field
 * its field rules hide is left out by name, so the picker never shows what
 * the person may not read, not even as an empty field. Whether the public may
 * read a field is what the published page decides it by
 * (`bindingFieldShapes`), so "Not public" means what the page will do.
 *
 * ## How much
 *
 * One step into a relation, a bounded number of fields and Singles, and of
 * relations across the whole ask, and the picker keeps the answer briefly:
 * it opens often. A Single no visitor may read any of is left out.
 *
 * ## Caching
 *
 * None here. The answer is one person's, so the route is `noStore`.
 *
 * @module binding-fields-route
 */
import {
  isPlainRecord,
  sameJsonValue,
  SITE_SETTING_FIELD_SHAPES,
  SITE_SETTING_LABELS,
  type BindingFieldShape,
} from "@nextlyhq/blocks-engine";
import {
  getCachedNextly,
  respondDoc,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import { z } from "nextly/zod";

import {
  BINDING_FIELDS_ROUTE_PATH,
  type BindingFieldsRequest,
  type BindingFieldsResponse,
  type PickerField,
  type PickerSource,
} from "./binding-fields-contract";
import { collectionNaming } from "./bindings-report/readable";
import { labelOf } from "./collection-labels";
import { PAGES_SLUG } from "./collections/pages";
import { TEMPLATES_SLUG } from "./collections/templates";
import { readBodyWith } from "./composition-route-kit";
import { editorReaderAsCaller, publicSourceReader } from "./entry-reads";
import { pageBuilderContent } from "./page-content";

/** A collection's or a Single's slug. */
const SLUG = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

/** The body as it is read, before anything else is. */
const BindingFieldsBody = z
  .object({
    source: z
      .object({
        kind: z.enum(["collection", "single"]),
        slug: SLUG,
        id: z.string().min(1).max(200).optional(),
      })
      .strict()
      .optional(),
    locale: z.string().min(1).max(35).optional(),
  })
  .strict();

/** At most this many fields of one source, or of one relation, are listed. */
const MOST_FIELDS = 100;
/** At most this many Singles are listed. */
const MOST_SINGLES = 50;
/**
 * At most this many relations are followed a step in, across the whole ask:
 * each costs two reads, so the cap bounds one ask's reads whatever the number
 * of Singles.
 */
const MOST_RELATIONS = 20;
/** A date every read of an entry carries, whatever its declared fields. */
const TIMESTAMPS: ReadonlySet<string> = new Set(["createdAt", "updatedAt"]);
/** A preview's length, in characters, before it is cut. */
const PREVIEW_LENGTH = 80;

/** One entry or one Single, as a source is read. */
export type FieldsRef =
  | { readonly collection: string; readonly id: string }
  | { readonly single: string };

/** What the route reads with, injected so the listing is tested without a server. */
export interface BindingFieldsReads {
  /** A source's declared fields, whoever may read them; none for no such source. */
  declared(
    ref: { readonly collection: string } | { readonly single: string }
  ): Promise<readonly BindingFieldShape[] | undefined>;
  /**
   * The fields the public may read, as the published page decides them;
   * `undefined` where a visitor may read none of the source, which an empty
   * list (a public source with no custom field a visitor reads) is not.
   */
  publicShapes(
    ref: { readonly collection: string } | { readonly single: string }
  ): Promise<readonly BindingFieldShape[] | undefined>;
  /** The source as the caller reads it, these fields only; `null` when refused. */
  asEditor(
    ref: FieldsRef,
    select: readonly string[]
  ): Promise<Readonly<Record<string, unknown>> | null>;
  /** The source as a visitor reads it, published only; `null` when none is. */
  published(
    ref: FieldsRef,
    select: readonly string[]
  ): Promise<Readonly<Record<string, unknown>> | null>;
  /** Up to {@link MOST_SINGLES} Singles, by slug, with their labels. */
  singles(): Promise<
    readonly { readonly slug: string; readonly label: string }[]
  >;
  /** A collection's label, for the entry's group. */
  collectionLabel(slug: string): Promise<string>;
  /**
   * Whether the site serves a page for one entry, and its collection's
   * plural name: a related entry is offered for a link only where it has a
   * page to go to, and named as waiting for one otherwise.
   */
  pagesFor(entry: {
    readonly collection: string;
    readonly id: string;
  }): Promise<{ readonly served: boolean; readonly label: string }>;
  /** The site settings, as every visitor reads them. */
  site(): Promise<Readonly<Record<string, unknown>>>;
}

/** A value's preview: text, a number or a yes-or-no, cut short; else none. */
function previewOf(value: unknown): string | undefined {
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (text === "") return undefined;
  return text.length > PREVIEW_LENGTH
    ? `${text.slice(0, PREVIEW_LENGTH - 1)}…`
    : text;
}

/** The id a relation's value names, populated or not. */
function relatedId(value: unknown): string | undefined {
  if (typeof value === "string" && value !== "") return value;
  if (typeof value === "number") return String(value);
  return isPlainRecord(value) ? relatedId(value.id) : undefined;
}

/** A single relation's target collection, which a step in reads. */
function followable(shape: BindingFieldShape): string | undefined {
  if (shape.type !== "relationship" && shape.type !== "upload")
    return undefined;
  if (shape.hasMany === true) return undefined;
  return typeof shape.relationTo === "string" ? shape.relationTo : undefined;
}

/** What one read of a source, or of a group in it, gives the listing. */
interface SourceRead {
  readonly shapes: readonly BindingFieldShape[];
  readonly row: Readonly<Record<string, unknown>>;
  readonly published: Readonly<Record<string, unknown>> | null;
  /** The same level's fields as the public may read them. */
  readonly publicShapes: readonly BindingFieldShape[];
  /** Whether a visitor may read the source, or the group, at all. */
  readonly publicSource: boolean;
}

/**
 * The fields the caller's read returned at this level: a field their rules
 * hide is deleted from it, so it is never listed, not even as empty.
 */
function returned(
  shapes: readonly BindingFieldShape[],
  row: Readonly<Record<string, unknown>>
): readonly BindingFieldShape[] {
  return shapes
    .slice(0, MOST_FIELDS)
    .filter(shape => Object.hasOwn(row, shape.name));
}

/**
 * One source read as the caller, its declared fields narrowed to those the
 * read returned; `undefined` when there is no such source or the gate
 * refused it.
 */
async function readSource(
  ref: FieldsRef,
  reads: BindingFieldsReads
): Promise<SourceRead | undefined> {
  const kind =
    "single" in ref ? { single: ref.single } : { collection: ref.collection };
  const declared = await reads.declared(kind);
  if (declared === undefined) return undefined;
  const names = declared.slice(0, MOST_FIELDS).map(shape => shape.name);
  const row = await reads.asEditor(ref, names);
  if (row === null) return undefined;
  const [published, publicShapes] = await Promise.all([
    reads.published(ref, names),
    reads.publicShapes(kind),
  ]);
  return {
    shapes: returned(declared, row),
    row,
    published,
    publicShapes: publicShapes ?? [],
    publicSource: publicShapes !== undefined,
  };
}

/** A group's own level, read from its value in the source's read. */
function groupRead(
  shape: BindingFieldShape,
  read: SourceRead,
  publicShape: BindingFieldShape | undefined
): SourceRead | undefined {
  const row = read.row[shape.name];
  if (shape.fields === undefined || !isPlainRecord(row)) return undefined;
  const published = read.published?.[shape.name];
  return {
    shapes: returned(shape.fields, row),
    row,
    published: isPlainRecord(published) ? published : null,
    publicShapes: publicShape?.fields ?? [],
    publicSource: publicShape !== undefined,
  };
}

/** A field's shape as the public reads it, and whether a visitor may read it. */
function visibilityOf(
  shape: BindingFieldShape,
  read: SourceRead
): { readonly publicShape?: BindingFieldShape; readonly isPublic: boolean } {
  const publicShape = read.publicShapes.find(
    candidate => candidate.name === shape.name
  );
  if (publicShape !== undefined) return { publicShape, isPublic: true };
  // The timestamps are read with the entry, so a visitor who may read the
  // source reads them, though its field shapes never list them.
  return { isPublic: TIMESTAMPS.has(shape.name) && read.publicSource };
}

/** One field as the picker lists it, from its level's read; a group's inside it. */
function pickerField(shape: BindingFieldShape, read: SourceRead): PickerField {
  const { fields: _declaredInside, ...own } = shape;
  const value = read.row[shape.name];
  const { publicShape, isPublic } = visibilityOf(shape, read);
  const draft = !sameJsonValue(value, read.published?.[shape.name]);
  const preview = isPublic && !draft ? previewOf(value) : undefined;
  const group = groupRead(shape, read, publicShape);
  return {
    ...own,
    public: isPublic,
    ...(isPublic && draft ? { draft: true as const } : {}),
    ...(preview === undefined ? {} : { preview }),
    ...(group === undefined
      ? {}
      : { fields: group.shapes.map(inner => pickerField(inner, group)) }),
  };
}

/**
 * A relation's field as a visitor reaches it: through the relation, so not
 * public where the relation is not, and a draft's where the relation is a
 * draft's (it names another entry than the published one does), with no
 * value shown then.
 */
function throughRelation(
  inner: PickerField,
  relation: PickerField
): PickerField {
  const { preview, ...withoutPreview } = inner;
  const { draft: ownDraft, ...rest } = withoutPreview;
  const isPublic = inner.public && relation.public;
  const draft = relation.draft === true || ownDraft === true;
  // A group's fields are reached through the same relation, every level down.
  const { fields: inside, ...withoutInside } = rest;
  return {
    ...withoutInside,
    public: isPublic,
    ...(isPublic && draft ? { draft: true as const } : {}),
    ...(isPublic && !draft && preview !== undefined ? { preview } : {}),
    ...(inside === undefined
      ? {}
      : { fields: inside.map(field => throughRelation(field, relation)) }),
  };
}

/**
 * The related entry's own id, under a relation to one entry of one
 * collection, as a link's entry is bound to it (`author.id`): no schema
 * declares an id, so it is listed here, named for what a pick does. A
 * visitor reads it as they read that entry, so it is public where the
 * related collection is, through the relation, and a draft's where the entry
 * is not published. Not listed under an upload, whose record has no page to
 * link to, nor where the collection declares a field called `id`, which is
 * listed as its own. Where the collection has no page yet, it is listed
 * naming the collection it waits for, and the picker offers it disabled.
 */
async function relatedEntryLink(
  shape: BindingFieldShape,
  entry: { readonly collection: string; readonly id: string },
  related: SourceRead,
  relation: PickerField,
  reads: BindingFieldsReads
): Promise<readonly PickerField[]> {
  const target = entry.collection;
  if (shape.type !== "relationship") return [];
  if (related.shapes.some(inner => inner.name === "id")) return [];
  const pages = await reads.pagesFor(entry);
  const link: PickerField = {
    name: "id",
    type: "text",
    label: "Link to this entry",
    linksTo: target,
    public: related.publicSource,
    ...(related.publicSource && related.published === null
      ? { draft: true as const }
      : {}),
    ...(pages.served ? {} : { noPageFor: pages.label }),
  };
  return [throughRelation(link, relation)];
}

/** How many relations the ask has followed, shared by every source. */
interface FollowBudget {
  followed: number;
}

/** A source's fields, each relation followed one step in, up to the ask's cap. */
async function sourceFields(
  read: SourceRead,
  reads: BindingFieldsReads,
  budget: FollowBudget
): Promise<readonly PickerField[]> {
  return Promise.all(
    read.shapes.map(async shape => {
      const field = pickerField(shape, read);
      const target = followable(shape);
      const id = relatedId(read.row[shape.name]);
      if (target === undefined || id === undefined) return field;
      if (budget.followed >= MOST_RELATIONS) return field;
      budget.followed += 1;
      const related = await readOrFailed({ collection: target, id }, reads);
      // A relation whose entry can't be read lists none of its fields.
      if (related === undefined || related === "failed") return field;
      return {
        ...field,
        fields: [
          ...related.shapes.map(inner =>
            throughRelation(pickerField(inner, related), field)
          ),
          ...(await relatedEntryLink(
            shape,
            { collection: target, id: String(id) },
            related,
            field,
            reads
          )),
        ],
      };
    })
  );
}

/**
 * One source read as {@link readSource} reads it, or `"failed"` where the read
 * failed for a reason other than access: that source alone is reported, and
 * the others still list.
 */
async function readOrFailed(
  ref: FieldsRef,
  reads: BindingFieldsReads
): Promise<SourceRead | undefined | "failed"> {
  try {
    return await readSource(ref, reads);
  } catch {
    return "failed";
  }
}

/** A source the picker names but could not read, with no fields. */
function failedSource(
  binding: PickerSource["binding"],
  label: string
): PickerSource {
  return { binding, label, fields: [], readFailed: true };
}

/** Whether a visitor may read a field, or one inside it. */
function isReachable(field: PickerField): boolean {
  return field.public || (field.fields ?? []).some(isReachable);
}

/** A site setting's label, from the engine's table of them. */
function siteSettingLabel(name: string): { readonly label?: string } {
  return Object.hasOwn(SITE_SETTING_LABELS, name)
    ? { label: SITE_SETTING_LABELS[name as keyof typeof SITE_SETTING_LABELS] }
    : {};
}

/** The site settings, every one public, previewed as visitors see them. */
async function siteSource(reads: BindingFieldsReads): Promise<PickerSource> {
  const values = await reads.site();
  return {
    binding: { source: "site" },
    label: "Site",
    fields: SITE_SETTING_FIELD_SHAPES.map((shape): PickerField => {
      const preview = previewOf(values[shape.name]);
      return {
        name: shape.name,
        type: shape.type,
        // Its name in words: "Site URL", not the key's "Site url".
        ...siteSettingLabel(shape.name),
        public: true,
        ...(preview === undefined ? {} : { preview }),
      };
    }),
  };
}

/** The page's own entry as a source: read, named as failed, or none to list. */
async function entrySource(
  own: NonNullable<BindingFieldsRequest["source"]>,
  ref: FieldsRef,
  singles: readonly { readonly slug: string; readonly label: string }[],
  reads: BindingFieldsReads,
  budget: FollowBudget
): Promise<PickerSource | undefined> {
  // A Single's own label for a Single, a collection's for an entry.
  const label =
    own.kind === "single"
      ? (singles.find(single => single.slug === own.slug)?.label ?? own.slug)
      : await reads.collectionLabel(own.slug);
  const read = await readOrFailed(ref, reads);
  if (read === undefined) return undefined;
  if (read === "failed") return failedSource({ source: "entry" }, label);
  return {
    binding: { source: "entry" },
    label,
    fields: await sourceFields(read, reads, budget),
  };
}

/**
 * The Singles as sources, read at once, then each expanded in the Singles'
 * order, so the shared relation budget goes to the same Singles on every ask
 * whatever order the reads finish in. A Single no visitor may read any of
 * can only ever show a binding's fallback, such as a plugin's own settings:
 * it is left out. One that could not be read is named, so the picker can say
 * so.
 */
async function singleSources(
  singles: readonly { readonly slug: string; readonly label: string }[],
  reads: BindingFieldsReads,
  budget: FollowBudget
): Promise<readonly PickerSource[]> {
  const read = await Promise.all(
    singles.map(({ slug }) => readOrFailed({ single: slug }, reads))
  );
  const listed: PickerSource[] = [];
  for (const [index, { slug, label }] of singles.entries()) {
    const source = await singleSource(read[index], slug, label, reads, budget);
    if (source !== undefined) listed.push(source);
  }
  return listed;
}

/** One Single as a source, or none where it is not listed. */
async function singleSource(
  read: SourceRead | undefined | "failed",
  slug: string,
  label: string,
  reads: BindingFieldsReads,
  budget: FollowBudget
): Promise<PickerSource | undefined> {
  const binding = { source: "single" as const, sourceKey: slug };
  if (read === undefined) return undefined;
  if (read === "failed") return failedSource(binding, label);
  const fields = await sourceFields(read, reads, budget);
  return fields.some(isReachable) ? { binding, label, fields } : undefined;
}

/**
 * The picker's sources for the page being edited: its entry, when it has
 * one to read, each Single the caller may read, and the site settings.
 */
export async function readBindingFields(
  request: BindingFieldsRequest,
  reads: BindingFieldsReads
): Promise<BindingFieldsResponse> {
  const sources: PickerSource[] = [];
  const own = request.source;
  const budget: FollowBudget = { followed: 0 };
  const singles = (await reads.singles()).slice(0, MOST_SINGLES);
  const entryRef: FieldsRef | undefined =
    own === undefined
      ? undefined
      : own.kind === "single"
        ? { single: own.slug }
        : own.id === undefined
          ? undefined
          : { collection: own.slug, id: own.id };
  if (own !== undefined && entryRef !== undefined) {
    const entry = await entrySource(own, entryRef, singles, reads, budget);
    if (entry !== undefined) sources.push(entry);
  }
  sources.push(...(await singleSources(singles, reads, budget)));
  sources.push(await siteSource(reads));
  return { sources };
}

/** The reads the route binds: as the caller, and as a visitor for the published. */
/**
 * Whether the site serves a page for one entry, and its collection's plural
 * name. The plugin's own pages are served at their own addresses; any other
 * entry by the published design the public page draws it with, its own or
 * its collection's template, found as that page finds it
 * (`pageBuilderContent`'s `templates.readFor`), so a link offered here finds
 * the page a visitor is sent to, and an entry whose own design outlives its
 * collection's template is still offered. A collection a host route of its
 * own serves without a template is not known here, and is said to have none.
 */
async function pagesOf(
  ctx: PluginRouteContext,
  entry: { readonly collection: string; readonly id: string },
  locale: string | undefined
): Promise<{ readonly served: boolean; readonly label: string }> {
  const { collection } = entry;
  const label = (await collectionNaming(ctx, collection))?.label ?? collection;
  if (collection === (ctx.self.collections[PAGES_SLUG] ?? PAGES_SLUG)) {
    return { served: true, label };
  }
  const content = pageBuilderContent({
    templatesCollection: ctx.self.collections[TEMPLATES_SLUG] ?? TEMPLATES_SLUG,
  });
  const design = await content.templates
    .readFor(collection, entry.id, locale)
    .catch(() => null);
  return { served: design !== null, label };
}

function directBindingFieldsReads(
  ctx: PluginRouteContext,
  locale: string | undefined
): BindingFieldsReads {
  const editor = editorReaderAsCaller(ctx, locale);
  const visitor = publicSourceReader(locale);
  const at = locale === undefined ? {} : { locale };
  // Asked once per entry in an ask, however many relations name it.
  const pages = new Map<
    string,
    Promise<{ readonly served: boolean; readonly label: string }>
  >();
  return {
    declared: async ref => {
      const { declaredFieldShapes } = await import("nextly/runtime");
      return declaredFieldShapes(ref);
    },
    publicShapes: async ref => {
      const { bindingFieldShapes } = await import("nextly/runtime");
      return bindingFieldShapes(ref, at);
    },
    // The readers answer a missing or refused read with `null`, by core's
    // one gate; any other failure is the ask's, and fails it.
    asEditor: async (ref, select) => {
      const reader = await editor;
      return "single" in ref
        ? reader.findSingle({ slug: ref.single, select, ...at })
        : reader.findById({
            collection: ref.collection,
            id: ref.id,
            select,
            ...at,
          });
    },
    published: async (ref, select) => {
      const reader = await visitor;
      if ("single" in ref) {
        return reader.findSingle({ slug: ref.single, select, ...at });
      }
      const found = await reader.find({
        collection: ref.collection,
        filters: [{ field: "id", op: "equals", value: ref.id }],
        select,
        limit: 1,
      });
      const row = found.items[0];
      return isPlainRecord(row) ? row : null;
    },
    singles: async () => {
      const listed: unknown = await ctx.services.singles.list({
        limit: MOST_SINGLES,
      });
      const rows = (listed as { data?: unknown }).data;
      if (!Array.isArray(rows)) return [];
      return rows.flatMap(row => {
        if (!isPlainRecord(row) || typeof row.slug !== "string") return [];
        return [{ slug: row.slug, label: labelOf(row, row.slug) }];
      });
    },
    collectionLabel: async slug =>
      (await collectionNaming(ctx, slug))?.singular ?? slug,
    pagesFor: async entry => {
      const key = `${entry.collection}\u0000${entry.id}`;
      const known = pages.get(key);
      if (known !== undefined) return await known;
      const answer = pagesOf(ctx, entry, locale);
      pages.set(key, answer);
      return await answer;
    },
    site: async () => {
      const nextly = await getCachedNextly();
      const settings: unknown = await nextly.publicSiteSettings();
      return isPlainRecord(settings) ? settings : {};
    },
  };
}

/**
 * The route declaration. Authenticated (no `public: true`), with no
 * permission of its own: core's gate judges each source's read as the
 * caller. A POST for the reason the canvas bindings route gives; `noStore`
 * because its answer is one person's.
 */
export function bindingFieldsRoute(): {
  method: "POST";
  path: string;
  noStore: true;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  return {
    method: "POST",
    path: BINDING_FIELDS_ROUTE_PATH,
    noStore: true,
    handler: async (req, ctx) => {
      const body = await readBodyWith(req, BindingFieldsBody, "binding fields");
      return respondDoc(
        await readBindingFields(
          body,
          directBindingFieldsReads(ctx, body.locale)
        )
      );
    },
  };
}
