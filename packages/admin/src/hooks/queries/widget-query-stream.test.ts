/**
 * Reading one widget batch as a stream, against real `Response` bodies: what
 * reaches the caller, in what order, and what a broken answer becomes.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { authFetch } from "@admin/lib/api/refreshInterceptor";

import { fetchWidgetBatch, type StreamedSlot } from "./widget-query-stream";

vi.mock("@admin/lib/api/refreshInterceptor", () => ({ authFetch: vi.fn() }));

const fetched = vi.mocked(authFetch);
// One card's ask, as the batch sends every card: by its widget and its card.
const count = { widget: "core/count", card: "posts" } as const;

afterEach(() => {
  vi.clearAllMocks();
});

/** A stream this test writes to piece by piece, served as the batch's answer. */
function streamedResponse() {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    response: new Response(body, {
      status: 200,
      headers: { "Content-Type": "application/x-ndjson" },
    }),
    write: (text: string) => controller.enqueue(encoder.encode(text)),
    end: () => controller.close(),
    fail: () => controller.error(new TypeError("network error")),
  };
}

const line = (index: number, total: number) =>
  `${JSON.stringify({ index, slot: { ok: true, result: { op: "count", total } } })}\n`;

describe("fetchWidgetBatch", () => {
  it("asks for the stream, and hands each slot over as it arrives", async () => {
    const stream = streamedResponse();
    fetched.mockResolvedValue(stream.response);
    const arrivals: StreamedSlot[][] = [];
    const signal = new AbortController().signal;

    const done = fetchWidgetBatch([count, count], {
      signal,
      onSlots: slots => arrivals.push([...slots]),
    });

    stream.write(line(1, 9));
    await vi.waitFor(() => expect(arrivals).toHaveLength(1));
    // The second slot has not been written: only the first reached the caller, and the answer
    // has not ended.
    expect(arrivals[0]).toEqual([
      { index: 1, slot: { ok: true, result: { op: "count", total: 9 } } },
    ]);

    stream.write(line(0, 2));
    stream.end();
    expect(await done).toEqual([
      { ok: true, result: { op: "count", total: 2 } },
      { ok: true, result: { op: "count", total: 9 } },
    ]);
    expect(arrivals).toHaveLength(2);

    const [url, init] = fetched.mock.calls[0]!;
    expect(String(url)).toMatch(/\/dashboard\/query$/);
    expect(new Headers(init?.headers).get("accept")).toBe(
      "application/x-ndjson"
    );
    expect(init?.signal).toBe(signal);
    expect(JSON.parse(String(init?.body))).toEqual({ queries: [count, count] });
  });

  it("sends the layout read's token beside the queries when it has one, and no field when it has none", async () => {
    const answer = () =>
      Response.json({
        results: [{ ok: true, result: { op: "count", total: 4 } }],
      });
    fetched.mockResolvedValueOnce(answer()).mockResolvedValueOnce(answer());

    await fetchWidgetBatch([count], {
      onSlots: vi.fn(),
      readAheadToken: "load-1",
    });
    await fetchWidgetBatch([count], { onSlots: vi.fn() });

    const [named, unnamed] = fetched.mock.calls.map(([, init]) =>
      JSON.parse(String(init?.body))
    );
    expect(named).toEqual({ queries: [count], readAheadToken: "load-1" });
    // No layout read to name: the body is the queries alone, as an older
    // server reads it.
    expect(unnamed).toEqual({ queries: [count] });
  });

  it("reads a line split across two chunks as one line", async () => {
    const stream = streamedResponse();
    fetched.mockResolvedValue(stream.response);
    const onSlots = vi.fn();

    const done = fetchWidgetBatch([count], { onSlots });
    const whole = line(0, 5);
    stream.write(whole.slice(0, 10));
    stream.write(whole.slice(10));
    stream.end();

    expect(await done).toEqual([
      { ok: true, result: { op: "count", total: 5 } },
    ]);
    expect(onSlots).toHaveBeenCalledTimes(1);
  });

  it("leaves a slot the stream never carried missing, and drops a line that is not one", async () => {
    const stream = streamedResponse();
    fetched.mockResolvedValue(stream.response);

    const done = fetchWidgetBatch([count, count], { onSlots: vi.fn() });
    // Not JSON, an index outside the batch, and no index at all: none is any query's slot.
    stream.write("not json\n");
    stream.write(`${JSON.stringify({ index: 7, slot: { ok: true } })}\n`);
    stream.write(`${JSON.stringify({ slot: { ok: true } })}\n`);
    stream.write(line(0, 1));
    stream.end();

    expect(await done).toEqual([
      { ok: true, result: { op: "count", total: 1 } },
      undefined,
    ]);
  });

  it("reads today's JSON answer whole, when that is what came back", async () => {
    // A proxy that strips `Accept`, or an older server, answers JSON to a client that asked
    // for lines.
    fetched.mockResolvedValue(
      Response.json({
        results: [{ ok: true, result: { op: "count", total: 4 } }],
      })
    );

    expect(await fetchWidgetBatch([count], { onSlots: vi.fn() })).toEqual([
      { ok: true, result: { op: "count", total: 4 } },
    ]);
  });

  it("rejects a refused request with its parsed error, as the admin's fetcher does", async () => {
    fetched.mockResolvedValue(
      Response.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Bad batch",
            requestId: "r1",
          },
        },
        { status: 400 }
      )
    );

    await expect(
      fetchWidgetBatch([count], { onSlots: vi.fn() })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a stream cut off partway, after handing over what did arrive", async () => {
    const stream = streamedResponse();
    fetched.mockResolvedValue(stream.response);
    const onSlots = vi.fn();

    const done = fetchWidgetBatch([count, count], { onSlots });
    stream.write(line(0, 3));
    await vi.waitFor(() => expect(onSlots).toHaveBeenCalledTimes(1));
    stream.fail();

    await expect(done).rejects.toThrow(/network error/);
  });

  it("announces a newer schema version, as every other admin request does", async () => {
    window.__nextlySchemaVersion = 3;
    const heard = vi.fn();
    window.addEventListener("nextly:schema-updated", heard);
    fetched.mockResolvedValue(
      Response.json(
        { results: [] },
        { headers: { "X-Nextly-Schema-Version": "4" } }
      )
    );

    await fetchWidgetBatch([], { onSlots: vi.fn() });

    window.removeEventListener("nextly:schema-updated", heard);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(window.__nextlySchemaVersion).toBe(4);
  });
});
