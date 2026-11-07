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
 * One step into a relation, a bounded number of fields, Singles and
 * relations, and the picker keeps the answer briefly: it opens often.
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
  type BindingFieldShape,
} from "@nextlyhq/blocks-engine";
import { getCachedNextly, type PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { respondDoc } from "nextly";
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
import { readBodyWith } from "./composition-route-kit";
import { editorReaderAsCaller } from "./entry-reads";
import { publicReader } from "./unbind-kept";

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
      .strict(),
    locale: z.string().min(1).max(35).optional(),
  })
  .strict();

/** At most this many fields of one source, or of one relation, are listed. */
const MOST_FIELDS = 100;
/** At most this many Singles are listed. */
const MOST_SINGLES = 50;
/** At most this many relations of one source are followed a step in. */
const MOST_RELATIONS = 10;
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
  /** The fields the public may read, as the published page decides them. */
  publicShapes(
    ref: { readonly collection: string } | { readonly single: string }
  ): Promise<readonly BindingFieldShape[]>;
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
  return { shapes: returned(declared, row), row, published, publicShapes };
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
  };
}

/** One field as the picker lists it, from its level's read; a group's inside it. */
function pickerField(shape: BindingFieldShape, read: SourceRead): PickerField {
  const { fields: _declaredInside, ...own } = shape;
  const value = read.row[shape.name];
  const publicShape = read.publicShapes.find(
    candidate => candidate.name === shape.name
  );
  const isPublic = publicShape !== undefined;
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

/** A source's fields, each relation followed one step in, up to the cap. */
async function sourceFields(
  read: SourceRead,
  reads: BindingFieldsReads
): Promise<readonly PickerField[]> {
  let followed = 0;
  return Promise.all(
    read.shapes.map(async shape => {
      const field = pickerField(shape, read);
      const target = followable(shape);
      const id = relatedId(read.row[shape.name]);
      if (target === undefined || id === undefined) return field;
      if (followed >= MOST_RELATIONS) return field;
      followed += 1;
      const related = await readSource({ collection: target, id }, reads);
      if (related === undefined) return field;
      return {
        ...field,
        fields: related.shapes.map(inner => pickerField(inner, related)),
      };
    })
  );
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
        public: true,
        ...(preview === undefined ? {} : { preview }),
      };
    }),
  };
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
  const entryRef: FieldsRef | undefined =
    own.kind === "single"
      ? { single: own.slug }
      : own.id === undefined
        ? undefined
        : { collection: own.slug, id: own.id };
  if (entryRef !== undefined) {
    const read = await readSource(entryRef, reads);
    if (read !== undefined) {
      sources.push({
        binding: { source: "entry" },
        label: await reads.collectionLabel(own.slug),
        fields: await sourceFields(read, reads),
      });
    }
  }
  const singles = (await reads.singles()).slice(0, MOST_SINGLES);
  const singleSources = await Promise.all(
    singles.map(async ({ slug, label }): Promise<PickerSource | undefined> => {
      const read = await readSource({ single: slug }, reads);
      return read === undefined
        ? undefined
        : {
            binding: { source: "single", sourceKey: slug },
            label,
            fields: await sourceFields(read, reads),
          };
    })
  );
  for (const source of singleSources) {
    if (source !== undefined && source.fields.length > 0) sources.push(source);
  }
  sources.push(await siteSource(reads));
  return { sources };
}

/** The reads the route binds: as the caller, and as a visitor for the published. */
function directBindingFieldsReads(
  ctx: PluginRouteContext,
  locale: string | undefined
): BindingFieldsReads {
  const editor = editorReaderAsCaller(ctx, locale);
  const visitor = publicReader(locale);
  const at = locale === undefined ? {} : { locale };
  return {
    declared: async ref => {
      const { declaredFieldShapes } = await import("nextly/runtime");
      return declaredFieldShapes(ref);
    },
    publicShapes: async ref => {
      const { bindingFieldShapes } = await import("nextly/runtime");
      return (await bindingFieldShapes(ref, at)) ?? [];
    },
    asEditor: async (ref, select) => {
      const reader = await editor;
      try {
        return "single" in ref
          ? await reader.findSingle({ slug: ref.single, select, ...at })
          : await reader.findById({
              collection: ref.collection,
              id: ref.id,
              select,
              ...at,
            });
      } catch {
        // A read the gate refuses reads as nothing, as the canvas reads it.
        return null;
      }
    },
    published: async (ref, select) => {
      const reader = await visitor;
      try {
        if ("single" in ref) {
          return await reader.findSingle({ slug: ref.single, select, ...at });
        }
        const found = await reader.find({
          collection: ref.collection,
          filters: [{ field: "id", op: "equals", value: ref.id }],
          limit: 1,
        });
        const row = found.items[0];
        return isPlainRecord(row) ? row : null;
      } catch {
        return null;
      }
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
