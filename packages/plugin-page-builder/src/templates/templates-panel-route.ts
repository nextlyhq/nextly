/**
 * `GET /templates/panel`: the collection templates the builder's Pages panel
 * lists, each with the collection it draws, its picture's document and the
 * entries it is used by.
 *
 * ## What is read, and as whom
 *
 * - Which collections: those the registry holds that the caller may read,
 *   each by its singular admin name. A template of a collection the caller cannot
 *   read is never named.
 * - The templates: one read AS THE CALLER, of those collections' templates
 *   (a collection has one), with every lifecycle state the caller may see.
 * - Their pictures: one read AS THE CALLER of the published documents, and
 *   their component definitions by the shared batched discovery
 *   (`publishedDefinitionsOf`), so a template draws as its published page.
 * - "Used by N entries": counted AS THE SYSTEM and answered as numbers only,
 *   as a set's page count is: the collection's entries, less those with a
 *   design of their own. Two counts per listed template, which is one per
 *   collection with a template.
 *
 * Gated by `read` on the templates collection, as the site named it.
 *
 * @experimental Settles when collection templates ship.
 * @module templates/templates-panel-route
 */
import type { BlockDocument, DocumentLimits } from "@nextlyhq/blocks-engine";
import type {
  getCachedNextly,
  PluginRouteContext,
  PluginRoutePermissionScope,
} from "@nextlyhq/plugin-sdk";
import type { WhereFilter } from "nextly";

import { labelOf } from "../collection-labels";
import { COMPONENTS_SLUG } from "../collections/components";
import {
  TEMPLATE_CONTENT_FIELD,
  TEMPLATES_SLUG,
} from "../collections/templates";
import { asDocument } from "../component-store-source";
import { chunked, ID_BATCH_SIZE } from "../id-batches";
import { readingAsUser, type ComponentStore } from "../library-route";
import {
  registryRecords,
  slugOf,
  type PageCollectionsContext,
} from "../pages-search-route";
import { publishedDefinitionsOf } from "../published-definitions";

import {
  TEMPLATE_COLLECTION_FIELD,
  TEMPLATE_ENTRY_COLLECTION_FIELD,
} from "./template-preview-contract";
import {
  TEMPLATES_PANEL_ROUTE_PATH,
  type PanelTemplate,
  type TemplatesPanelResponse,
} from "./templates-panel-contract";

/** One template row, as the list read answers it. */
interface TemplateRow {
  readonly id: string;
  readonly title: string;
  readonly collection: string;
  readonly status: string;
}

/**
 * What the read is made with, injected so the decisions below are tested
 * without a server.
 */
export interface TemplatesPanelReads {
  readonly templatesCollection: string;
  /** The collections the caller may read, each with its admin name. */
  collections(): Promise<ReadonlyArray<{ slug: string; label: string }>>;
  /** Those collections' templates, as the caller. */
  templates(collections: readonly string[]): Promise<readonly TemplateRow[]>;
  /** The published documents of these templates, by id, as the caller. */
  publishedDocuments(
    ids: readonly string[]
  ): Promise<ReadonlyMap<string, BlockDocument>>;
  /** How many entries the collection holds, counted as the system. */
  entryCount(collection: string): Promise<number>;
  /** How many of them a published design of their own serves, as the system. */
  ownDesignCount(collection: string): Promise<number>;
  /** Whether the caller may create a template at all. */
  mayCreateTemplates(): Promise<boolean>;
  /** The published definitions these documents reach, by id. */
  definitions(
    documents: readonly BlockDocument[]
  ): Promise<Record<string, BlockDocument>>;
}

/** Answer one read. */
export async function readTemplatesPanel(
  reads: TemplatesPanelReads
): Promise<TemplatesPanelResponse> {
  const collections = await reads.collections();
  const labels = new Map(collections.map(entry => [entry.slug, entry.label]));
  const meta = {
    templatesCollection: reads.templatesCollection,
    canCreateTemplates: await reads.mayCreateTemplates(),
  };
  if (collections.length === 0) {
    return { items: [], meta: { ...meta, definitions: {} } };
  }
  const rows = (await reads.templates(collections.map(entry => entry.slug)))
    // Only a collection's template: an entry's own design names none.
    .filter(row => labels.has(row.collection));
  const published = rows.filter(row => row.status === "published");
  const [documents, uses] = await Promise.all([
    published.length === 0
      ? Promise.resolve(new Map<string, BlockDocument>())
      : reads.publishedDocuments(published.map(row => row.id)),
    Promise.all(
      rows.map(async row => {
        const [entries, own] = await Promise.all([
          reads.entryCount(row.collection),
          reads.ownDesignCount(row.collection),
        ]);
        return Math.max(0, entries - own);
      })
    ),
  ]);
  const items: PanelTemplate[] = rows.map((row, index) => ({
    id: row.id,
    title: row.title,
    collection: row.collection,
    collectionLabel: labels.get(row.collection) ?? row.collection,
    published: row.status === "published",
    document: documents.get(row.id) ?? null,
    use: { entries: uses[index] ?? 0 },
  }));
  const drawn = items.flatMap(item =>
    item.document === null ? [] : [item.document]
  );
  return {
    items,
    meta: {
      ...meta,
      definitions: drawn.length === 0 ? {} : await reads.definitions(drawn),
    },
  };
}

