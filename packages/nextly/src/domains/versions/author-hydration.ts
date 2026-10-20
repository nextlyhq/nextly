/**
 * Who wrote each version, as history shows it.
 *
 * A version row records only a user id, and an API key's write carries its
 * owner's, so the row alone cannot tell a person from a key or the system.
 * The record of content events can: every write records its actor with the
 * version it produced. So each version is named from that event (a person, an
 * API key by its own name, a plugin's person, an agent or "System"), and only
 * a version recorded before events existed falls back to its stored id.
 *
 * The projection is deliberately narrower than a user read: a name, and no
 * email. Naming whoever edited a document the caller can already read stays
 * within what other surfaces already disclose, while an email address is a
 * stronger identifier that nothing on a history surface needs. Keeping it out
 * also means reading history does not require permission to read users, which
 * would otherwise lock editors out of their own document's history.
 *
 * @module domains/versions/author-hydration
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { getService } from "../../di";
import { container } from "../../di/container";
import {
  ContentEventsRepository,
  type ContentEventProducer,
} from "../content-events/repository";

import type { VersionMeta } from "./versions-repository";

/** Display identity of whoever created a version. */
export interface VersionAuthor {
  /**
   * What wrote it: a person, an API key, a plugin's person, the system, an
   * agent, or a release. Absent on a version recorded before the record of
   * content events, which names only a person.
   */
  kind?: ContentEventProducer["actorKind"];
  /** The person's or key's id; null for the system. */
  id: string | null;
  name: string | null;
}

/** A version row carrying its resolved author, if one could be resolved. */
export type VersionMetaWithAuthor = VersionMeta & {
  author: VersionAuthor | null;
};

/**
 * Attach a display author to each row, resolving every distinct id in one
 * query.
 *
 * Attribution decorates a read the caller has already been granted, so every
 * failure mode degrades to `author: null` rather than propagating. A deleted
 * user, or an unavailable user table, must not cost the caller their history.
 */
export async function attachVersionAuthors(
  rows: VersionMeta[]
): Promise<VersionMetaWithAuthor[]> {
  const producers = await producersOfRows(rows);
  // Every person either source names, read in one query: a stored id where no
  // event names the writer, and a person an event names.
  const people = await peopleById([
    ...rows
      .filter(row => !producers.has(producerKey(row)))
      .map(row => row.createdBy),
    ...[...producers.values()]
      .filter(producer => producer.actorKind === "person")
      .map(producer => producer.actorId),
  ]);
  return rows.map(row => {
    const producer = producers.get(producerKey(row));
    if (producer)
      return { ...row, author: authorFromProducer(producer, people) };
    return {
      ...row,
      author: row.createdBy ? (people.get(row.createdBy) ?? null) : null,
    };
  });
}

/** A version's place in the producers map: its document and its number. */
function producerKey(row: VersionMeta): string {
  return `${row.scopeKind}:${row.scopeSlug}:${row.entryId}:${row.versionNo ?? ""}`;
}

/**
 * The event that produced each version, one read per document on the page
 * (a history page is one document's). A failed read names nobody from events,
 * as a failed person lookup names nobody.
 */
async function producersOfRows(
  rows: VersionMeta[]
): Promise<Map<string, ContentEventProducer>> {
  const byKey = new Map<string, ContentEventProducer>();
  const documents = rowsByDocument(rows);
  if (documents.length === 0) return byKey;
  try {
    const repository = new ContentEventsRepository(
      container.get<DrizzleAdapter>("adapter"),
      getService("logger")
    );
    for (const docRows of documents) {
      for (const [key, producer] of await producersOfDocument(
        repository,
        docRows
      )) {
        byKey.set(key, producer);
      }
    }
  } catch {
    // Attribution decorates a read already granted: fall back to stored ids.
  }
  return byKey;
}

/**
 * The page's numbered versions, one group per document. Pages keep no
 * content events, so their versions are named by stored id alone.
 */
function rowsByDocument(rows: VersionMeta[]): VersionMeta[][] {
  const byDocument = new Map<string, VersionMeta[]>();
  for (const row of rows) {
    if (row.versionNo === null || row.scopeKind === "page") continue;
    const doc = `${row.scopeKind}:${row.scopeSlug}:${row.entryId}`;
    byDocument.set(doc, [...(byDocument.get(doc) ?? []), row]);
  }
  return [...byDocument.values()];
}

/** One document's producers, keyed for the page. */
async function producersOfDocument(
  repository: ContentEventsRepository,
  docRows: VersionMeta[]
): Promise<Map<string, ContentEventProducer>> {
  const first = docRows[0];
  const found = await repository.producersOf(
    {
      kind: first.scopeKind === "single" ? "single" : "collection",
      slug: first.scopeSlug,
      id: first.entryId,
    },
    docRows.map(row => row.versionNo!)
  );
  const byKey = new Map<string, ContentEventProducer>();
  for (const row of docRows) {
    const producer = found.get(row.versionNo!);
    if (producer) byKey.set(producerKey(row), producer);
  }
  return byKey;
}

/**
 * People by id, in one query. A person's current name wins over the name an
 * event kept, as history showed it before events.
 *
 * The one lookup for naming a person on a read already granted: version
 * history and the release list's owners both go through it, so the two can
 * never name someone differently. A name and nothing else; someone who cannot
 * be named (deleted, or a lookup that failed) is absent.
 */
export async function peopleById(
  candidates: readonly (string | null | undefined)[]
): Promise<Map<string, VersionAuthor>> {
  const ids = [
    ...new Set(
      candidates.filter(
        (id): id is string => typeof id === "string" && id.length > 0
      )
    ),
  ];
  const byId = new Map<string, VersionAuthor>();
  if (ids.length === 0) return byId;
  try {
    const users = getService("userService");
    for (const user of await users.listUsersByIds(ids)) {
      byId.set(user.id, { kind: "person", id: user.id, name: user.name });
    }
  } catch {
    // Leave the map empty: rows render unattributed rather than failing.
  }
  return byId;
}

/** The author an event names: a key by its own name, the system as such. */
function authorFromProducer(
  producer: ContentEventProducer,
  people: Map<string, VersionAuthor>
): VersionAuthor {
  if (producer.actorKind === "system") {
    return { kind: "system", id: null, name: "System" };
  }
  const current =
    producer.actorKind === "person" && producer.actorId
      ? people.get(producer.actorId)
      : undefined;
  return {
    kind: producer.actorKind,
    id: producer.actorId,
    name: current?.name ?? producer.actorName,
  };
}
