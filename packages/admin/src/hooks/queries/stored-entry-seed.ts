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
 *
 * @module hooks/queries/stored-entry-seed
 */
import { hashKey, type QueryClient } from "@tanstack/react-query";

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
  const response = read();
  const carried: Carried = {
    answer: response.then(storedOf, () => undefined),
    taken: false,
  };
  onTheWay.set(hash, carried);
  void carried.answer.then(stored => {
    if (onTheWay.get(hash) === carried) onTheWay.delete(hash);
    if (carried.taken || stored === undefined) return;
    // Not asked for: the stored read is not reading, so it is handed this
    // one, of the same version as the populated read beside it.
    if (queryClient.getQueryState(storedKey)?.fetchStatus === "fetching") {
      return;
    }
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
  storedKey: readonly unknown[]
): Promise<Doc | undefined> {
  await Promise.resolve();
  const carried = onTheWay.get(hashKey(storedKey));
  if (carried === undefined || carried.taken) return undefined;
  carried.taken = true;
  return await carried.answer;
}
