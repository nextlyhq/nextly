/**
 * The mutation clients return what the server sent, not only the row.
 *
 * `warnings` reports side effects that failed AFTER the write committed, and
 * every client returned `result.item`, so the array was discarded here — one
 * layer below anything that could have shown it.
 *
 * This layer needs its own coverage: the hook tests mock `entryApi` itself, so
 * they stand in for exactly the code below and would pass with it reverted.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../lib/api/protectedApi", () => ({
  protectedApi: { post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import { protectedApi } from "../../lib/api/protectedApi";
import { entryApi } from "../entryApi";

const post = protectedApi.post as unknown as ReturnType<typeof vi.fn>;
const patch = protectedApi.patch as unknown as ReturnType<typeof vi.fn>;
const del = protectedApi.delete as unknown as ReturnType<typeof vi.fn>;

const item = { id: "e1", title: "Hello" };
const warnings = [
  {
    phase: "afterUpdate",
    collection: "posts",
    code: "INTERNAL_ERROR",
    message: "The search index could not be updated.",
  },
];

/** Each write client, with the transport it uses. */
const CLIENTS = [
  {
    name: "create",
    transport: post,
    call: () => entryApi.create("posts", { title: "Hello" }),
  },
  {
    name: "update",
    transport: patch,
    call: () => entryApi.update("posts", "e1", { title: "Hello" }),
  },
  {
    name: "delete",
    transport: del,
    call: () => entryApi.delete("posts", "e1"),
  },
];

beforeEach(() => vi.clearAllMocks());

describe.each(CLIENTS)("entryApi.$name", ({ transport, call }) => {
  it("returns the warnings the response carried", async () => {
    transport.mockResolvedValue({ message: "ok", item, warnings });

    await expect(call()).resolves.toEqual({ item, warnings });
  });

  it("returns the row with no warnings key when the response had none", async () => {
    // The server omits `warnings` entirely for a clean write, and the client
    // must not invent an empty array — a caller branching on presence would
    // then report a failure that did not happen.
    transport.mockResolvedValue({ message: "ok", item });

    const result = await call();

    expect(result.item).toEqual(item);
    expect(result.warnings).toBeUndefined();
  });
});
