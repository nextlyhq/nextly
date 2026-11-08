"use client";

/**
 * The canvas's data for its collection lists: each read the renderer's
 * `readList` makes, answered through the list entries route as the person
 * editing reads it, drafts included; or, while a document's visibility
 * conditions are applied, as a visitor reads it, published entries and public
 * fields only, so each item's conditions are judged as the published page
 * judges them.
 *
 * A data provider rather than a hook, because it is what a page context
 * carries: the canvas draws a list with the same renderer a published page
 * does, and the renderer asks its context's `data` for rows.
 *
 * A refusal is handed back in the shape the renderer recognises, the code and
 * the problems the route named (`publicData.errors`), so a sort the reader
 * refused falls back to id order on the canvas, and a read it refused is
 * told to the author, as it would be in a preview.
 *
 * @module admin/list-entries-client
 */
import type {
  BlocksDataProvider,
  BlocksQuery,
  PageContext,
} from "@nextlyhq/blocks-react";
import {
  listEntryCount,
  type ListEntryCount,
} from "@nextlyhq/blocks-react/blocks";
import { writePluginRoute } from "@nextlyhq/plugin-sdk/admin";

import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
// The CONTRACT, not the route: the route reads through the server's runtime.
import {
  LIST_ENTRIES_ROUTE_PATH,
  type ListEntriesResponse,
  type ListEntriesVisitor,
} from "../list-entries-contract";

/** How long an answer is kept, so drawing the page again reads nothing new. */
const KEPT_FOR_MS = 15_000;

/** A refusal as the renderer reads one: its code, words and problems. */
interface ReadRefusal extends Error {
  readonly code?: string;
  readonly publicMessage?: string;
  readonly publicData?: { readonly errors?: unknown };
}

/** The route's refusal, in the shape a server-side read's error has. */
function refusalOf(error: unknown): ReadRefusal {
  if (!(error instanceof Error)) return new Error(String(error));
  const { code, data } = error as Error & {
    code?: unknown;
    data?: { errors?: unknown };
  };
  return Object.assign(new Error(error.message), {
    ...(typeof code === "string" ? { code } : {}),
    publicMessage: error.message,
    ...(data?.errors === undefined
      ? {}
      : { publicData: { errors: data.errors } }),
  });
}

/** One read, through the route, as a visitor reads it when one is named. */
async function readThrough(
  query: BlocksQuery,
  visitor?: ListEntriesVisitor
): Promise<ListEntriesResponse> {
  try {
    const body = await writePluginRoute<ListEntriesResponse>({
      plugin: PAGE_BUILDER_PLUGIN_NAME,
      path: LIST_ENTRIES_ROUTE_PATH,
      method: "POST",
      body: visitor === undefined ? { query } : { query, visitor },
    });
    if (body === undefined || !Array.isArray(body.items)) {
      throw new Error("The list's entries could not be read.");
    }
    return body;
  } catch (error) {
    throw refusalOf(error);
  }
}

/**
 * The canvas's data provider. Each distinct read is made once and its answer
 * kept a short while, so the page drawn again for a selection or an edit
 * elsewhere does not read again; a read in flight is shared. A refusal is not
 * kept, so the next draw asks again.
 */
export function canvasListData(
  read: (query: BlocksQuery) => Promise<ListEntriesResponse> = readThrough,
  now: () => number = Date.now
): BlocksDataProvider {
  const kept = new Map<
    string,
    { readonly at: number; readonly answer: Promise<ListEntriesResponse> }
  >();
  return {
    find: async query => {
      const key = JSON.stringify(query);
      const held = kept.get(key);
      if (held !== undefined && now() - held.at < KEPT_FOR_MS) {
        const answer = await held.answer;
        return { items: answer.items, total: answer.meta.total };
      }
      const answer = read(query);
      kept.set(key, { at: now(), answer });
      try {
        const settled = await answer;
        return { items: settled.items, total: settled.meta.total };
      } catch (error) {
        kept.delete(key);
        throw error;
      }
    },
  };
}

