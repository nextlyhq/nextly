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
import { container } from "../../../di/container";
import { NextlyError } from "../../../errors/nextly-error";
import {
  bootedHeadingRegistries,
  headingKey,
  readableHeadings,
  type DocumentRef,
} from "../../../services/dashboard/readable-headings";
import type { ReadCaller } from "../../../services/dashboard/readable-resources";
import { configuredLocales } from "../../i18n/configured-locales";

import { keptAddresses } from "./address-uses";
import { listIdentifiedMediaUsage } from "./media-usage-store";
import {
  mediaUseReadKey,
  type MediaUseDocument,
  type MediaUseHeading,
  type MediaUseRead,
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
      mediaUseReadKey({
        kind: "email-template",
        slug: "",
        documentId: id,
        locale: null,
      }),
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
function isContentRead(
  read: MediaUseRead
): read is MediaUseRead & { kind: DocumentRef["kind"] } {
  return read.kind !== "email-template";
}

/**
 * The headings of `refs`, all in one language, as the reader may read them.
 * A language the read path refuses as a request (one no longer active, say)
 * is one the reader is told nothing in, rather than a failure of the whole
 * answer; any other failure is a real one and is thrown.
 */
async function headingsInOneLanguage(
  refs: readonly DocumentRef[],
  caller: ReadCaller
): Promise<Map<string, { title: string }>> {
  try {
    return await readableHeadings(refs, caller, bootedHeadingRegistries());
  } catch (error) {
    if (NextlyError.isValidation(error)) return new Map();
    throw error;
  }
}

/**
 * The headings of the entries and Singles among `reads`, each read as the
 * reader in its own language, by {@link headingKey}.
 */
async function contentHeadings(
  reads: ReadonlyArray<MediaUseRead & { kind: DocumentRef["kind"] }>,
  caller: ReadCaller
): Promise<Map<string, { title: string }>> {
  const byLanguage = new Map<string | null, DocumentRef[]>();
  for (const read of reads) {
    const refs = byLanguage.get(read.locale) ?? [];
    refs.push({
      kind: read.kind,
      slug: read.slug,
      entryId: read.documentId,
      locale: read.locale,
    });
    byLanguage.set(read.locale, refs);
  }
  const answers = await Promise.all(
    [...byLanguage.values()].map(refs => headingsInOneLanguage(refs, caller))
  );
  return new Map(answers.flatMap(answer => [...answer]));
}

/** The usage of items, as `caller` may be told it, on this instance. */
export function bootedMediaUsesSource(
  adapter: DrizzleAdapter,
  caller: ReadCaller
): MediaUsesSource {
  return {
    rows: mediaId => listIdentifiedMediaUsage(adapter, mediaId),
    keptAddresses: mediaId => keptAddresses(adapter, mediaId),
    // The configured languages as they are now; none where the site has no
    // localization or its languages cannot be read, which tells no language.
    languages: () => Promise.resolve([...(configuredLocales() ?? [])]),
    headings: async reads => {
      const content = reads.filter(isContentRead);
      const templates = reads
        .filter(read => read.kind === "email-template")
        .map(read => read.documentId);
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
        contentHeadings(content, caller),
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
            locale: document.locale,
          })
        );
        if (!heading) continue;
        named.set(mediaUseReadKey(document), {
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
