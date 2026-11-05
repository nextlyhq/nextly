"use client";

/**
 * The canvas's data for its collection lists: each read the renderer's
 * `readList` makes, answered through the list entries route as a visitor
 * reads it.
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
import type { BlocksDataProvider, BlocksQuery } from "@nextlyhq/blocks-react";
import { writePluginRoute } from "@nextlyhq/plugin-sdk/admin";

import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
// The CONTRACT, not the route: the route reads through the server's runtime.
import {
  LIST_ENTRIES_ROUTE_PATH,
  type ListEntriesResponse,
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

/** One read, through the route. */
async function readThrough(query: BlocksQuery): Promise<ListEntriesResponse> {
  try {
    const body = await writePluginRoute<ListEntriesResponse>({
      plugin: PAGE_BUILDER_PLUGIN_NAME,
      path: LIST_ENTRIES_ROUTE_PATH,
      method: "POST",
      body: { query },
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