/** The terms a list is read under on the canvas, beyond the data. */
type CanvasListTerms = Pick<PageContext, "locale" | "timeZone" | "fieldShapes">;

/**
 * The editor's count of a list's matching entries, for the list selected in
 * its inspector: taken from the list's own read through `data`, the very
 * reads the canvas draws the list with, whose answer's total is the count.
 * With the canvas's provider, which keeps its answers, the count is of the
 * rows on the canvas and reads nothing of its own. A list whose read does
 * not say reads nothing.
 */
export function canvasListCount(
  data: BlocksDataProvider,
  terms: CanvasListTerms
): (
  props: Readonly<Record<string, unknown>>
) => Promise<ListEntryCount | undefined> {
  return props => listEntryCount(props, terms, data);
}

/**
 * The canvas's list reads in one language: the provider the canvas draws
 * its lists with, the terms it reads them under, and the editor's count,
 * taken from the same provider's answers.
 */
export interface CanvasListReads {
  readonly terms: CanvasListTerms;
  readonly data: BlocksDataProvider;
  readonly count: ReturnType<typeof canvasListCount>;
}

/**
 * One set of reads per signed-in person and language, shared by the canvas
 * and the inspector, and only the current person's: the rows read are theirs,
 * drafts and protected fields included.
 */
const READS = new Map<string, CanvasListReads>();
/**
 * The person whose reads `READS` holds, so another's are dropped first.
 * Always a person known by id: reads made before the signed-in person is
 * known are never kept, so none is held under an identity two people share.
 */
let readsFor: string | undefined;

/**
 * A fresh set of list reads in `locale`, keeping only its own answers, made
 * as a visitor of `visitor`'s document reads when one is named.
 */
function listReadsIn(
  locale: string | undefined,
  visitor: ListEntriesVisitor | undefined
): CanvasListReads {
  const terms: CanvasListTerms = locale === undefined ? {} : { locale };
  const data =
    visitor === undefined
      ? canvasListData()
      : canvasListData(query => readThrough(query, visitor));
  return { terms, data, count: canvasListCount(data, terms) };
}

/** Where a set of reads is kept: its language, and the visitor it reads as. */
function readsKey(
  locale: string | undefined,
  visitor: ListEntriesVisitor | undefined
): string {
  return JSON.stringify([
    locale ?? "",
    visitor?.collection ?? null,
    visitor?.id ?? null,
  ]);
}

/**
 * The canvas's list reads for `userId`, the signed-in person, in `locale`, the
 * language being edited: one object per person and language, so the canvas's
 * page context and the inspector's count read through ONE provider and its
 * kept answers. Its kept answers are that person's, so the moment another
 * person asks (a sign-out and a sign-in in the same tab), every earlier
 * person's reads are dropped before anything is answered: no row read for one
 * account is ever handed to another. A date filter still compares in UTC: the
 * canvas reads no site time zone.
 *
 * With `visitor`, the document being edited, the reads are a visitor's of
 * that document's lists, kept apart from the person's own: the route answers
 * them only for a document the person may open.
 */
export function canvasListReadsIn(
  locale: string | undefined,
  userId: string | null,
  visitor?: ListEntriesVisitor
): CanvasListReads {
  // The route answers whoever the session cookie names, so while the person
  // is not known by id, each ask gets reads of its own that nothing keeps:
  // a sign-in under way cannot be handed the previous account's rows.
  if (userId === null) return listReadsIn(locale, visitor);
  if (readsFor !== userId) {
    READS.clear();
    readsFor = userId;
  }
  const key = readsKey(locale, visitor);
  let reads = READS.get(key);
  if (reads === undefined) {
    reads = listReadsIn(locale, visitor);
    READS.set(key, reads);
  }
  return reads;
}
