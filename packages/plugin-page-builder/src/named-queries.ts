/**
 * Named queries in the page builder: where a site and its plugins register
 * them, and how their declarations reach the editor and the API.
 *
 * - **The site** passes `pageBuilder({ namedQueries })`.
 * - **A plugin** declares them under
 *   `contributes.declarations["@nextlyhq/plugin-page-builder"].namedQueries`,
 *   the channel its blocks already use, read at boot, so plugin order does
 *   not matter.
 *
 * Both are registered into the engine's process registry on every boot, all
 * or nothing: a malformed query or a name taken twice stops the boot, naming
 * the source. A declared collection or Single the code's configuration does
 * not name is logged rather than refused, since a collection made in the
 * admin is not in it.
 *
 * The run function never leaves the server. The editor, the composition
 * manifest and the validator read each query's declaration without it.
 *
 * @module named-queries
 */
import {
  createNamedQueryRegistry,
  listFieldKind,
  NAMED_QUERY_TEXT_MAX,
  namedQueryNeedsInput,
  namedQueryParamNeedsInput,
  type BindingFieldShape,
  type NamedQueryDeclaration,
  type NamedQueryDefinition,
  type NamedQueryKnown,
  type NamedQueryParam,
  type NamedQueryRegistry,
  type NumberParam,
} from "@nextlyhq/blocks-engine";
import {
  collectDeclarations,
  respondList,
  type PaginationMeta,
  type PluginContext,
  type PluginDeclaration,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import { z } from "nextly/zod";

import { PAGE_BUILDER_PLUGIN } from "./blocks/registration-service";
import { pluralLabelOf } from "./collection-labels";
import { ENTRIES_LOCALE_MAX } from "./entries-contract";
import { publicReadsNothing } from "./fields/list-query-judgement";
import {
  NAMED_QUERIES_PARAMS,
  NAMED_QUERIES_ROUTE_PATH,
  type NamedQueriesResponse,
  type NamedQueryInputItem,
  type NamedQueryItem,
} from "./named-queries-contract";
import { optionalText, parseRouteQuery } from "./route-query";

/** Where a site's own queries are said to come from, in a boot error. */
const SITE_SOURCE = "pageBuilder({ namedQueries })";

/**
 * The named queries in one plugin's declaration, or why its `namedQueries`
 * is not a list. Nothing for a declaration this reader does not understand,
 * as `blocksIn` does: another version of the page builder may read keys this
 * one does not.
 */
function namedQueriesIn(declaration: PluginDeclaration): {
  queries: NamedQueryDefinition[];
  error?: string;
} {
  const value = declaration.value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { queries: [] };
  }
  const declared = (value as { namedQueries?: unknown }).namedQueries;
  if (declared === undefined) return { queries: [] };
  if (!Array.isArray(declared)) {
    return {
      queries: [],
      error:
        `"${declaration.source}" declared namedQueries for the page builder as ` +
        `${typeof declared}; it must be an array of defineNamedQuery definitions.`,
    };
  }
  return { queries: declared as NamedQueryDefinition[] };
}

/** The slugs a frozen configuration list names. */
function slugsOf(entries: unknown): ReadonlySet<string> {
  const slugs = new Set<string>();
  if (!Array.isArray(entries)) return slugs;
  for (const entry of entries) {
    const slug = (entry as { slug?: unknown } | null)?.slug;
    if (typeof slug === "string") slugs.add(slug);
  }
  return slugs;
}

/**
 * This boot's named queries: the site's, then each plugin's declared ones,
 * in a registry of their own. Each page builder keeps its own, so two sites
 * booted in one process never resolve each other's queries. Throws, naming
 * the source, for a query the engine refuses or a name taken twice.
 */
export function registerNamedQueriesAtBoot(
  ctx: Pick<PluginContext, "config" | "logger">,
  site: readonly NamedQueryDefinition[] | undefined
): NamedQueryRegistry {
  const registry = createNamedQueryRegistry();
  const collections = slugsOf(ctx.config.collections);
  const singles = slugsOf(ctx.config.singles);
  const known: NamedQueryKnown = {
    collection: slug => collections.has(slug),
    single: slug => singles.has(slug),
  };
  const unknownReads = [
    ...registry.register(site ?? [], { source: SITE_SOURCE, known })
      .unknownReads,
  ];
  for (const declaration of collectDeclarations(
    ctx.config.plugins ?? [],
    PAGE_BUILDER_PLUGIN
  )) {
    const { queries, error } = namedQueriesIn(declaration);
    if (error !== undefined) throw new Error(error);
    unknownReads.push(
      ...registry.register(queries, {
        source: declaration.source,
        known,
      }).unknownReads
    );
  }
  if (unknownReads.length > 0) {
    ctx.logger.warn(
      `[page-builder] Named queries declare reads this site's code does not configure: ${unknownReads.join("; ")}. ` +
        "A read of one that does not exist fails the query's list, which then shows its empty state."
    );
  }
  return registry;
}

