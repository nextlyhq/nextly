/**
 * The booted instance's answer to "where is this item used", for one reader:
 * the usage record read on the adapter, the entries' and Singles' headings
 * read as the reader through the dashboard's one heading path, and the email
 * templates' names given to a holder of `read-email-templates`.
 *
 * @module domains/media/usage/media-uses-source
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import {
  callerHoldsPermission,
  readAccessCaller,
} from "../../../auth/entity-read-access";
import type { FieldConfig } from "../../../collections/fields/types";
import { container } from "../../../di/container";
import {
  bootedHeadingRegistries,
  headingKey,
  readableHeadings,
  type DocumentRef,
} from "../../../services/dashboard/readable-headings";
import type { ReadCaller } from "../../../services/dashboard/readable-resources";

import {
  addressPathsFrom,
  readReplacedRecord,
  type AddressPaths,
} from "./address-uses";
import { listIdentifiedMediaUsage } from "./media-usage-store";
import {
  mediaUseDocumentKey,
  type MediaUseDocument,
  type MediaUseHeading,
  type MediaUsesSource,
} from "./media-uses";

/** What a template is filed under among the record's subjects. */
const TEMPLATES_OWNER = "Email templates";

/** The registry a collection's or Single's display name is read from. */
interface OwnerRegistries {
  getCollectionBySlug(
    slug: string
  ): Promise<{ labels?: { plural?: string; singular?: string } } | null>;
  getSingleBySlug(slug: string): Promise<{ label?: string } | null>;
}

/** The name a collection or Single is shown under, or its slug. */
async function ownerOf(
  document: MediaUseDocument,
  registries: OwnerRegistries
): Promise<string> {
  if (document.kind === "single") {
    const single = await registries.getSingleBySlug(document.slug);
    return single?.label || document.slug;
  }
  const collection = await registries.getCollectionBySlug(document.slug);
  return collection?.labels?.plural || document.slug;
}

/**
 * The names of the templates among `ids`, for a reader who may read
 * templates; none for one who may not.
 */
async function templateHeadings(
  adapter: DrizzleAdapter,
  ids: readonly string[],
  caller: ReadCaller
): Promise<Map<string, MediaUseHeading>> {
  const headings = new Map<string, MediaUseHeading>();
  if (ids.length === 0) return headings;
  if (
    !(await callerHoldsPermission(
      "read-email-templates",
      readAccessCaller(caller)
    ))
  ) {
    return headings;
  }
  const rows = await adapter.select<Record<string, unknown>>(
    "email_templates",
    {
      columns: ["id", "name"],
      where: { and: [{ column: "id", op: "IN", value: [...ids] }] },
    }
  );
  for (const row of rows) {
    const id = typeof row.id === "string" ? row.id : String(row.id);
    const name = typeof row.name === "string" && row.name ? row.name : id;
    headings.set(
      mediaUseDocumentKey({ kind: "email-template", slug: "", documentId: id }),
      { title: name, owner: TEMPLATES_OWNER }
    );
  }
  return headings;
}

/** `read()`, asked once per key. */
function memoized<T>(
  cache: Map<string, Promise<T>>,
  key: string,
  read: () => Promise<T>
): Promise<T> {
  const found = cache.get(key);
  if (found) return found;
  const pending = read();
  cache.set(key, pending);
  return pending;
}

/** A collection entry or a Single: a document the read path judges. */
function isContentDocument(
  document: MediaUseDocument
): document is MediaUseDocument & { kind: DocumentRef["kind"] } {
  return document.kind !== "email-template";
}

/** A registry that answers with a document's fields. */
interface FieldsRegistry {
  getCollectionBySlug?(slug: string): Promise<{ fields?: unknown } | null>;
  getSingleBySlug?(slug: string): Promise<{ fields?: unknown } | null>;
}

/** The fields a registry answers with, when it answers with a list. */
function fieldsOf(
  found: { fields?: unknown } | null
): FieldConfig[] | undefined {
  return Array.isArray(found?.fields)
    ? (found.fields as FieldConfig[])
    : undefined;
}

/**
 * Which fields of each kind of document name an item by its address, read
 * from the booted instance's registries.
 */
export function bootedAddressPaths(): AddressPaths {
  return addressPathsFrom({
    collectionFields: async slug =>
      fieldsOf(
        (await container
          .get<FieldsRegistry>("collectionRegistryService")
          .getCollectionBySlug?.(slug)) ?? null
      ),
    singleFields: async slug =>
      fieldsOf(
        (await container
          .get<FieldsRegistry>("singleRegistryService")
          .getSingleBySlug?.(slug)) ?? null
      ),
  });
}

/** The usage of items, as `caller` may be told it, on this instance. */
export function bootedMediaUsesSource(
  adapter: DrizzleAdapter,
  caller: ReadCaller
): MediaUsesSource {
  return {
    rows: mediaId => listIdentifiedMediaUsage(adapter, mediaId),
    addressPaths: bootedAddressPaths(),
    // The rows recorded at the last Replace that are still there unchanged.
    previousRows: async mediaId =>
      new Set((await readReplacedRecord(adapter, mediaId))?.rows ?? []),
    headings: async documents => {
      const content = documents.filter(isContentDocument);
      const templates = documents
        .filter(document => document.kind === "email-template")
        .map(document => document.documentId);
      const owners: OwnerRegistries = {
        getCollectionBySlug: slug =>
          container
            .get<OwnerRegistries>("collectionRegistryService")
            .getCollectionBySlug(slug),
        getSingleBySlug: slug =>
          container
            .get<OwnerRegistries>("singleRegistryService")
            .getSingleBySlug(slug),
      };
      const [read, named] = await Promise.all([
        readableHeadings(
          content.map(document => ({
            kind: document.kind,
            slug: document.slug,
            entryId: document.documentId,
          })),
          caller,
          bootedHeadingRegistries()
        ),
        templateHeadings(adapter, templates, caller),
      ]);
      // Each collection's or Single's name is read once, however many of its
      // documents use the item.
      const ownerNames = new Map<string, Promise<string>>();
      for (const document of content) {
        const heading = read.get(
          headingKey({
            kind: document.kind,
            slug: document.slug,
            entryId: document.documentId,
          })
        );
        if (!heading) continue;
        named.set(mediaUseDocumentKey(document), {
          title: heading.title,
          owner: await memoized(
            ownerNames,
            `${document.kind} ${document.slug}`,
            () => ownerOf(document, owners)
          ),
        });
      }
      return named;
    },
  };
}
