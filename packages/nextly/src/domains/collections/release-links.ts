/**
 * What a document links to as it would go live, for a release's checks.
 *
 * A release publishes a document's working draft where it has one, and its
 * stored content otherwise, so its links are read from the same place, as
 * storage holds it: `releaseGoingLiveDocuments` for a collection's entries and
 * `releaseGoingLiveDocument` for a Single. Neither runs read hooks or a
 * reader's access, so a hook that hides a value from readers does not hide a
 * link that is stored, and neither creates a Single's row.
 *
 * Links are found by the one walk over relationship and upload fields that
 * the version preview uses ({@link walkReferenceFields}), into groups,
 * repeaters, components and dynamic zones alike, and each value is read as
 * expansion reads it ({@link relationshipTargetsOf}).
 *
 * What a reader may see of those links is judged on the very document they
 * were read from ({@link ScannedDocument}), never on a second reading of it,
 * and field by field, by each field's own key.
 *
 * @module domains/collections/release-links
 * @experimental
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import type { FieldConfig } from "../../collections/fields/types";
import { container } from "../../di/container";
import type { CollectionsHandler } from "../../services/collections-handler";
import {
  applyFieldReadAccess,
  callerAccessGrants,
} from "../../shared/lib/field-level-registry";
import type { FieldGroupDataService } from "../field-groups/services/field-group-data-service";
import type { ReleaseCheckScope } from "../releases/readiness/check-sources";
import type {
  DocumentLink,
  ReleaseLinkReads,
  ScannedLinks,
} from "../releases/readiness/unpublished-links";
import { idBatches } from "../releases/releases-repository";
import type { SingleEntryService } from "../singles/services/single-entry-service";
import { applyComponentReadAccess } from "../versions/component-read-access";
import { walkReferenceFields } from "../versions/snapshot-references";
import { resolveComponentFieldMap } from "../versions/tag-component-types";

import { relationshipTargetsOf } from "./services/collection-relationship-service";
import {
  collectionFields,
  collectionTableName,
} from "./services/collection-utils";

/**
 * The document a document's links were read from, held to judge what a
 * reader may see of them.
 *
 * `data` is the walk's own copy, and `keys` names each object in it that
 * holds a link field, so a field's key is that object and the field's name:
 * unique in the document whatever its path.
 *
 * @experimental
 */
export interface ScannedDocument {
  kind: "collection" | "single";
  slug: string;
  /** The schema's fields as stored, which the read rules are judged by. */
  fields: readonly FieldConfig[];
  /** The same fields with their components' schemas, as the walk reads them. */
  enriched: readonly FieldConfig[];
  data: Record<string, unknown>;
  keys: WeakMap<object, number>;
}

/**
 * Where a link sits, for a reader: the top-level field, then the field
 * holding the value when that is a different one inside it, such as
 * `meta.editor` or `blocks.cite`. Levels between the two are not named, so
 * two fields can share a path; their keys never do.
 */
function fieldPath(top: string, leaf: string): string {
  return top === leaf ? top : `${top}.${leaf}`;
}

/**
 * Run the reference walk over `data` one top-level field at a time, so each
 * leaf it reaches is reported with the field path it sits under and the
 * object holding it.
 */
function eachReference(
  fields: readonly FieldConfig[],
  data: Record<string, unknown>,
  visit: (
    field: FieldConfig,
    holder: Record<string, unknown>,
    name: string,
    path: string
  ) => void
): void {
  for (const top of fields) {
    const name = (top as { name?: unknown }).name;
    walkReferenceFields(
      data,
      [top],
      (field, holder, leaf) =>
        visit(
          field,
          holder,
          leaf,
          typeof name === "string" && name !== "" ? fieldPath(name, leaf) : leaf
        ),
      false,
      // Every link, protected ones too: what a reader may see of them is
      // judged by the field rules themselves.
      { includeReadRuleFields: true }
    );
  }
}

/**
 * Every document `data` links to through its relationship and upload fields,
 * one level deep: its own fields at any nesting, components and dynamic zones
 * included, but never the links of the documents it links to, with the
 * document they were read from.
 *
 * `enriched` are the schema's fields with their components' schemas, as the
 * walk reads them.
 *
 * @experimental
 */