/** A row's text value, or undefined. */
function textOf(
  row: Record<string, unknown>,
  field: string
): string | undefined {
  const value = row[field];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** A read answer's rows, whatever shape it came in. */
function rowsOf(found: { items?: unknown }): Record<string, unknown>[] {
  return Array.isArray(found.items)
    ? found.items.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null
      )
    : [];
}

/** The Direct API, as the plugin SDK resolves it per request. */
type PanelDirectApi = Awaited<ReturnType<typeof getCachedNextly>>;

type PanelRouteContext = PluginRouteContext & PageCollectionsContext;

/** The reads, through the Direct API, for one request. */
function directPanelReads(
  ctx: PanelRouteContext,
  nextly: PanelDirectApi,
  store: ComponentStore,
  limits: DocumentLimits
): TemplatesPanelReads {
  const templates = ctx.self.collections[TEMPLATES_SLUG] ?? TEMPLATES_SLUG;
  const components =
    store.collection ??
    ctx.self.collections[COMPONENTS_SLUG] ??
    COMPONENTS_SLUG;
  // A count only: one row asked for, the total read from the list meta.
  const total = async (
    collection: string,
    where?: WhereFilter,
    status?: "published"
  ): Promise<number> =>
    (
      await nextly.find({
        collection,
        ...(where === undefined ? {} : { where }),
        ...(status === undefined ? {} : { status }),
        select: { id: true },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      })
    ).meta.total;
  return {
    templatesCollection: templates,
    collections: async () => {
      const readable: Array<{ slug: string; label: string }> = [];
      for (const value of await registryRecords(ctx)) {
        if (typeof value !== "object" || value === null) continue;
        const record = value as Record<string, unknown>;
        const slug = slugOf(record);
        if (slug === undefined || readable.some(entry => entry.slug === slug)) {
          continue;
        }
        if ((await ctx.caller?.can("read", slug)) !== true) continue;
        readable.push({
          slug,
          // The collection's own name, as a row reads it: "Blog post".
          label: labelOf(record, slug),
        });
      }
      return readable;
    },
    templates: async slugs => {
      // In batches: a list read is clamped to its largest page, so one read
      // of many collections would answer for the first page only.
      const found = { items: [] as unknown[] };
      for (const batch of chunked(slugs, ID_BATCH_SIZE)) {
        const page = await nextly.find({
          collection: templates,
          where: { [TEMPLATE_COLLECTION_FIELD]: { in: batch } },
          select: {
            id: true,
            title: true,
            [TEMPLATE_COLLECTION_FIELD]: true,
            status: true,
          },
          status: "all",
          sort: "title",
          // A collection has one template, so the slugs bound the read.
          limit: batch.length,
          depth: 0,
          ...(await readingAsUser(ctx)),
        });
        found.items.push(...rowsOf(page));
      }
      // One order across the batches, by title, as one read would sort.
      return rowsOf(found)
        .flatMap(row => {
          const id = typeof row.id === "number" ? String(row.id) : row.id;
          const collection = textOf(row, TEMPLATE_COLLECTION_FIELD);
          if (typeof id !== "string" || collection === undefined) return [];
          return [
            {
              id,
              title: textOf(row, "title") ?? collection,
              collection,
              status: textOf(row, "status") ?? "draft",
            },
          ];
        })
        .sort((left, right) => left.title.localeCompare(right.title));
    },
    publishedDocuments: async ids => {
      const rows: Record<string, unknown>[] = [];
      // In batches, as the templates read is.
      for (const batch of chunked(ids, ID_BATCH_SIZE)) {
        const page = await nextly.find({
          collection: templates,
          where: { id: { in: batch } },
          select: { id: true, [TEMPLATE_CONTENT_FIELD]: true },
          status: "published",
          limit: batch.length,
          depth: 0,
          ...(await readingAsUser(ctx)),
        });
        rows.push(...rowsOf(page));
      }
      const documents = new Map<string, BlockDocument>();
      for (const row of rows) {
        const id = typeof row.id === "number" ? String(row.id) : row.id;
        const document = asDocument(row[TEMPLATE_CONTENT_FIELD]);
        if (typeof id === "string" && document !== null) {
          documents.set(id, document);
        }
      }
      return documents;
    },
    entryCount: collection => total(collection),
    // Only a PUBLISHED own design serves its entry: a draft one leaves the
    // entry drawn by the collection's template, as visitors see it.
    ownDesignCount: collection =>
      total(
        templates,
        { [TEMPLATE_ENTRY_COLLECTION_FIELD]: { equals: collection } },
        "published"
      ),
    mayCreateTemplates: async () =>
      (await ctx.caller?.can("create", templates, { anyEntry: true })) === true,
    definitions: async documents =>
      publishedDefinitionsOf(
        nextly,
        { collection: components, field: store.field, locale: undefined },
        documents,
        { reading: await readingAsUser(ctx), limits }
      ),
  };
}

/** The route declaration: `read` on the templates collection, as resolved. */
export function templatesPanelRoute(
  store: ComponentStore,
  limits: () => DocumentLimits
): {
  method: "GET";
  path: string;
  requiredPermission: (scope: PluginRoutePermissionScope) => string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  return {
    method: "GET",
    path: TEMPLATES_PANEL_ROUTE_PATH,
    requiredPermission: ({ collection }) => collection(TEMPLATES_SLUG, "read"),
    handler: async (_req, ctx) => {
      const { getCachedNextly } = await import("@nextlyhq/plugin-sdk");
      const nextly = await getCachedNextly();
      return Response.json(
        await readTemplatesPanel(directPanelReads(ctx, nextly, store, limits()))
      );
    },
  };
}
