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
 * @module domains/collections/release-links
 * @experimental
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import type { FieldConfig } from "../../collections/fields/types";
import { container } from "../../di/container";
import type { CollectionsHandler } from "../../services/collections-handler";
import { applyFieldReadAccess } from "../../shared/lib/field-level-registry";
import type { ReleaseCheckScope } from "../releases/readiness/check-sources";
import type {
  DocumentLink,
  ReleaseLinkReads,
} from "../releases/readiness/unpublished-links";
import type { SingleEntryService } from "../singles/services/single-entry-service";
import { walkReferenceFields } from "../versions/snapshot-references";

import { relationshipTargetsOf } from "./services/collection-relationship-service";
import {
  collectionFields,
  collectionTableName,
} from "./services/collection-utils";

/**
 * Where a link sits: the top-level field, then the field holding the value
 * when that is a different one inside it, such as `meta.editor` or
 * `blocks.cite`. Levels between the two are not named.
 */
function fieldPath(top: string, leaf: string): string {
  return top === leaf ? top : `${top}.${leaf}`;
}

/** A deep copy of plain document data, for a walk that normalises in place. */
function copied(data: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(data);
}

/**
 * Run the reference walk over `data` one top-level field at a time, so each
 * leaf it reaches is reported with the field path it sits under.
 */
function eachReference(
  fields: readonly FieldConfig[],
  data: Record<string, unknown>,
  includeReadRuleFields: boolean,
  visit: (field: FieldConfig, value: unknown, path: string) => void
): void {
  for (const top of fields) {
    const name = (top as { name?: unknown }).name;
    walkReferenceFields(
      data,
      [top],
      (field, holder, leaf) =>
        visit(
          field,
          holder[leaf],
          typeof name === "string" && name !== "" ? fieldPath(name, leaf) : leaf
        ),
      false,
      { includeReadRuleFields }
    );
  }
}

/**
 * Every document `data` links to through its relationship and upload fields,
 * one level deep: its own fields at any nesting, components and dynamic zones
 * included, but never the links of the documents it links to. Fields protected
 * by a read rule are included: whether a reader may be told about them is
 * decided per reader ({@link linkFieldsVisibleIn}).
 *
 * `fields` are enriched with their component schemas, as the walk reads them.
 *
 * @experimental
 */
export function linksInDocument(
  fields: readonly FieldConfig[],
  data: Record<string, unknown>
): DocumentLink[] {
  const links: DocumentLink[] = [];
  eachReference(fields, copied(data), true, (field, value, path) => {
    for (const target of relationshipTargetsOf(
      field as unknown as Parameters<typeof relationshipTargetsOf>[0],
      value
    )) {
      links.push({
        field: path,
        collection: target.collection,
        entryId: target.id,
      });
    }
  });
  return links;
}

/**
 * The field paths of `data`'s links that a reader is shown: the document with
 * the field read rules applied for that reader, as a read applies them, then
 * walked as the preview walks it, which leaves out a protected field inside a
 * component, where a rule cannot be judged. A link outside these is in a field
 * the reader may not view.
 *
 * @experimental
 */
export async function linkFieldsVisibleIn(args: {
  kind: "collection" | "single";
  slug: string;
  fields: readonly FieldConfig[];
  data: Record<string, unknown>;
  user: Record<string, unknown>;
  authenticatedScope?: AuthenticatedScope;
}): Promise<Set<string>> {
  const entry = copied(args.data);
  await applyFieldReadAccess({
    kind: args.kind,
    slug: args.slug,
    entry,
    user: args.user,
    ...(args.authenticatedScope
      ? { authenticatedScope: args.authenticatedScope }
      : {}),
  });
  const visible = new Set<string>();
  eachReference(args.fields, entry, false, (_field, _value, path) => {
    visible.add(path);
  });
  return visible;
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
  record: Record<string, unknown>
): Promise<FieldConfig[]> {
  const fields = collectionFields(record) as unknown as Record<
    string,
    unknown
  >[];
  if (!container.has("fieldGroupRegistryService")) {
    return fields as unknown as FieldConfig[];
  }
  const registry = container.get<{
    enrichFieldsWithComponentSchemas(
      fields: Record<string, unknown>[]
    ): Promise<unknown[]>;
  }>("fieldGroupRegistryService");
  return (await registry.enrichFieldsWithComponentSchemas(
    fields
  )) as unknown as FieldConfig[];
}

/**
 * The documents of one scope as they would go live, keyed by entry id, with
 * the scope's enriched fields. A document that is not there is absent.
 */
async function goingLiveDocuments(
  scope: ReleaseCheckScope,
  entryIds: readonly string[]
): Promise<{
  fields: FieldConfig[];
  documents: Map<string, Record<string, unknown>>;
}> {
  const kind = scope.scopeKind === "single" ? "single" : "collection";
  const record = await registryRecord(kind, scope.scopeSlug);
  if (record === null || entryIds.length === 0) {
    return { fields: [], documents: new Map() };
  }
  const fields = await enrichedFields(record);
  if (kind === "collection") {
    const documents = await container
      .get<CollectionsHandler>("collectionsHandler")
      .releaseGoingLiveDocuments({
        collectionName: scope.scopeSlug,
        entryIds,
      });
    return { fields, documents };
  }
  const single = await container
    .get<SingleEntryService>("singleEntryService")
    .releaseGoingLiveDocument({ slug: scope.scopeSlug });
  // Only a member naming the Single's current row is answered about it.
  const documents = new Map<string, Record<string, unknown>>();
  if (single !== null && entryIds.includes(single.entryId)) {
    documents.set(single.entryId, single.document);
  }
  return { fields, documents };
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
 *
 * @experimental
 */
export function releaseLinkReads(adapter: DrizzleAdapter): ReleaseLinkReads {
  return {
    linksOf: async (scope, entryIds) => {
      const { fields, documents } = await goingLiveDocuments(scope, entryIds);
      return new Map(
        [...documents].map(([id, document]) => [
          id,
          linksInDocument(fields, document),
        ])
      );
    },
    publishedOf: (collection, entryIds) =>
      publishedEntries(adapter, collection, entryIds),
  };
}

/**
 * For each of these documents, by `id`, the field paths of its links a reader
 * is shown ({@link linkFieldsVisibleIn}), read a scope at a time. A document
 * that is not there is absent.
 *
 * @experimental
 */
export async function linkFieldsVisibleTo(
  documents: ReadonlyArray<ReleaseCheckScope & { entryId: string; id: string }>,
  caller: {
    user: Record<string, unknown>;
    authenticatedScope?: AuthenticatedScope;
  }
): Promise<Map<string, Set<string>>> {
  const byScope = new Map<string, typeof documents>();
  for (const document of documents) {
    const key = `${document.scopeKind}:${document.scopeSlug}`;
    byScope.set(key, [...(byScope.get(key) ?? []), document]);
  }
  const visible = new Map<string, Set<string>>();
  for (const group of byScope.values()) {
    const { fields, documents: read } = await goingLiveDocuments(
      group[0],
      group.map(document => document.entryId)
    );
    for (const document of group) {
      const data = read.get(document.entryId);
      if (data === undefined) continue;
      visible.set(
        document.id,
        await linkFieldsVisibleIn({
          kind: document.scopeKind === "single" ? "single" : "collection",
          slug: document.scopeSlug,
          fields,
          data,
          ...caller,
        })
      );
    }
  }
  return visible;
}
