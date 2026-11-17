/**
 * An editor's two reads of an entry, made in one request.
 *
 * The edit page reads an entry populated (`useEntry`) and as stored, at depth
 * 0 (`useStoredEntry`), and edits the two merged. Both are kept as they always
 * were, each under its own key, with its own refetch, invalidation and
 * optimistic write. Only the request changes: the populated read asks the
 * server for the stored read beside it (`?stored=1`, answered as `_stored`),
 * and the stored read, when it asks at the same moment (the page opening, a
 * save's invalidation, a reload), takes that answer instead of sending its own
 * request.
 *
 * - The populated read is cached without `_stored`, so everything that reads
 *   it sees exactly what a populated read alone returns.
 * - A stored read with no populated read on its way, or whose populated read
 *   came back without `_stored` or failed, reads depth 0 itself, as before.
 * - A stored read that did not take the answer (it was not asking) is handed
 *   it, so the two stay reads of one version.
 * - Both only to the stored read the populated read was made beside: the
 *   query the cache held under its key when the populated read was sent. A
 *   sign-out empties the cache, so a read sent before it reaches no query
 *   made after it, another account's included.
 *
 * @module hooks/queries/stored-entry-seed
 */
import { hashKey, type Query, type QueryClient } from "@tanstack/react-query";

import { entryKeys } from "@admin/services/entryApi";

type Doc = Record<string, unknown>;

/**
 * The depth-0 read is keyed under the document's own detail key, so whatever
 * invalidates that document after a save refetches this read with it.
 */
export const STORED_REFERENCES = "stored-references";

/**
 * The key a collection entry's depth-0 read is kept under, in a language and
 * view: one spelling for the read and for the populated read that carries it.
 */
export function storedEntryKey(
  collectionSlug: string,
  entryId: string,
  scope: { locale?: string; fallbackLocale?: string; draft?: boolean }
): readonly unknown[] {
  return [
    ...entryKeys.detailScoped(collectionSlug, entryId, {
      locale: scope.locale,
      fallbackLocale: scope.fallbackLocale,
      draft: scope.draft,
    }),
    STORED_REFERENCES,
  ];
}

/** The stored read a populated read carries, while it is on its way. */
interface Carried {
  readonly answer: Promise<Doc | undefined>;
  taken: boolean;
  /** The stored read it is carried for: the query under its key as it was sent. */
  readonly query: Query | undefined;
  /** When that stored read last took an answer, as this was sent. */
  readonly storedAt: number | undefined;
}

/** The query `client` holds under `key` now, if any. */
function queryUnder(
  client: QueryClient,
  key: readonly unknown[]
): Query | undefined {
  return client.getQueryCache().find({ queryKey: key, exact: true });
}

/** Stored reads on their way inside a populated read, by the stored read's key. */
const onTheWay = new Map<string, Carried>();

/** The `_stored` a populated read answered with, if it is a document. */
function storedOf(response: unknown): Doc | undefined {
  if (typeof response !== "object" || response === null) return undefined;
  const stored = (response as { _stored?: unknown })._stored;
  return typeof stored === "object" && stored !== null && !Array.isArray(stored)
    ? (stored as Doc)
    : undefined;
}

/** The populated read as a populated read alone answers it. */
function withoutStored<T>(response: T): T {
  if (typeof response !== "object" || response === null) return response;
  if (!("_stored" in response)) return response;
  const { _stored: _carried, ...entry } = response as Doc;
  return entry as T;
}

/**
 * Make the populated read `read`, which asks for the stored read beside it,
 * and offer that stored read to the stored read kept under `storedKey`.
 */
export function readCarryingStored<T>(
  queryClient: QueryClient,
  storedKey: readonly unknown[],
  read: () => Promise<T>
): Promise<T> {
  const hash = hashKey(storedKey);
  const query = queryUnder(queryClient, storedKey);
  const response = read();
  const carried: Carried = {
    answer: response.then(storedOf, () => undefined),
    taken: false,
    query,
    storedAt: query?.state.dataUpdatedAt,
  };
  onTheWay.set(hash, carried);
  void carried.answer.then(stored => {
    if (onTheWay.get(hash) === carried) onTheWay.delete(hash);
    if (carried.taken || stored === undefined) return;
    // Not asked for: the stored read is not reading, so it is handed this
    // one, of the same version as the populated read beside it. Only the
    // stored read it was sent beside: a cache emptied meanwhile (a sign-out),
    // or holding another query under the key, gets nothing. Nor one given a
    // newer answer since this was sent (a later read's, a save's): an older
    // read answering last never puts its version back.
    const now = queryUnder(queryClient, storedKey);
    if (now === undefined || now !== query) return;
    if (now.state.fetchStatus === "fetching") return;
    if (now.state.dataUpdatedAt !== carried.storedAt) return;
    queryClient.setQueryData(storedKey, stored);
  });
  return response.then(withoutStored);
}

/**
 * The stored read a populated read is carrying for `storedKey`, or
 * `undefined` when none is, or it came back without one.
 *
 * Asked a moment after the stored read starts: the page starts both reads in
 * one pass, and an invalidation refetches both in one, in either order.
 */
export async function takeCarriedStored(
  queryClient: QueryClient,
  storedKey: readonly unknown[]
): Promise<Doc | undefined> {
  await Promise.resolve();
  const carried = onTheWay.get(hashKey(storedKey));
  if (carried === undefined || carried.taken) return undefined;
  // Carried for another stored read: one from before a sign-out.
  if (carried.query !== queryUnder(queryClient, storedKey)) return undefined;
  carried.taken = true;
  return await carried.answer;
}