/** An input's declaration, as the editor draws its control. */
function inputItem(key: string, param: NamedQueryParam): NamedQueryInputItem {
  const optional = <K extends string, V>(name: K, value: V | undefined) =>
    value === undefined ? {} : ({ [name]: value } as Record<K, V>);
  return {
    key,
    type: param.type,
    label: param.label,
    needsInput: namedQueryParamNeedsInput(param),
    required: param.type !== "boolean" && param.required === true,
    ...optional("default", param.type === "entry" ? undefined : param.default),
    ...(param.type === "choice" ? { options: param.options } : {}),
    ...(param.type === "entry" ? { collection: param.collection } : {}),
    ...(param.type === "number"
      ? {
          ...optional("unit", param.unit),
          ...optional("min", param.min),
          ...optional("max", param.max),
          ...optional("integer", param.integer),
        }
      : {}),
    ...(param.type === "text"
      ? {
          maxLength: Math.min(
            param.maxLength ?? NAMED_QUERY_TEXT_MAX,
            NAMED_QUERY_TEXT_MAX
          ),
          ...optional("placeholder", param.placeholder),
        }
      : {}),
  };
}

/** A row field as the binding picker lists it. */
function rowField(shape: BindingFieldShape): {
  name: string;
  type: string;
  kind?: ReturnType<typeof listFieldKind>;
} {
  const kind = listFieldKind(shape);
  return {
    name: shape.name,
    type: shape.type,
    ...(kind === undefined ? {} : { kind }),
  };
}

/**
 * One query's declaration as the editor and the API read it. `readsHidden`
 * names the declared collections visitors can read nothing of.
 */
export function namedQueryItem(
  declaration: NamedQueryDeclaration,
  readsHidden: readonly string[] = []
): NamedQueryItem {
  const rows = declaration.rows;
  return {
    name: declaration.name,
    label: declaration.label,
    ...(declaration.description === undefined
      ? {}
      : { description: declaration.description }),
    inputs: Object.entries(declaration.params ?? {}).map(([key, param]) =>
      inputItem(key, param)
    ),
    rows:
      "fields" in rows
        ? { key: rows.key, fields: rows.fields.map(rowField) }
        : { collection: rows.collection },
    total: declaration.total === true,
    needsInput: namedQueryNeedsInput(declaration),
    reads: {
      collections: [...(declaration.reads.collections ?? [])],
      singles: [...(declaration.reads.singles ?? [])],
      site: declaration.reads.site === true,
    },
    readsHidden: [...readsHidden],
  };
}

/**
 * A number input's type and bounds as JSON Schema: those it declares, and
 * for a whole number the safe range too, which the save holds it to
 * (`Number.isSafeInteger`), clipped by any it declares.
 */
function numberBounds(param: NumberParam): Record<string, unknown> {
  if (param.integer !== true) {
    return {
      type: "number",
      ...(param.min === undefined ? {} : { minimum: param.min }),
      ...(param.max === undefined ? {} : { maximum: param.max }),
    };
  }
  return {
    type: "integer",
    minimum: Math.max(
      param.min ?? Number.MIN_SAFE_INTEGER,
      Number.MIN_SAFE_INTEGER
    ),
    maximum: Math.min(
      param.max ?? Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER
    ),
  };
}

/** One input as JSON Schema, for a client composing a list's inputs. */
function inputSchema(param: NamedQueryParam): Record<string, unknown> {
  const titled = { title: param.label };
  switch (param.type) {
    case "text":
      return {
        ...titled,
        type: "string",
        maxLength: Math.min(
          param.maxLength ?? NAMED_QUERY_TEXT_MAX,
          NAMED_QUERY_TEXT_MAX
        ),
      };
    case "number":
      return { ...titled, ...numberBounds(param) };
    case "boolean":
      return { ...titled, type: "boolean" };
    case "choice":
      return { ...titled, enum: param.options.map(option => option.value) };
    case "day":
      return { ...titled, type: "string", format: "date" };
    case "entry":
      // The bounds the save holds an entry's id to (`judgeNamedParams`), so
      // a request the schema accepts is one the save takes.
      return {
        ...titled,
        description: `The id of an entry of "${param.collection}".`,
        anyOf: [
          { type: "string", minLength: 1, maxLength: NAMED_QUERY_TEXT_MAX },
          {
            type: "integer",
            minimum: Number.MIN_SAFE_INTEGER,
            maximum: Number.MAX_SAFE_INTEGER,
          },
        ],
      };
  }
}

