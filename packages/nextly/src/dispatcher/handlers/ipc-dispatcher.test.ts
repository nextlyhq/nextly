// Tests for the child-side IPC dispatcher.
import { describe, expect, it, vi } from "vitest";

import { createIpcDispatcher } from "./ipc-dispatcher.js";

const TOKEN = "t".repeat(32);

function makeReq(
  path: string,
  init: RequestInit = { method: "GET" },
  token: string = TOKEN
): Request {
  const headers = new Headers(init.headers);
  headers.set("x-nextly-ipc-token", token);
  return new Request(`http://localhost${path}`, { ...init, headers });
}

describe("ipc-dispatcher", () => {
  it("returns null for non-IPC paths (falls through to app routing)", async () => {
    const d = createIpcDispatcher({
      token: TOKEN,
      onPending: vi.fn(),
      onApplied: vi.fn(),
    });
    const res = await d.handle(
      new Request("http://localhost/api/collections/posts")
    );
    expect(res).toBeNull();
  });

  it("rejects IPC requests with wrong token", async () => {
    const d = createIpcDispatcher({
      token: TOKEN,
      onPending: vi.fn(),
      onApplied: vi.fn(),
    });
    const res = await d.handle(
      makeReq("/__nextly/health", { method: "GET" }, "x".repeat(32))
    );
    expect(res?.status).toBe(401);
  });

  it("accepts /health with correct token", async () => {
    const d = createIpcDispatcher({
      token: TOKEN,
      onPending: vi.fn(),
      onApplied: vi.fn(),
    });
    const res = await d.handle(makeReq("/__nextly/health"));
    expect(res?.status).toBe(200);
  });

  it("forwards /pending payload to onPending callback", async () => {
    const onPending = vi.fn();
    const d = createIpcDispatcher({
      token: TOKEN,
      onPending,
      onApplied: vi.fn(),
    });
    const body = {
      slug: "posts",
      classification: "safe",
      diff: {},
      requestedAt: new Date().toISOString(),
    };
    const res = await d.handle(
      makeReq("/__nextly/pending", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      })
    );
    expect(res?.status).toBe(204);
    expect(onPending).toHaveBeenCalledWith(expect.objectContaining(body));
  });

  it("forwards /applied payload to onApplied callback", async () => {
    const onApplied = vi.fn();
    const d = createIpcDispatcher({
      token: TOKEN,
      onPending: vi.fn(),
      onApplied,
    });
    const body = {
      slug: "posts",
      newFields: [],
      newSchemaVersion: 2,
      appliedAt: new Date().toISOString(),
    };
    const res = await d.handle(
      makeReq("/__nextly/applied", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      })
    );
    expect(res?.status).toBe(204);
    expect(onApplied).toHaveBeenCalledWith(expect.objectContaining(body));
  });

  it("queues apply-requests and drains them on GET", async () => {
    const d = createIpcDispatcher({
      token: TOKEN,
      onPending: vi.fn(),
      onApplied: vi.fn(),
    });

    // Push two requests (returned promises we are not awaiting yet).
    void d.pushApplyRequest({ slug: "posts", newFields: [], resolutions: {} });
    void d.pushApplyRequest({ slug: "users", newFields: [], resolutions: {} });

    const res = await d.handle(makeReq("/__nextly/apply-request"));
    expect(res?.status).toBe(200);
    const body = (await res!.json()) as unknown[];
    expect(body).toHaveLength(2);

    // Second poll must return an empty list because first drained the queue.
    const res2 = await d.handle(makeReq("/__nextly/apply-request"));
    expect(await res2!.json()).toHaveLength(0);
  });

  it("pushApplyRequest resolves when /apply-result is posted back", async () => {
    const d = createIpcDispatcher({
      token: TOKEN,
      onPending: vi.fn(),
      onApplied: vi.fn(),
    });

    const pending = d.pushApplyRequest({
      slug: "posts",
      newFields: [],
      resolutions: {},
    });

    // Drain to discover the assigned id.
    const queueRes = await d.handle(makeReq("/__nextly/apply-request"));
    const queue = (await queueRes!.json()) as Array<{ id: string }>;
    const id = queue[0]?.id;
    expect(id).toBeTruthy();

    // Post the result as the wrapper would.
    await d.handle(
      makeReq("/__nextly/apply-result", {
        method: "POST",
        body: JSON.stringify({ id, success: true, newSchemaVersion: 5 }),
        headers: { "content-type": "application/json" },
      })
    );

    const result = await pending;
    expect(result).toEqual({ id, success: true, newSchemaVersion: 5 });
  });
});
