/**
 * What a document links to as it would go live, for a release's checks.
 *
 * A release publishes a document's working draft where it has one, and its
 * stored content otherwise, so its links are read from the same place: the
 * working draft's snapshot, or the stored row read at depth 0. Both hold each
 * relationship as stored, which is the shape {@link relationshipTargetsOf}
 * reads, so the targets named here are the ones a read would populate.
 *
 * Every read is batched per collection: the rows of all the documents asked
 * about in one query, their working drafts in another, and the statuses of
 * linked documents in a third, whatever the number of documents or links.
 *
 * @module domains/collections/release-links
 * @experimental
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { FieldDefinition } from "@nextly/schemas/dynamic-collections";

import { container } from "../../di/container";
import type { NextlyServiceConfig } from "../../di/register";
import { nextly } from "../../direct-api/nextly";
import type {
  DocumentLink,
  ReleaseLinkReads,
} from "../releases/readiness/unpublished-links";
import { VersionsRepository } from "../versions/versions-repository";
import { workingDraftLocale } from "../versions/working-draft-locale";

import { relationshipTargetsOf } from "./services/collection-relationship-service";
import {
  collectionFields,
  collectionTableName,
} from "./services/collection-utils";

/** A value stored as JSON text on a dialect without a native JSON column. */
function decoded(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text.startsWith("{") && !text.startsWith("[")) return value;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return value;
  }
}

/** A plain object, or `null` for anything else. */
function asRecord(value: unknown): Record<string, unknown> | null {
  const found = decoded(value);
  return typeof found === "object" && found !== null && !Array.isArray(found)
    ? (found as Record<string, unknown>)
    : null;
}

/**
 * Every document `data` links to through its relationship fields, one level
 * deep: its own fields, inside groups and repeaters too, but never the links
 * of the documents it links to. `field` is the path of field names, without
 * repeater row numbers, so one field shows once however many rows it holds.
 *
 * Uploads are not read: an upload points at the media library, which has no
 * draft/published lifecycle, so there is nothing about it to report.
 *
 * @experimental
 */
export function linksInDocument(
  fields: readonly FieldDefinition[],
  data: Record<string, unknown>,
  prefix = ""
): DocumentLink[] {
  return fields.flatMap(field => {
    if (typeof field.name !== "string" || field.name === "") return [];
    const path = prefix === "" ? field.name : `${prefix}.${field.name}`;
    return linksInField(field, data[field.name], path);
  });
}

/** The links one field's value holds, at `path`. */
function linksInField(
  field: FieldDefinition,
  value: unknown,
  path: string
): DocumentLink[] {
  if (field.type === "relationship") {
    return relationshipTargetsOf(field, value).map(target => ({
      field: path,
      collection: target.collection,
      entryId: target.id,
    }));
  }
  const nested = Array.isArray(field.fields) ? field.fields : [];
  if (nested.length === 0) return [];
  // A group holds one object of its fields; a repeater, a list of them.
  const records =
    field.type === "group"
      ? [asRecord(value)]
      : field.type === "repeater"
        ? rowsOf(value)
        : [];
  return records.flatMap(record =>
    record === null ? [] : linksInDocument(nested, record, path)
  );
}

/** A repeater's rows, each as an object or `null`. */
function rowsOf(value: unknown): Array<Record<string, unknown> | null> {
  const rows = decoded(value);
  return Array.isArray(rows) ? rows.map(asRecord) : [];
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
  return asRecord(record);
}

/** The install's default language, for keying a localized working draft. */
function defaultLocale(): string | null {
  if (!container.has("config")) return null;
  return (
    container.get<NextlyServiceConfig>("config").localization?.defaultLocale ??
    null
  );
}

/** Whether the collection keeps working drafts apart from its live row. */
function keepsWorkingDrafts(record: Record<string, unknown>): boolean {
  const versions = asRecord(record.versions);
  const drafts = asRecord(versions?.drafts);
  return record.status === true && drafts?.enabled === true;
}

/**
 * What each of these documents of one collection links to as it would go
 * live, keyed by entry id. A document that is not there is absent.
 */
