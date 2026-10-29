/**
 * One widget batch asked as a stream: each slot handed over as the server
 * settles it, so a slow card holds no other.
 *
 * The endpoint writes one `{index, slot}` line per settled slot when asked with
 * `Accept: application/x-ndjson`, and answers today's `{ results }` JSON to a
 * client that does not ask. Both are read here, because a proxy that strips the
 * header, or an older server, answers JSON to a client that asked for lines.
 *
 * Read by hand rather than through TanStack's `streamedQuery`, which the
 * admin's peer range for `@tanstack/react-query` does not promise a host app.
 *
 * @module hooks/queries/widget-query-stream
 */

import type { WidgetQuery } from "nextly/config";
import type { WidgetRenderSize } from "nextly/widget-result";

import { BASE_URL, noteSchemaVersion } from "@admin/lib/api/fetcher";
import { parseApiError } from "@admin/lib/api/parseApiError";
import { authFetch } from "@admin/lib/api/refreshInterceptor";
import type { WidgetQueryBatchResponse } from "@admin/types/dashboard/widgets";

/**
 * A card asked for rather than a query: by its id, or with settings of the reader's choosing
 * (one not yet saved, or a settings preview). The server answers either from the declaration.
 */
export type CardAsk =
  | { widget: string; card: string }
  | { widget: string; settings: Record<string, unknown> };

/**
 * A card ask as it is SENT: with the size the card is drawn at, where the dashboard has one, which
 * the server hands the widget's `load` (core's `WidgetLoadSize`, the shape a component is handed
 * as `WidgetRenderSize`). A type of its own rather than a field of `CardAsk`, because a card's ask
 * is part of its cache key and its size is kept out of the key (see `WidgetQueryRequest.cardSize`).
 */
export type SentCardAsk = CardAsk & { size?: WidgetRenderSize };

/** The media type the endpoint streams settled slots in. */
const NDJSON = "application/x-ndjson";

/** One slot as the stream carries it: its place in the batch, and the slot unread. */
export interface StreamedSlot {
  index: number;
  slot: unknown;
}

/**
 * A line's slot, when the line is one: an object with an `index` that is a
 * place in this batch. Anything else is dropped, and the slot it might have
 * been is then missing when the stream ends, which is what it is.
 */
function readLine(text: string, asked: number): StreamedSlot | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const { index, slot } = value as { index?: unknown; slot?: unknown };
  if (
    typeof index !== "number" ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= asked
  ) {
    return undefined;
  }
  return { index, slot };
}

/** The `results` of a whole JSON answer, refused when the body is not that shape. */
export function readResults(body: unknown): unknown[] {
  const results = (body as WidgetQueryBatchResponse | null)?.results;
  if (!Array.isArray(results)) {
    throw new Error(
      "Dashboard query response was not shaped as { results: [] }."
    );
  }
  return results;
}

/**
 * Asks `queries` and hands each settled slot to `onSlots` as it arrives,
 * resolving with every slot by position once the answer has ended: `undefined`
 * where the stream never carried one.
 *
 * Rejects as `fetcher` does for a refused request (the parsed error envelope),
 * for a body that is neither a stream of slots nor `{ results }`, and for a
 * stream cut off partway, so the caller's retry and failure states see it.
 */
export async function fetchWidgetBatch(
  queries: readonly (WidgetQuery | SentCardAsk | undefined)[],
  options: {
    signal?: AbortSignal;
    onSlots: (slots: readonly StreamedSlot[]) => void;
  }
): Promise<unknown[]> {
  const res = await authFetch(`${BASE_URL}/dashboard/query`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: NDJSON },
    body: JSON.stringify({ queries }),
    ...(options.signal && { signal: options.signal }),
  });
  noteSchemaVersion(res);

  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw parseApiError(json, res.status);
  }

  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes(NDJSON) || !res.body) {
    // Answered whole: every slot at once, by position.
    return readResults(await res.json());
  }

  return readSlotStream(res.body, queries.length, options.onSlots);
}

/**
 * The lines of a streamed answer read as they come, each slot handed to
 * `onSlots` as its line completes, resolving with every slot by position once
 * the stream has ended.
 */
async function readSlotStream(
  body: ReadableStream<Uint8Array>,
  asked: number,
  onSlots: (slots: readonly StreamedSlot[]) => void
): Promise<unknown[]> {
  const slots: unknown[] = new Array<unknown>(asked).fill(undefined);
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  for (;;) {
    const { done, value } = await reader.read();
    pending += done
      ? decoder.decode()
      : decoder.decode(value, { stream: true });
    // Only whole lines: the last piece may be a line the next chunk finishes.
    const lines = pending.split("\n");
    pending = done ? "" : (lines.pop() ?? "");
    const arrived = slotsIn(lines, asked);
    for (const { index, slot } of arrived) slots[index] = slot;
    if (arrived.length > 0) onSlots(arrived);
    if (done) return slots;
  }
}

/** The slots a run of whole lines carries, skipping blank lines and lines that are not slots. */
function slotsIn(lines: readonly string[], asked: number): StreamedSlot[] {
  const arrived: StreamedSlot[] = [];
  for (const line of lines) {
    if (line.trim() === "") continue;
    const read = readLine(line, asked);
    if (read) arrived.push(read);
  }
  return arrived;
}
