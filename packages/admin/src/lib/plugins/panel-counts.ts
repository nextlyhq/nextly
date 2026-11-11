/**
 * The numbers a standalone plugin's panel shows beside its items: what one
 * batch asks the dashboard's query endpoint for, and how each item's number
 * is read back from its answer.
 *
 * One batch for the whole panel, through `POST /api/dashboard/query`, the
 * endpoint the dashboard's cards are read through, so each count is decided
 * by the same read access a card's is: a collection the reader may not read
 * answers no count, and the item draws no number. A count of a collection is
 * a `count` query of that collection; an attention item's number is read from
 * the attention digest (`system:attention`, `list`), asked once for every
 * attention item the panel shows, which is the answer the Needs your
 * attention card draws its rows from.
 *
 * @module lib/plugins/panel-counts
 */
import { isDrawnAttentionItem } from "nextly/attention-keys";
import { MAX_QUERIES_PER_REQUEST, MAX_WIDGET_LIMIT } from "nextly/config";

import type {
  PluginItemCountMeta,
  PluginMenuItemMeta,
} from "@admin/types/branding";

/**
 * The attention digest's source, as core registers it: the one the Needs
 * your attention card reads, answering its items for a `list`.
 */
const ATTENTION_SOURCE = "system:attention";

/** One query of the panel's batch, as the endpoint reads a widget query. */
export type PanelCountQuery =
  | { source: string; op: "count"; where?: Record<string, unknown> }
  | { source: typeof ATTENTION_SOURCE; op: "list"; limit: number };

/** The number one item shows, and whether it is a floor ("99+"). */
export interface PanelItemNumber {
  readonly value: number;
  readonly atLeast: boolean;
}

/** The number a top-level item declares, a count or a badge, if either. */
function declaredNumber(
  item: PluginMenuItemMeta
): PluginItemCountMeta | undefined {
  return item.count ?? item.badge;
}

/** The query that answers a collection count, its `where` included. */
function collectionQuery(
  count: Extract<PluginItemCountMeta, { collection: string }>
): PanelCountQuery {
  return count.where === undefined
    ? { source: `collection:${count.collection}`, op: "count" }
    : {
        source: `collection:${count.collection}`,
        op: "count",
        where: count.where,
      };
}

/** The digest query, asked once however many attention items show. */
const DIGEST_QUERY: PanelCountQuery = {
  source: ATTENTION_SOURCE,
  op: "list",
  limit: MAX_WIDGET_LIMIT,
};

/**
 * The batch that answers every number `items` show: one count per distinct
 * collection and `where`, and the digest once when any item shows an
 * attention item's number. Empty when none shows a number, so a panel
 * declaring none sends nothing.
 *
 * At most the endpoint's limit per request: the digest first, then the
 * counts in the order the items list them. A count past the limit is not
 * asked, and its item draws no number.
 */
export function panelCountQueries(
  items: readonly PluginMenuItemMeta[]
): PanelCountQuery[] {
  const counts = new Map<string, PanelCountQuery>();
  let digest = false;
  for (const item of items) {
    const number = declaredNumber(item);
    if (number === undefined) continue;
    if ("attention" in number) {
      digest = true;
      continue;
    }
    const query = collectionQuery(number);
    counts.set(JSON.stringify(query), query);
  }
  const queries = [...(digest ? [DIGEST_QUERY] : []), ...counts.values()];
  return queries.slice(0, MAX_QUERIES_PER_REQUEST);
}

/** A slot's answer, when the slot succeeded. */
function answerOf(slot: unknown): Record<string, unknown> | undefined {
  if (typeof slot !== "object" || slot === null) return undefined;
  const { ok, result } = slot as { ok?: unknown; result?: unknown };
  if (ok !== true || typeof result !== "object" || result === null) {
    return undefined;
  }
  return result as Record<string, unknown>;
}

/** A count slot's total, or nothing for a slot that failed or is not one. */
function countIn(slot: unknown): PanelItemNumber | undefined {
  const answer = answerOf(slot);
  const total = answer?.op === "count" ? answer.total : undefined;
  return typeof total === "number" && Number.isInteger(total) && total >= 0
    ? { value: total, atLeast: false }
    : undefined;
}

/**
 * An attention item's number from the digest's answer: its count, a floor
 * where the digest says so; 0 where the digest holds no such item, since the
 * digest leaves out an item with nothing waiting for the reader; nothing for
 * an item whose count failed, or a digest that did not answer.
 */
function attentionIn(slot: unknown, id: string): PanelItemNumber | undefined {
  const answer = answerOf(slot);
  if (answer?.op !== "list" || !Array.isArray(answer.items)) return undefined;
  const item = answer.items.find(
    entry => isDrawnAttentionItem(entry) && entry.id === id
  );
  if (item === undefined) return { value: 0, atLeast: false };
  const { count, failed, atLeast } = item as Record<string, unknown>;
  if (failed === true || typeof count !== "number") return undefined;
  return { value: count, atLeast: atLeast === true };
}

/**
 * Each item's number from the batch's answers, `slots[i]` answering
 * `queries[i]`, by the item's address. An item whose query was not asked, or
 * whose answer failed or was refused, has none.
 */
export function panelItemNumbers(
  items: readonly PluginMenuItemMeta[],
  queries: readonly PanelCountQuery[],
  slots: readonly unknown[]
): ReadonlyMap<string, PanelItemNumber> {
  const slotOf = (query: PanelCountQuery) => {
    const index = queries.findIndex(
      asked => JSON.stringify(asked) === JSON.stringify(query)
    );
    return index === -1 ? undefined : slots[index];
  };
  const numbers = new Map<string, PanelItemNumber>();
  for (const item of items) {
    const number = declaredNumber(item);
    if (number === undefined) continue;
    const read =
      "attention" in number
        ? attentionIn(slotOf(DIGEST_QUERY), number.attention)
        : countIn(slotOf(collectionQuery(number)));
    if (read !== undefined) numbers.set(item.to, read);
  }
  return numbers;
}

/** The number as drawn: "12", or "99+" for a floor. */
export function itemNumberText(number: PanelItemNumber): string {
  return number.atLeast ? `${number.value}+` : String(number.value);
}

/** The number as assistive technology reads it: "12", or "99 or more". */
export function itemNumberSpoken(number: PanelItemNumber): string {
  return number.atLeast ? `${number.value} or more` : String(number.value);
}