async function collectionLinks(
  adapter: DrizzleAdapter,
  collection: string,
  entryIds: readonly string[]
): Promise<Map<string, DocumentLink[]>> {
  const found = new Map<string, DocumentLink[]>();
  const record = await registryRecord("collection", collection);
  if (record === null || entryIds.length === 0) return found;
  const fields = collectionFields(record);
  // Trusted and at depth 0: this reads what the document holds, to judge it,
  // and nothing read here reaches a caller until the reader's own access has
  // narrowed it.
  const stored = await nextly.find({
    collection: collection as never,
    where: { id: { in: [...entryIds] } } as never,
    status: "all",
    depth: 0,
    limit: entryIds.length,
    pagination: false,
    overrideAccess: true,
  } as never);
  const rows = (stored as unknown as { items?: unknown[] }).items ?? [];
  const drafts = keepsWorkingDrafts(record)
    ? await new VersionsRepository(adapter).findWorkingDraftsOf(
        { scopeKind: "collection", scopeSlug: collection },
        entryIds,
        workingDraftLocale({
          documentLocalized: record.localized === true,
          requestLocale: null,
          defaultLocale: defaultLocale(),
        })
      )
    : new Map();
  for (const row of rows) {
    const live = asRecord(row);
    if (live === null) continue;
    const id = String(live.id);
    // The working draft is what the release's write folds in and publishes.
    const goingLive = asRecord(drafts.get(id)?.snapshot) ?? live;
    found.set(id, linksInDocument(fields, goingLive));
  }
  return found;
}

/**
 * What a Single links to as it would go live, keyed by its row's id, or
 * nothing when it has no stored row: its ordinary read would create one.
 */
async function singleLinks(
  slug: string,
  entryIds: readonly string[],
  singleExists: (slug: string) => Promise<boolean>
): Promise<Map<string, DocumentLink[]>> {
  const found = new Map<string, DocumentLink[]>();
  const record = await registryRecord("single", slug);
  if (record === null || !(await singleExists(slug))) return found;
  // `draft: true` under trust reads the working draft where there is one,
  // which is what the release publishes.
  const document = asRecord(
    await nextly.findSingle({
      slug: slug as never,
      status: "all",
      draft: true,
      depth: 0,
      overrideAccess: true,
    } as never)
  );
  if (document === null) return found;
  const id = String(document.id);
  if (entryIds.includes(id)) {
    found.set(id, linksInDocument(collectionFields(record), document));
  }
  return found;
}

/**
 * Of these documents of one collection that exist, whether each is stored as
 * published, read from its table in one query of two columns.
 */
async function publishedEntries(
  adapter: DrizzleAdapter,
  collection: string,
  entryIds: readonly string[]
): Promise<Map<string, boolean>> {
  const published = new Map<string, boolean>();
  const record = await registryRecord("collection", collection);
  if (record === null || entryIds.length === 0) return published;
  const table = collectionTableName(record, collection);
  if (!(await adapter.tableExists(table))) return published;
  const rows = await adapter.select<{ id: unknown; status: unknown }>(table, {
    columns: ["id", "status"],
    where: {
      and: [{ column: "id", op: "IN", value: [...new Set(entryIds)] }],
    },
  });
  for (const row of rows) {
    published.set(String(row.id), row.status === "published");
  }
  return published;
}

/**
 * The reads the releases domain's link check asks, bound to one adapter.
 * `singleExists` says whether a Single has its stored row without creating
 * it, which the Single's ordinary read would.
 *
 * @experimental
 */
export function releaseLinkReads(
  adapter: DrizzleAdapter,
  singleExists: (slug: string) => Promise<boolean>
): ReleaseLinkReads {
  return {
    linksOf: (scope, entryIds) =>
      scope.scopeKind === "single"
        ? singleLinks(scope.scopeSlug, entryIds, singleExists)
        : collectionLinks(adapter, scope.scopeSlug, entryIds),
    publishedOf: (collection, entryIds) =>
      publishedEntries(adapter, collection, entryIds),
  };
}