export function linksInDocument(
  enriched: readonly FieldConfig[],
  data: Record<string, unknown>
): {
  links: DocumentLink[];
  data: Record<string, unknown>;
  keys: WeakMap<object, number>;
} {
  // The walk normalises what it reads in place, so it reads a copy.
  const copy = structuredClone(data);
  const keys = new WeakMap<object, number>();
  let numbered = 0;
  const numberOf = (holder: object): number => {
    let number = keys.get(holder);
    if (number === undefined) {
      number = numbered++;
      keys.set(holder, number);
    }
    return number;
  };
  const links: DocumentLink[] = [];
  eachReference(enriched, copy, (field, holder, name, path) => {
    const fieldKey = `${numberOf(holder)}:${name}`;
    for (const target of relationshipTargetsOf(
      field as unknown as Parameters<typeof relationshipTargetsOf>[0],
      holder[name]
    )) {
      links.push({
        field: path,
        fieldKey,
        collection: target.collection,
        entryId: target.id,
      });
    }
  });
  return { links, data: copy, keys };
}

/**
 * A deep copy of plain document data, with each copied object mapped back to
 * the one it was copied from.
 */
function copiedWithOrigins(
  data: unknown,
  origins: WeakMap<object, object>
): unknown {
  if (Array.isArray(data)) {
    const copy = data.map(item => copiedWithOrigins(item, origins));
    origins.set(copy, data);
    return copy;
  }
  if (data instanceof Date) return new Date(data.getTime());
  if (typeof data !== "object" || data === null) return data;
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    copy[key] = copiedWithOrigins(value, origins);
  }
  origins.set(copy, data);
  return copy;
}

/**
 * The keys of a scanned document's link fields a reader may view: a copy of
 * that same document with the field read rules applied for the reader, the
 * document's own and each component's, as a read applies them; then walked
 * as it was scanned. A field the rules removed, anywhere, is not among them.
 * Rules that cannot be evaluated show no field at all.
 *
 * @experimental
 */
export async function linkFieldKeysVisibleIn(
  scanned: ScannedDocument,
  caller: {
    user: Record<string, unknown>;
    authenticatedScope?: AuthenticatedScope;
  }
): Promise<Set<string>> {
  const origins = new WeakMap<object, object>();
  const entry = copiedWithOrigins(scanned.data, origins) as Record<
    string,
    unknown
  >;
  const grants = callerAccessGrants(caller.user, caller.authenticatedScope);
  try {
    await applyFieldReadAccess({
      kind: scanned.kind,
      slug: scanned.slug,
      entry,
      user: caller.user,
      ...(caller.authenticatedScope
        ? { authenticatedScope: caller.authenticatedScope }
        : {}),
      grants,
      overrideAccess: false,
    });
    await applyComponentReadAccess(
      entry,
      scanned.fields,
      await componentFieldsOf(scanned.fields),
      {
        user: caller.user,
        ...(caller.authenticatedScope
          ? { authenticatedScope: caller.authenticatedScope }
          : {}),
        grants,
      }
    );
  } catch {
    return new Set();
  }
  const visible = new Set<string>();
  eachReference(scanned.enriched, entry, (_field, holder, name) => {
    const origin = origins.get(holder);
    if (origin === undefined) return;
    const number = scanned.keys.get(origin);
    if (number !== undefined) visible.add(`${number}:${name}`);
  });
  return visible;
}

/** The current fields of the components `fields` reach, by slug. */
async function componentFieldsOf(
  fields: readonly FieldConfig[]
): Promise<Map<string, FieldConfig[]>> {
  if (!container.has("fieldGroupDataService")) return new Map();
  const service = container.get<FieldGroupDataService>("fieldGroupDataService");
  return resolveComponentFieldMap([...fields], slug =>
    service.getComponentFields(slug)
  );
}

/** The registry record of a collection or Single, or `null`. */
async function registryRecord(
  kind: "collection" | "single",
  slug: string
): Promise<Record<string, unknown> | null> {
  const key =
    kind === "single" ? "singleRegistryService" : "collectionRegistryService";
  if (!container.has(key)) return null;
  const registry = container.get<{
    getCollectionBySlug?: (slug: string) => Promise<unknown>;
    getSingleBySlug?: (slug: string) => Promise<unknown>;
  }>(key);
  const record = await (kind === "single"
    ? registry.getSingleBySlug?.(slug)
    : registry.getCollectionBySlug?.(slug));
  return typeof record === "object" && record !== null
    ? (record as Record<string, unknown>)
    : null;
}

/** A schema's fields, enriched with the component schemas the walk reads. */
async function enrichedFields(
  fields: readonly FieldConfig[]
): Promise<FieldConfig[]> {
  if (!container.has("fieldGroupRegistryService")) return [...fields];
  const registry = container.get<{
    enrichFieldsWithComponentSchemas(
      fields: Record<string, unknown>[]
    ): Promise<unknown[]>;
  }>("fieldGroupRegistryService");
  return (await registry.enrichFieldsWithComponentSchemas(
    fields as unknown as Record<string, unknown>[]
  )) as unknown as FieldConfig[];
}

