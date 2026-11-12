/**
 * GET /api/admin-meta/plugin-panel-numbers?plugin=<plugin name>
 *
 * The numbers one standalone plugin's panel shows beside its menu items, for
 * the signed-in reader, read from the panel the server already published
 * (`publishedPluginPanel`): the browser names only the plugin, never a
 * collection or a filter, so it cannot ask this route to count anything the
 * plugin did not declare.
 *
 * - A count of a collection runs as the reader (`countAsCaller`), through the
 *   access decision every dashboard read takes. A collection hidden from the
 *   navigation is counted: a plugin's panel is often the only place its
 *   collections are listed. One the reader may not read gives no number, the
 *   same as one that is not there.
 * - An attention item's number is its count in the reader's attention digest,
 *   read once per request (`readAttentionDigest`): 0 when the digest holds no
 *   such item, since it leaves out one with nothing waiting; none when its
 *   count failed; a floor carried as `atLeast`.
 *
 * Each number is keyed by its item's place among the plugin's published
 * top-level menu items, the order the admin metadata serializes them in. A
 * number that cannot be read is left out rather than failing the answer.
 *
 * Caching: `private, no-store`. The answer is per reader.
 *
 * @module api/plugin-panel-numbers
 */
import { z } from "zod";

import { isErrorResponse, requireAuthentication } from "../auth/middleware";
import { toNextlyAuthError } from "../auth/middleware/to-nextly-error";
import { MAX_QUERIES_PER_REQUEST } from "../domains/widgets/batch-limit";
import { countAsCaller } from "../domains/widgets/execute";
import { NextlyError } from "../errors/nextly-error";
import { getCachedNextly } from "../init";
import type { PluginItemCount } from "../plugins/admin-contributions";
import type { PluginDefinition } from "../plugins/plugin-context";
import { publishedPluginPanel } from "../plugins/plugin-panel";
import { getHandlerConfig } from "../route-handler/auth-handler";
import { readAttentionDigest } from "../services/dashboard/attention-source";
import type { ReadCaller } from "../services/dashboard/readable-resources";

import { PRIVATE_NO_STORE_HEADERS, readCaller } from "./authenticated-read";
import { respondData } from "./response-shapes";
import { withErrorHandler } from "./with-error-handler";

/** One item's number: its place among the published items, and the number. */
interface PanelNumber {
  index: number;
  value: number;
  atLeast: boolean;
}

/** The query string: the plugin, by the name it is registered under. */
const QUERY = z.object({ plugin: z.string().min(1).max(214) });

export const getPluginPanelNumbers = withErrorHandler(async (req: Request) => {
  const auth = await requireAuthentication(req);
  if (isErrorResponse(auth)) throw toNextlyAuthError(auth);
  const parsed = QUERY.safeParse({
    plugin: new URL(req.url).searchParams.get("plugin") ?? undefined,
  });
  if (!parsed.success) {
    throw NextlyError.validation({
      errors: [
        {
          path: "plugin",
          code: "INVALID_VALUE",
          message: "Name the plugin whose panel numbers to read.",
        },
      ],
    });
  }
  const plugin = (getHandlerConfig()?.plugins ?? []).find(
    candidate =>
      candidate.name === parsed.data.plugin && candidate.enabled !== false
  );
  const declared = plugin === undefined ? [] : declaredNumbers(plugin);
  const numbers =
    declared.length === 0
      ? []
      : await readNumbers(declared, await readerOf(auth), req.signal);
  return respondData({ numbers }, { headers: PRIVATE_NO_STORE_HEADERS });
});

/** The reader, once the services a count needs are up. */
async function readerOf(
  auth: Parameters<typeof readCaller>[0]
): Promise<ReadCaller> {
  await getCachedNextly();
  return readCaller(auth);
}

/** A number one published item declares, and the item's place. */
interface DeclaredNumber {
  index: number;
  number: PluginItemCount;
}

/**
 * The numbers the plugin's published panel declares, each with its item's
 * place among the published top-level items: the one reading the admin
 * metadata serializes the menu from, so the places agree.
 */
function declaredNumbers(plugin: PluginDefinition): DeclaredNumber[] {
  return publishedPluginPanel(plugin).menu.flatMap((item, index) => {
    const number = item.count ?? item.badge;
    return number === undefined ? [] : [{ index, number }];
  });
}

/** A number as read, before it is placed. */
interface PanelValue {
  value: number;
  atLeast: boolean;
}

/**
 * Every declared number, for `caller`: each distinct collection count once, up
 * to the batch bound (a count past it gets no number), and the attention
 * digest once when any item reads it.
 */
async function readNumbers(
  declared: readonly DeclaredNumber[],
  caller: ReadCaller,
  signal: AbortSignal
): Promise<PanelNumber[]> {
  const counts = new Map<string, Promise<PanelValue | undefined>>();
  let digest:
    | Promise<ReadonlyMap<string, PanelValue | undefined> | undefined>
    | undefined;
  const reads = declared.map(({ number }) => {
    if (isAttentionCount(number)) {
      digest ??= digestNumbers(caller, signal);
      return digest.then(found => attentionNumber(found, number.attention));
    }
    const key = JSON.stringify([number.collection, number.where ?? null]);
    const asked = counts.get(key);
    if (asked !== undefined) return asked;
    if (counts.size >= MAX_QUERIES_PER_REQUEST) {
      return Promise.resolve(undefined);
    }
    const read = countOrNothing(number, caller);
    counts.set(key, read);
    return read;
  });
  const settled = await Promise.all(reads);
  return declared.flatMap(({ index }, at) => {
    const read = settled[at];
    return read === undefined ? [] : [{ index, ...read }];
  });
}

/** A collection count, as published. */
type CollectionCount = Extract<PluginItemCount, { collection: string }>;

/** Whether a published number reads an attention item rather than a collection. */
function isAttentionCount(
  number: PluginItemCount
): number is Extract<PluginItemCount, { attention: string }> {
  return typeof number.attention === "string";
}

/**
 * An attention item's number from the reader's digest: its count; 0 where the
 * digest holds no such item; none where its count failed, or where the digest
 * itself could not be read.
 */
function attentionNumber(
  digest: ReadonlyMap<string, PanelValue | undefined> | undefined,
  id: string
): PanelValue | undefined {
  if (digest === undefined) return undefined;
  return digest.has(id) ? digest.get(id) : { value: 0, atLeast: false };
}

/**
 * A collection's count as the reader may read it, or nothing: a collection
 * they may not read, or one that is not there, answers no number either way.
 */
async function countOrNothing(
  count: CollectionCount,
  caller: ReadCaller
): Promise<PanelValue | undefined> {
  try {
    const value = await countAsCaller(count.collection, count.where, caller);
    return { value, atLeast: false };
  } catch {
    return undefined;
  }
}

/**
 * The reader's attention digest by item id, each with its number, or
 * `undefined` for an item whose count failed; `undefined` as a whole when the
 * digest could not be read.
 */
async function digestNumbers(
  caller: ReadCaller,
  signal: AbortSignal
): Promise<ReadonlyMap<string, PanelValue | undefined> | undefined> {
  try {
    const items = await readAttentionDigest(caller, { signal });
    return new Map(
      items.map(item => [
        item.id,
        item.failed === true
          ? undefined
          : { value: item.count, atLeast: item.atLeast === true },
      ])
    );
  } catch {
    return undefined;
  }
}
