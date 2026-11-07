/**
 * The composition manifest: what an API client or an agent reads before it
 * composes a page. It lists the site's patterns, its components with their
 * exposed fields, slots and variants (names and stable ids), its Layouts with
 * their regions and which is the site default, the collections each lives in,
 * and the actions that change them, each with its route, its service call and
 * the JSON Schema of its request.
 *
 * Read AS THE CALLER, every part of it, through the same readers the editor's
 * panels use: the pattern and component libraries and the Layout choices. A
 * part the caller may not read is answered `readable: false` with no items,
 * rather than refusing the whole manifest, since an author who may place
 * components but not edit Layouts still composes pages. Every id a page
 * action takes is one this answers, as are the field, slot and variant ids a
 * definition edit takes, so a client need not guess one. An edit pointing at
 * a block inside a component names it by its node id in the definition, which
 * the component's row holds (`collections.components`, `componentField`).
 *
 * `compositionManifestSchema` is the answer's zod schema, published so a
 * client can validate what it read.
 *
 * @experimental Settles when the composition API ships.
 * @module composition-manifest
 */
import {
  DEFAULT_LIMITS,
  REGION_AREAS,
  type ComponentDocument,
  type DocumentLimits,
  type RegionArea,
  type NamedQueryDeclaration,
} from "@nextlyhq/blocks-engine";
import {
  DEFINITION_ACTION_KINDS,
  PAGE_ACTION_KINDS,
  TEMPLATE_ACTION_KINDS,
} from "@nextlyhq/builder/ops";
import {
  getCachedNextly,
  NextlyError,
  respondDoc,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import { z } from "nextly/zod";

import { LAYOUTS_SLUG } from "./collections/layouts";
import { PAGES_SLUG } from "./collections/pages";
import { PATTERNS_SLUG } from "./collections/patterns";
import { TEMPLATES_SLUG } from "./collections/templates";
import {
  DEFINITION_ACTIONS_ROUTE_PATH,
  PAGE_ACTIONS_ROUTE_PATH,
} from "./composition-actions-contract";
import { parsedWith, storeOf } from "./composition-route-kit";
import { definitionActionRequestJsonSchema } from "./definition-actions-route";
import { LAYOUT_LOCALE_MAX } from "./layout-choices-contract";
import { fenceStates, readLayoutChoices } from "./layout-choices-route";
import { layoutRemovalStore } from "./layout-removal/store";
import {
  DEFAULT_COMPONENT_STORE,
  directComponentReads,
  readComponentLibrary,
  readPatternLibrary,
  type ComponentStore,
} from "./library-route";
import { namedQueryItem, namedQueryParamsSchema } from "./named-queries";
import type { NamedQueryRowField } from "./named-queries-contract";
import { pageActionRequestJsonSchema } from "./page-actions-route";
import { TEMPLATE_ACTIONS_ROUTE_PATH } from "./templates/template-actions-contract";
import { templateActionRequestJsonSchema } from "./templates/template-actions-route";

/**
 * `GET /manifest`: the composition manifest, as the caller may read it.
 *
 * @experimental Settles when the composition API ships.
 */
export const MANIFEST_ROUTE_PATH = "/manifest";

/** The query parameter naming the language component and Layout text is read in. */
export const MANIFEST_LOCALE_PARAM = "locale";

/** The manifest's own format, raised when its shape changes incompatibly. */
export const MANIFEST_FORMAT_VERSION = 1 as const;

/** One part of the manifest: its rows, and whether the caller could read it. */
export interface ManifestTier<T> {
  /** Whether the caller may read this part at all. */
  readonly readable: boolean;
  readonly items: readonly T[];
  /** Whether a bound stopped the read before the collection ended. */
  readonly truncated: boolean;
}

/** One pattern, by the id `insert-pattern` takes. */
export interface ManifestPattern {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly category?: string;
  /** How much of a page it covers: a section, a full page, and so on. */
  readonly granularity?: string;
}

/** One component, with what a placement of it addresses. */
export interface ManifestComponent {
  /** The id `place-component` takes. */
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly category?: string;
  /** The fields a placement may set, by the exposure id `values` is keyed by. */
  readonly fields: readonly {
    readonly id: string;
    readonly label: string;
    readonly type: string;
    readonly options?: readonly {
      readonly value: string;
      readonly label: string;
    }[];
  }[];
  /** The regions a placement may fill with blocks of its own. */
  readonly slots: readonly {
    readonly id: string;
    readonly label: string;
    readonly allow?: readonly string[];
  }[];
  /** The variants a placement may choose, by the stable id `variant` takes. */
  readonly variants: readonly { readonly id: string; readonly label: string }[];
}

/** One Layout, by the id `set-layout` takes. */
export interface ManifestLayout {
  readonly id: string;
  readonly title: string;
  /** Whether it is published now; only a published Layout draws regions. */
  readonly published: boolean;
  /** Whether it is the site's default Layout. */
  readonly isDefault: boolean;
  readonly regions: readonly {
    readonly area: RegionArea;
    readonly componentId: string;
  }[];
}

/** One action, as a client calls it over HTTP or through the service. */
export interface ManifestAction {
  /** The service method that runs it. */
  readonly name: "pageAction" | "definitionAction" | "templateAction";
  readonly method: "POST";
  /** The route's path under the plugin's mount; `:id` is the component's id. */
  readonly path: string;
  /** Every `action.kind` it takes. */
  readonly kinds: readonly string[];
  /** The JSON Schema of the request body. */
  readonly request: Readonly<Record<string, unknown>>;
}

/**
 * One named query a `set-list-query` action may set as a list's custom
 * source, without its run function: its inputs as a JSON Schema object, and
 * what its rows are.
 *
 * @experimental Settles when the composition API ships.
 */
export interface ManifestNamedQuery {
  readonly name: string;
  readonly label: string;
  readonly description?: string;
  /** What a list's `namedQuery.params` may hold. */
  readonly params: Readonly<Record<string, unknown>>;
  readonly rows:
    | { readonly collection: string }
    | {
        readonly key: string;
        readonly fields: readonly ManifestRowField[];
      };
  /** Whether it returns how many rows match before the window. */
  readonly total: boolean;
}

/** @experimental Settles when the composition API ships. */
export interface CompositionManifest {
  readonly formatVersion: typeof MANIFEST_FORMAT_VERSION;
  /** Where each kind of thing lives on this site, as it named them. */
  readonly collections: {
    readonly pages: string;
    readonly patterns: string;
    readonly components: string;
    /** The field of a component row its definition is stored in. */
    readonly componentField: string;
    readonly layouts: string;
    /**
     * The collection templates and entries' own designs are kept in, as the
     * host named it: the collection a page action on a template names, and
     * where a `templateAction`'s template ids live.
     */
    readonly templates: string;
  };
  readonly patterns: ManifestTier<ManifestPattern>;
  readonly components: ManifestTier<ManifestComponent>;
  readonly layouts: ManifestTier<ManifestLayout> & {
    /** The site default's id; null when none is set or the caller cannot read it. */
    readonly defaultLayout: string | null;
  };
  readonly actions: readonly ManifestAction[];
  /** The site's named queries, which a list's `namedQuery` may name. */
  readonly namedQueries: readonly ManifestNamedQuery[];
}

/**
 * One field of a named query's rows as the manifest lists it: its name and
 * type, and a group's own fields, however deep, so a client can address
 * every path a row's bindings may name (`seo.title`).
 *
 * @experimental Settles when the composition API ships.
 */
export interface ManifestRowField {
  readonly name: string;
  readonly type: string;
  readonly fields?: readonly ManifestRowField[];
}

const text = z.string();
const id = z.string().min(1);

/** A row field's schema, a group's own fields held to the same one. */
const rowFieldSchema: z.ZodType<ManifestRowField> = z.lazy(() =>
  z.strictObject({
    name: id,
    type: text,
    fields: z.array(rowFieldSchema).optional(),
  })
);

function tier<T extends z.ZodType>(item: T) {
  return z.strictObject({
    readable: z.boolean(),
    items: z.array(item),
    truncated: z.boolean(),
  });
}

/**
 * The manifest's schema: what `GET /manifest` and the service's `manifest`
 * answer. Every component carries its fields, slots and variants, empty
 * where it has none, so a client never meets a component it cannot address.
 *
 * @experimental Settles when the composition API ships.
 */
export const compositionManifestSchema: z.ZodType<CompositionManifest> =
  z.strictObject({
    formatVersion: z.literal(MANIFEST_FORMAT_VERSION),
    collections: z.strictObject({
      pages: id,
      patterns: id,
      components: id,
      componentField: id,
      layouts: id,
      templates: id,
    }),
    patterns: tier(
      z.strictObject({
        id,
        title: text,
        description: text.optional(),
        category: text.optional(),
        granularity: text.optional(),
      })
    ),
    components: tier(
      z.strictObject({
        id,
        title: text,
        description: text.optional(),
        category: text.optional(),
        fields: z.array(
          z.strictObject({
            id,
            label: text,
            type: text,
            options: z
              .array(z.strictObject({ value: text, label: text }))
              .optional(),
          })
        ),
        slots: z.array(
          z.strictObject({ id, label: text, allow: z.array(text).optional() })
        ),
        variants: z.array(z.strictObject({ id, label: text })),
      })
    ),
    layouts: tier(
      z.strictObject({
        id,
        title: text,
        published: z.boolean(),
        isDefault: z.boolean(),
        regions: z.array(
          z.strictObject({ area: z.enum(REGION_AREAS), componentId: id })
        ),
      })
    ).extend({ defaultLayout: id.nullable() }),
    actions: z.array(
      z.strictObject({
        name: z.enum(["pageAction", "definitionAction", "templateAction"]),
        method: z.literal("POST"),
        path: text,
        kinds: z.array(text),
        request: z.record(z.string(), z.unknown()),
      })
    ),
    namedQueries: z.array(
      z.strictObject({
        name: id,
        label: text,
        description: text.optional(),
        params: z.record(z.string(), z.unknown()),
        rows: z.union([
          z.strictObject({ collection: id }),
          z.strictObject({
            key: id,
            fields: z.array(rowFieldSchema),
          }),
        ]),
        total: z.boolean(),
      })
    ),
  });

/** What the manifest reads with besides the caller. */
export interface ManifestSetup {
  readonly store?: ComponentStore;
  readonly limits?: () => DocumentLimits;
  /** This site's named queries; none are listed when absent. */
  readonly namedQueries?: () => readonly NamedQueryDeclaration[];
}

/** What a manifest read is asked for. */
export interface ManifestRequest {
  /** The language component and Layout text is read in; none is the default. */
  readonly locale?: string;
}

/**
 * Read the manifest as the caller.
 *
 * @experimental Settles when the composition API ships.
 */
export async function readCompositionManifest(
  ctx: PluginRouteContext,
  setup: ManifestSetup,
  request: ManifestRequest = {}
): Promise<CompositionManifest> {
  if (ctx.user === null || ctx.caller === null) {
    throw NextlyError.forbidden({
      logContext: { reason: "composition-manifest-no-caller" },
    });
  }
  const store = storeOf(ctx, setup);
  const collections = {
    pages: ctx.self.collections[PAGES_SLUG] ?? PAGES_SLUG,
    patterns: ctx.self.collections[PATTERNS_SLUG] ?? PATTERNS_SLUG,
    components: store.collection,
    componentField: store.field,
    layouts: ctx.self.collections[LAYOUTS_SLUG] ?? LAYOUTS_SLUG,
    // Named, not read: a client needs the slug to address a template with
    // the page actions, whether or not it may read the templates.
    templates: ctx.self.collections[TEMPLATES_SLUG] ?? TEMPLATES_SLUG,
  };
  const [patterns, components, layouts] = await Promise.all([
    readableTier(ctx, collections.patterns, () => patternTier(ctx)),
    readableTier(ctx, collections.components, () =>
      componentTier(ctx, setup, request.locale)
    ),
    readableTier(ctx, collections.layouts, () =>
      layoutTier(ctx, setup, request.locale)
    ),
  ]);
  return {
    formatVersion: MANIFEST_FORMAT_VERSION,
    collections,
    patterns,
    components,
    layouts: { defaultLayout: null, ...layouts },
    actions: manifestActions(),
    namedQueries: (setup.namedQueries?.() ?? []).map(manifestNamedQuery),
  };
}

/** A row field as the manifest lists it: the editor's, without its kind. */
function manifestRowField(field: NamedQueryRowField): ManifestRowField {
  return {
    name: field.name,
    type: field.type,
    ...(field.fields === undefined
      ? {}
      : { fields: field.fields.map(manifestRowField) }),
  };
}

/**
 * One registered query as the manifest lists it, without its run function:
 * read off the declaration as the editor's route reads it
 * (`namedQueryItem`), so the two never list different rows.
 *
 * @experimental Settles when the composition API ships.
 */
export function manifestNamedQuery(
  definition: NamedQueryDeclaration
): ManifestNamedQuery {
  const item = namedQueryItem(definition);
  const rows = item.rows;
  return {
    name: item.name,
    label: item.label,
    ...(item.description === undefined
      ? {}
      : { description: item.description }),
    params: namedQueryParamsSchema(definition),
    rows:
      "fields" in rows
        ? { key: rows.key, fields: rows.fields.map(manifestRowField) }
        : { collection: rows.collection },
    total: item.total,
  };
}

/**
 * A part read only when the caller may read its collection at all, asked of
 * any entry: a rule limiting reads to some rows still lets the listing answer
 * those. A read the site refuses all the same is answered as unreadable.
 */
async function readableTier<
  R extends { items: readonly unknown[]; truncated: boolean },
>(
  ctx: PluginRouteContext,
  collection: string,
  read: () => Promise<R>
): Promise<(R & { readable: true }) | Unreadable> {
  const may =
    (await ctx.caller?.can("read", collection, { anyEntry: true })) === true;
  if (!may) return unreadable();
  try {
    return { ...(await read()), readable: true };
  } catch (error) {
    if (NextlyError.isForbidden(error)) return unreadable();
    throw error;
  }
}

interface Unreadable {
  readable: false;
  items: [];
  truncated: false;
}

function unreadable(): Unreadable {
  return { readable: false, items: [], truncated: false };
}

async function patternTier(ctx: PluginRouteContext) {
  const library = await readPatternLibrary(ctx);
  return {
    items: library.items.map(pattern => ({
      id: pattern.id,
      title: pattern.title,
      ...(pattern.description === undefined
        ? {}
        : { description: pattern.description }),
      ...(pattern.category === undefined ? {} : { category: pattern.category }),
      ...(pattern.granularity === undefined
        ? {}
        : { granularity: pattern.granularity }),
    })),
    truncated: library.meta.truncated,
  };
}

async function componentTier(
  ctx: PluginRouteContext,
  setup: ManifestSetup,
  locale: string | undefined
) {
  const library = await readComponentLibrary({
    ...ctx,
    components: directComponentReads(ctx, locale),
    store: setup.store ?? DEFAULT_COMPONENT_STORE,
  });
  return {
    items: library.items.map(component => ({
      id: component.id,
      title: component.title,
      ...(component.description === undefined
        ? {}
        : { description: component.description }),
      ...(component.category === undefined
        ? {}
        : { category: component.category }),
      ...componentFacts(component.document),
    })),
    truncated: library.meta.truncated,
  };
}

/**
 * The fields, slots and variants a placement addresses, read off the
 * definition: each by the stable id the actions take. A row holding no
 * definition offers none of them.
 */
export function componentFacts(
  document: ComponentDocument | null
): Pick<ManifestComponent, "fields" | "slots" | "variants"> {
  return {
    fields: (document?.exposed ?? []).map(field => ({
      id: field.id,
      label: field.label,
      type: field.type,
      ...(field.options === undefined
        ? {}
        : {
            options: field.options.map(option => ({
              value: option.value,
              label: option.label,
            })),
          }),
    })),
    slots: Object.entries(document?.slots ?? {}).map(([slotId, slot]) => ({
      id: slotId,
      label: slot.label,
      ...(slot.allow === undefined ? {} : { allow: [...slot.allow] }),
    })),
    variants: Object.entries(document?.variants ?? {}).map(
      ([variantId, variant]) => ({
        id: variantId,
        // A variant stored without a label is offered by its id, as the
        // editor's picker names it.
        label: variant.label === "" ? variantId : variant.label,
      })
    ),
  };
}

async function layoutTier(
  ctx: PluginRouteContext,
  setup: ManifestSetup,
  locale: string | undefined
) {
  const choices = await readLayoutChoices(ctx, await getCachedNextly(), {
    selected: null,
    fence: fenceStates(layoutRemovalStore(ctx.db, ctx.dialect)),
    store: setup.store ?? DEFAULT_COMPONENT_STORE,
    limits: setup.limits?.() ?? DEFAULT_LIMITS,
    ...(locale === undefined ? {} : { locale }),
  });
  const defaultLayout = choices.meta.defaultLayout;
  return {
    // A Layout behind Remove Layout's fence is refused by a page write, so
    // it is no choice to offer.
    items: choices.items
      .filter(layout => layout.removal === undefined)
      .map(layout => ({
        id: layout.id,
        title: layout.title,
        published: layout.published,
        isDefault: layout.id === defaultLayout,
        regions: layout.regions.map(region => ({
          area: region.area,
          componentId: region.componentId,
        })),
      })),
    truncated: choices.meta.more,
    defaultLayout,
  };
}

let actions: CompositionManifest["actions"] | undefined;

/**
 * The actions the manifest lists, built once: their schemas are fixed for
 * the life of the process. Each request's JSON Schema is the one its route
 * parses with: the route's envelope, with `action` the builder's schema.
 */
export function manifestActions(): CompositionManifest["actions"] {
  actions ??= [
    {
      name: "pageAction",
      method: "POST",
      path: PAGE_ACTIONS_ROUTE_PATH,
      kinds: [...PAGE_ACTION_KINDS],
      request: pageActionRequestJsonSchema(),
    },
    {
      name: "definitionAction",
      method: "POST",
      path: DEFINITION_ACTIONS_ROUTE_PATH,
      kinds: [...DEFINITION_ACTION_KINDS],
      request: definitionActionRequestJsonSchema(),
    },
    {
      name: "templateAction",
      method: "POST",
      path: TEMPLATE_ACTIONS_ROUTE_PATH,
      kinds: [...TEMPLATE_ACTION_KINDS],
      request: templateActionRequestJsonSchema(),
    },
  ];
  return actions;
}

/** What a manifest request may ask: a language, as a code. */
const ManifestRequestInput = z.strictObject({
  locale: z.string().max(LAYOUT_LOCALE_MAX).optional(),
});

/**
 * A manifest request read from outside input, the route's query or what a
 * caller of the service passed: an empty language is none, and one longer
 * than a language code is refused.
 */
export function manifestRequestFrom(raw: unknown): ManifestRequest {
  const { locale } = parsedWith(raw ?? {}, ManifestRequestInput);
  return locale === undefined || locale === "" ? {} : { locale };
}

/** The manifest route declaration. */
export function manifestRoute(setup: ManifestSetup = {}): {
  method: "GET";
  path: string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  return {
    method: "GET",
    path: MANIFEST_ROUTE_PATH,
    // Signed in is all reaching the route asks: each part is read only where
    // the caller may read its collection, and as the caller.
    handler: async (req, ctx) =>
      respondDoc(
        await readCompositionManifest(
          ctx,
          setup,
          manifestRequestFrom({
            locale:
              new URL(req.url).searchParams.get(MANIFEST_LOCALE_PARAM) ??
              undefined,
          })
        )
      ),
  };
}