/**
 * The documents of one scope as they would go live, keyed by entry id, read
 * in runs the parameter limit admits. A document that is not there is
 * absent.
 */
async function goingLiveDocuments(
  scope: ReleaseCheckScope,
  entryIds: readonly string[]
): Promise<Map<string, Record<string, unknown>>> {
  const documents = new Map<string, Record<string, unknown>>();
  if (scope.scopeKind !== "single") {
    const handler = container.get<CollectionsHandler>("collectionsHandler");
    for (const run of idBatches(entryIds)) {
      const read = await handler.releaseGoingLiveDocuments({
        collectionName: scope.scopeSlug,
        entryIds: run,
      });
      for (const [id, document] of read) documents.set(id, document);
    }
    return documents;
  }
  const single = await container
    .get<SingleEntryService>("singleEntryService")
    .releaseGoingLiveDocument({ slug: scope.scopeSlug });
  // Only a member naming the Single's current row is answered about it.
  if (single !== null && entryIds.includes(single.entryId)) {
    documents.set(single.entryId, single.document);
  }
  return documents;
}

/**
 * Of these documents of one collection that exist, whether each is stored as
 * published, read from its table in one query of at most two columns. Every
 * document of a collection without a draft/published lifecycle is live once
 * it exists. `null` for a slug that is not a registered collection, such as
 * the media library, about whose documents nothing here can say.
 */
async function publishedEntries(
  adapter: DrizzleAdapter,
  collection: string,
  entryIds: readonly string[]
): Promise<Map<string, boolean> | null> {
  const record = await registryRecord("collection", collection);
  if (record === null) return null;
  const published = new Map<string, boolean>();
  if (entryIds.length === 0) return published;
  const table = collectionTableName(record, collection);
  if (!(await adapter.tableExists(table))) return published;
  const lifecycle = record.status === true;
  const rows = await adapter.select<{ id: unknown; status?: unknown }>(table, {
    columns: lifecycle ? ["id", "status"] : ["id"],
    where: {
      and: [{ column: "id", op: "IN", value: [...new Set(entryIds)] }],
    },
  });
  for (const row of rows) {
    published.set(String(row.id), !lifecycle || row.status === "published");
  }
  return published;
}

/**
 * The reads the releases domain's link check asks, bound to one adapter.
 * Each scanned link list carries its {@link ScannedDocument}.
 *
 * @experimental
 */
export function releaseLinkReads(adapter: DrizzleAdapter): ReleaseLinkReads {
  return {
    linksOf: async (scope, entryIds) => {
      const scanned = new Map<string, ScannedLinks>();
      const kind = scope.scopeKind === "single" ? "single" : "collection";
      const record = await registryRecord(kind, scope.scopeSlug);
      if (record === null || entryIds.length === 0) return scanned;
      const fields = collectionFields(record) as unknown as FieldConfig[];
      const enriched = await enrichedFields(fields);
      for (const [id, document] of await goingLiveDocuments(scope, entryIds)) {
        const { links, data, keys } = linksInDocument(enriched, document);
        const snapshot: ScannedDocument = {
          kind,
          slug: scope.scopeSlug,
          fields,
          enriched,
          data,
          keys,
        };
        scanned.set(id, { links, snapshot });
      }
      return scanned;
    },
    publishedOf: (collection, entryIds) =>
      publishedEntries(adapter, collection, entryIds),
  };
}

/**
 * For each of these scanned documents, by `id`, the keys of the link fields
 * a reader may view ({@link linkFieldKeysVisibleIn}), judged on the scanned
 * document itself. A scan this module did not make shows no field.
 *
 * @experimental
 */
export async function linkFieldKeysVisibleTo(
  scans: ReadonlyArray<{ id: string; scanned: ScannedLinks }>,
  caller: {
    user: Record<string, unknown>;
    authenticatedScope?: AuthenticatedScope;
  }
): Promise<Map<string, Set<string>>> {
  const visible = new Map<string, Set<string>>();
  for (const { id, scanned } of scans) {
    const snapshot = scanned.snapshot as Partial<ScannedDocument> | null;
    if (
      snapshot === null ||
      typeof snapshot !== "object" ||
      !(snapshot.keys instanceof WeakMap)
    ) {
      continue;
    }
    visible.set(
      id,
      await linkFieldKeysVisibleIn(snapshot as ScannedDocument, caller)
    );
  }
  return visible;
}
