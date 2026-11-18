/**
 * The PUBLISHED component definitions some documents reach, nested ones
 * included, for drawing their pictures as the published page draws them.
 *
 * Each document is discovered by the render's own discovery
 * (`definitionsFor`) under the renderer's own bounds, so a document is drawn
 * whole however many others are asked with it. The reads are shared: one
 * answer per component id across every document, and the ids every document
 * asks for in the same turn read together in one batched store read, rather
 * than one store query per document. Read as the caller: a caller who may not
 * read components gets none, and each draws the marker a missing component
 * draws.
 *
 * @module published-definitions
 */
import type { BlockDocument, DocumentLimits } from "@nextlyhq/blocks-engine";
import { definitionsFor } from "@nextlyhq/blocks-react";
import { NextlyError } from "@nextlyhq/plugin-sdk";

import {
  publishedStoreSource,
  type StoreReading,
  type StoreSourceDirectApi,
} from "./component-store-source";

/**
 * @param documents - the documents to draw, each discovered on its own
 * @returns every definition any of them reaches, by component id
 */
export async function publishedDefinitionsOf<R extends StoreReading>(
  nextly: StoreSourceDirectApi<R>,
  store: { collection: string; field: string; locale: string | undefined },
  documents: readonly BlockDocument[],
  read: { reading: R; limits: DocumentLimits }
): Promise<Record<string, BlockDocument>> {
  if (documents.length === 0) return {};
  const source = publishedStoreSource(nextly, {
    ...store,
    reading: read.reading,
  });
  // The ids every drawing asks for in the same turn, read together: the
  // drawings start at once, so their reads coalesce into one batched read
  // rather than one store query per set.
  let gathering: {
    ids: string[];
    read: Promise<ReadonlyMap<string, BlockDocument>>;
  } | null = null;
  const gather = (
    ids: readonly string[]
  ): Promise<ReadonlyMap<string, BlockDocument>> => {
    let current = gathering;
    if (current === null) {
      const batch: string[] = [];
      const read = new Promise<void>(resolve => {
        setTimeout(resolve, 0);
      }).then(() => {
        gathering = null;
        return source(batch).catch(
          (error: unknown): ReadonlyMap<string, BlockDocument> => {
            // Refused: the caller may not read these, and the regions draw as
            // missing, which is what they are to this caller. Anything else is
            // a failure, not an answer, and fails the request, so the picker
            // says it could not load rather than calling the components missing.
            if (
              NextlyError.isForbidden(error) ||
              NextlyError.isNotFound(error)
            ) {
              return new Map<string, BlockDocument>();
            }
            throw error;
          }
        );
      });
      current = { ids: batch, read };
      gathering = current;
    }
    current.ids.push(...ids);
    return current.read;
  };
  // One answer per id across every drawing, kept as it is asked for, so a
  // component that many sets place (a shared logo) is read once, and two
  // drawings asking for it at the same moment share that read.
  const asked = new Map<string, Promise<BlockDocument | undefined>>();
  const readOnce = async (
    ids: readonly string[]
  ): Promise<Map<string, BlockDocument>> => {
    const fresh = [...new Set(ids.filter(id => !asked.has(id)))];
    if (fresh.length > 0) {
      const batch = gather(fresh);
      for (const id of fresh) {
        asked.set(
          id,
          batch.then(found => found.get(id))
        );
      }
    }
    const answers = await Promise.all(
      ids.map(async id => [id, await asked.get(id)] as const)
    );
    return new Map(
      answers.filter(
        (answer): answer is readonly [string, BlockDocument] =>
          answer[1] !== undefined
      )
    );
  };
  // Each document discovered under its own bound, as the renderer draws it.
  const found = await Promise.all(
    documents.map(document => definitionsFor(document, readOnce, read.limits))
  );
  return Object.fromEntries(found.flatMap(definitions => [...definitions]));
}
