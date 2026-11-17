/**
 * Which document defines a form, as a post names it, and that form's node as
 * the document is published.
 *
 * A form is defined in exactly one document: a page, a collection's template,
 * a component, or the component a published header & footer set places in
 * one of its areas. The post names that document and the node's id; the
 * receiver reads the document's PUBLISHED form and takes the node from it,
 * so a field list, an address or a message is never taken from the browser,
 * and a node that is only in a draft is not found.
 *
 * Each document is read the way the live page reads it: a page and a
 * template as the public, with the collection's access rules applied; a
 * component, and a header & footer set, as the system, which is how the
 * renderer reads what a visitor's page embeds.
 *
 * A form inside a component the document places is drawn under an id the
 * composition derives from the placement, which no stored document holds.
 * Such a node is found by composing the document with its components'
 * published definitions, as the renderer composes it.
 *
 * @module forms/defining-document
 */
import {
  composeEntryContent,
  DEFAULT_LIMITS,
  DOCUMENT_FORMAT_VERSION,
  findNode,
  regionsOf,
  REGION_AREAS,
  regionDocument,
  resolveComponentInstances,
  type BlockDocument,
  type BlockNode,
  type DocumentLimits,
  type RegionArea,
} from "@nextlyhq/blocks-engine";
import {
  definitionsFor,
  repairingLookup,
  sanitizeDocument,
} from "@nextlyhq/blocks-react";

import { PAGES_CONTENT_FIELD } from "../collections/pages";
import {
  entryDesignKey,
  TEMPLATE_COLLECTION_FIELD,
  TEMPLATE_CONTENT_FIELD,
  TEMPLATE_ENTRY_FIELD,
} from "../collections/templates";
import {
  AS_THE_SYSTEM,
  asDocument,
  publishedStoreSource,
  type StoreSourceDirectApi,
  type SystemReading,
} from "../component-store-source";

/** The document a post names as the one defining its form. */
export type DefiningDocument =
  | { readonly kind: "page" | "template" | "component"; readonly id: string }
  | { readonly kind: "layout"; readonly id: string; readonly area: RegionArea }
  | {
      /**
       * A collection's entry drawn by its design (its own, or its
       * collection's template), with its own blocks composed into the
       * design's Entry content, as its page draws it.
       */
      readonly kind: "entry";
      readonly collection: string;
      readonly id: string;
    };

/** An id as a post may name it; anything else names nothing. */
const ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Read the hidden field naming the defining document: `page:<id>`,
 * `template:<id>`, `component:<id>`, `layout:<id>:<area>` or
 * `entry:<collection>:<id>`. `null` for anything else, which the receiver
 * refuses.
 */
export function parseDefiningDocument(
  raw: string | undefined
): DefiningDocument | null {
  if (raw === undefined) return null;
  const parts = raw.split(":");
  const [kind, id, area] = parts;
  if (id === undefined || !ID.test(id)) return null;
  if (kind === "entry") {
    // `entry:<collection>:<id>`: the collection where the others name an id.
    return parts.length === 3 && area !== undefined && ID.test(area)
      ? { kind, collection: id, id: area }
      : null;
  }
  if (kind === "layout") {
    if (parts.length !== 3) return null;
    const known = REGION_AREAS.find(candidate => candidate === area);
    return known === undefined ? null : { kind, id, area: known };
  }
  if (parts.length !== 2) return null;
  if (kind === "page" || kind === "template" || kind === "component") {
    return { kind, id };
  }
  return null;
}

/** The hidden field's value naming `document`: the inverse of {@link parseDefiningDocument}. */
export function definingDocumentValue(document: DefiningDocument): string {
  if (document.kind === "layout") {
    return `layout:${document.id}:${document.area}`;
  }
  if (document.kind === "entry") {
    return `entry:${document.collection}:${document.id}`;
  }
  return `${document.kind}:${document.id}`;
}

/** A published read through the Direct API, as the public or as the system. */
export interface PublishedReadApi extends StoreSourceDirectApi<SystemReading> {
  find(args: { readonly collection: string }): Promise<{ items: unknown[] }>;
}

/** Where each kind of defining document is stored on this site. */
export interface DefiningStores {
  readonly pages: string;
  readonly templates: string;
  readonly layouts: string;
  /** The component store: its collection and the field holding a document. */
  readonly components: { readonly collection: string; readonly field: string };
}

/**
 * The node `nodeId` in the published form of `document`, or `null` when the
 * document is not published, cannot be read as a document, or holds no such
 * node.
 */
export async function publishedNode(
  api: PublishedReadApi,
  stores: DefiningStores,
  document: DefiningDocument,
  nodeId: string,
  locale: string | undefined,
  /** The site's document limits, which its pages are drawn under. */
  limits: DocumentLimits = DEFAULT_LIMITS
): Promise<BlockNode | null> {
  const nodes = await publishedNodes(api, stores, document, locale);
  if (nodes === null) return null;
  const found =
    findNode(nodes, nodeId) ??
    (await composedNode(api, stores, nodes, nodeId, locale, limits));
  if (found !== null || document.kind !== "component") return found;
  // A component a Layout places in its header or footer is drawn through
  // that region's placement, which gives its nodes ids of their own.
  for (const area of REGION_AREAS) {
    const placed = await composedNode(
      api,
      stores,
      regionDocument([{ area, componentId: document.id }]).nodes,
      nodeId,
      locale,
      limits
    );
    if (placed !== null) return placed;
  }
  return null;
}