/**
 * A query's inputs as one JSON Schema object: what a list's
 * `namedQuery.params` may hold, the required inputs with no default named.
 */
export function namedQueryParamsSchema(
  declaration: NamedQueryDeclaration
): Record<string, unknown> {
  const entries = Object.entries(declaration.params ?? {});
  const required = entries
    .filter(([, param]) => namedQueryParamNeedsInput(param))
    .map(([key]) => key);
  return {
    type: "object",
    additionalProperties: false,
    properties: Object.fromEntries(
      entries.map(([key, param]) => [key, inputSchema(param)])
    ),
    ...(required.length === 0 ? {} : { required }),
  };
}

/** What the route reads, so it can be answered without a live instance. */
export interface NamedQueriesReads {
  /** Every registered query. */
  readonly queries: () => readonly NamedQueryDeclaration[];
  /**
   * The fields of a collection the public may read, as `bindingFieldShapes`
   * answers: `undefined` when the public may read none of it, an empty list
   * when it may read the collection but none of its own fields.
   */
  readonly publicFields: (
    slug: string,
    locale?: string
  ) => Promise<readonly BindingFieldShape[] | undefined>;
  /** What authors call a collection. */
  readonly collectionLabel: (slug: string) => Promise<string>;
}

/** The meta of an answer that is the whole list on one page. */
function onePage(total: number): PaginationMeta {
  return {
    total,
    page: 1,
    limit: Math.max(total, 1),
    totalPages: total === 0 ? 0 : 1,
    hasNext: false,
    hasPrev: false,
  };
}

/**
 * Every registered query's declaration, with the collections each reads
 * that visitors can read nothing of, judged in `locale`. Each collection is
 * judged once, however many queries read it.
 */
export async function readNamedQueries(
  reads: NamedQueriesReads,
  locale?: string
): Promise<NamedQueriesResponse> {
  const queries = reads.queries();
  const slugs = [
    ...new Set(queries.flatMap(query => query.reads.collections ?? [])),
  ];
  const hidden = new Map<string, string>();
  await Promise.all(
    slugs.map(async slug => {
      // A read that fails says nothing about access: judged as unreadable,
      // so the author is warned rather than told all is well.
      const fields = await reads
        .publicFields(slug, locale)
        .catch(() => undefined);
      if (publicReadsNothing(fields)) {
        hidden.set(slug, await reads.collectionLabel(slug));
      }
    })
  );
  const items = queries.map(query =>
    namedQueryItem(
      query,
      (query.reads.collections ?? []).flatMap(slug => {
        const label = hidden.get(slug);
        return label === undefined ? [] : [label];
      })
    )
  );
  return { items, meta: onePage(items.length) };
}

/** The route's query: the language visitors' access is judged in, if any. */
const NAMED_QUERIES_QUERY = z.object({
  [NAMED_QUERIES_PARAMS.locale]: optionalText(ENTRIES_LOCALE_MAX),
});

/** The reads the live route makes: the registry, and the public's fields. */
function directReads(
  ctx: PluginRouteContext,
  queries: () => readonly NamedQueryDeclaration[]
): NamedQueriesReads {
  return {
    queries,
    publicFields: async (slug, locale) => {
      // Imported at call time, as the loop collections route does, so
      // loading this module costs none of the runtime.
      const { bindingFieldShapes } = await import("nextly/runtime");
      return bindingFieldShapes(
        { collection: slug },
        locale === undefined ? {} : { locale }
      );
    },
    collectionLabel: async slug => {
      const record: unknown = await ctx.services.collections
        .getCollection(slug, {})
        .catch(() => undefined);
      return typeof record === "object" && record !== null
        ? (pluralLabelOf(record as Record<string, unknown>).pluralLabel ?? slug)
        : slug;
    },
  };
}

/**
 * The route declaration: every registered named query, without its run
 * function. Authenticated (no `public: true`) with no permission of its
 * own: a declaration is the site's code, which any editor may see named,
 * and it reads no entry.
 */
export function namedQueriesRoute(
  queries: () => readonly NamedQueryDeclaration[]
): {
  method: "GET";
  path: string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  return {
    method: "GET",
    path: NAMED_QUERIES_ROUTE_PATH,
    handler: async (req, ctx) => {
      const query = parseRouteQuery(
        req.url,
        Object.values(NAMED_QUERIES_PARAMS),
        NAMED_QUERIES_QUERY,
        "named queries route"
      );
      const answer = await readNamedQueries(
        directReads(ctx, queries),
        query[NAMED_QUERIES_PARAMS.locale]
      );
      return respondList([...answer.items], answer.meta);
    },
  };
}