/**
 * The node `nodeId` of `nodes` composed with the published definitions of
 * the components they place, as the renderer composes a page, or `null`.
 * Asked only once the stored nodes do not hold the id, so a document
 * placing no component reads nothing more.
 */
async function composedNode(
  api: PublishedReadApi,
  stores: DefiningStores,
  nodes: BlockNode[],
  nodeId: string,
  locale: string | undefined,
  limits: DocumentLimits
): Promise<BlockNode | null> {
  const document: BlockDocument = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes,
  };
  const read = publishedStoreSource(api, {
    collection: stores.components.collection,
    field: stores.components.field,
    locale,
    reading: AS_THE_SYSTEM,
  });
  const definitions = await definitionsFor(
    document,
    async ids => {
      const found = await read(ids);
      const readable = new Map<string, BlockDocument>();
      for (const [id, value] of found) {
        const definition = asDocument(value);
        if (definition !== null) readable.set(id, definition);
      }
      return readable;
    },
    limits
  );
  if (definitions.size === 0) return null;
  // The renderer's first passes, in its order: shape repair, then
  // composition, which is what derives each placed node's id.
  const composed = resolveComponentInstances(
    sanitizeDocument(document, limits),
    repairingLookup(definitions, limits),
    { limits: limits }
  );
  return findNode(composed.document.nodes, nodeId) ?? null;
}

/** The published node list of `document`, or `null`. */
async function publishedNodes(
  api: PublishedReadApi,
  stores: DefiningStores,
  document: DefiningDocument,
  locale: string | undefined
): Promise<BlockNode[] | null> {
  const language = locale === undefined ? {} : { locale };
  switch (document.kind) {
    case "page":
    case "template": {
      const collection =
        document.kind === "page" ? stores.pages : stores.templates;
      const field =
        document.kind === "page" ? PAGES_CONTENT_FIELD : TEMPLATE_CONTENT_FIELD;
      const row = await onePublished(api, collection, document.id, {
        overrideAccess: false,
        ...language,
      });
      return nodesOf(row?.[field]);
    }
    case "component":
      return componentNodes(api, stores, document.id, locale);
    case "entry":
      return entryDrawnNodes(api, stores, document, locale);
    case "layout": {
      const row = await onePublished(api, stores.layouts, document.id, {
        ...AS_THE_SYSTEM,
        ...language,
      });
      if (row === null) return null;
      const region = regionsOf(row).find(
        candidate => candidate.area === document.area
      );
      return region === undefined
        ? null
        : componentNodes(api, stores, region.componentId, locale);
    }
  }
}

/** The published row `id` of `collection`, read as `reading` says, or `null`. */
async function onePublished(
  api: PublishedReadApi,
  collection: string,
  id: string,
  reading: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  const args: { readonly collection: string } & Record<string, unknown> = {
    ...reading,
    collection,
    where: { id: { equals: id } },
    status: "published",
    limit: 1,
    depth: 0,
  };
  const { items } = await api.find(args);
  const row = items[0] as Record<string, unknown> | undefined;
  // Compared again exactly, and by the id asked for: a database may compare
  // text loosely, and an `afterRead` hook may rewrite what it returns.
  return row !== undefined && row.id === id ? row : null;
}

/**
 * A collection entry's page as drawn: its design, its own published design
 * first and else its collection's, with the entry's blocks composed into the
 * design's Entry content, each read as the public reads them, as the
 * entry's page is.
 */
async function entryDrawnNodes(
  api: PublishedReadApi,
  stores: DefiningStores,
  document: { readonly collection: string; readonly id: string },
  locale: string | undefined
): Promise<BlockNode[] | null> {
  const language = locale === undefined ? {} : { locale };
  const entry = await onePublished(api, document.collection, document.id, {
    overrideAccess: false,
    ...language,
  });
  if (entry === null) return null;
  const own = entryDesignKey(document.collection, document.id);
  const { items } = await api.find({
    collection: stores.templates,
    where: {
      or: [
        { [TEMPLATE_ENTRY_FIELD]: { equals: own } },
        { [TEMPLATE_COLLECTION_FIELD]: { equals: document.collection } },
      ],
    },
    status: "published",
    overrideAccess: false,
    limit: 2,
    depth: 0,
    ...language,
  } as never);
  const rows = items as readonly Record<string, unknown>[];
  // Compared again exactly, the own design first, as the route draws it.
  const design =
    rows.find(row => row[TEMPLATE_ENTRY_FIELD] === own) ??
    rows.find(row => row[TEMPLATE_COLLECTION_FIELD] === document.collection);
  const drawn = asDocument(design?.[TEMPLATE_CONTENT_FIELD]);
  if (drawn === null) return null;
  return composeEntryContent(drawn, { valueOf: field => entry[field] }).nodes;
}

/** A published component's node list, read as the renderer reads it. */
async function componentNodes(
  api: PublishedReadApi,
  stores: DefiningStores,
  id: string,
  locale: string | undefined
): Promise<BlockNode[] | null> {
  const read = publishedStoreSource(api, {
    collection: stores.components.collection,
    field: stores.components.field,
    locale,
    reading: AS_THE_SYSTEM,
  });
  const found = await read([id]);
  return nodesOf(found.get(id));
}

/** A stored blocks value's node list, or `null` when it is not a document. */
function nodesOf(value: unknown): BlockNode[] | null {
  return asDocument(value)?.nodes ?? null;
}
