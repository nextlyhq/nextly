// Tests for startIpcServer. Spins a real HTTP server so the end-to-end
// Node-to-fetch-to-dispatcher path is exercised (not just the dispatcher
// logic which ipc-dispatcher.test.ts covers directly).
import { afterEach, describe, expect, it } from "vitest";

import { startIpcServer, type IpcServerHandle } from "./ipc-server.js";

const TOKEN = "t".repeat(32);

// Request a free port. 0 tells the OS to assign one; we read it back from the
// returned handle.
const EPHEMERAL_PORT = 0;

describe("startIpcServer", () => {
  let handle: IpcServerHandle | null = null;

  afterEach(async () => {
    if (handle) await handle.close();
    handle = null;
  });

  it("binds an HTTP server on 127.0.0.1 and serves /__nextly/health", async () => {
    handle = await startIpcServer({ port: EPHEMERAL_PORT, token: TOKEN });
    const res = await fetch(`http://127.0.0.1:${handle.port}/__nextly/health`, {
      headers: { "x-nextly-ipc-token": TOKEN },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("returns 401 when token header is missing or wrong", async () => {
    handle = await startIpcServer({ port: EPHEMERAL_PORT, token: TOKEN });
    const resNoToken = await fetch(
      `http://127.0.0.1:${handle.port}/__nextly/health`
    );
    expect(resNoToken.status).toBe(401);

    const resWrongToken = await fetch(
      `http://127.0.0.1:${handle.port}/__nextly/health`,
      {
        headers: { "x-nextly-ipc-token": "x".repeat(32) },
      }
    );
    expect(resWrongToken.status).toBe(401);
  });

  it("returns 404 for non-IPC paths so external probes do not leak details", async () => {
    handle = await startIpcServer({ port: EPHEMERAL_PORT, token: TOKEN });
    const res = await fetch(`http://127.0.0.1:${handle.port}/api/users`, {
      headers: { "x-nextly-ipc-token": TOKEN },
    });
    expect(res.status).toBe(404);
  });

  it("forwards POST /pending body to the onPending callback", async () => {
    let received: unknown = null;
    handle = await startIpcServer({
      port: EPHEMERAL_PORT,
      token: TOKEN,
      onPending: p => {
        received = p;
      },
    });
    const body = {
      slug: "posts",
      classification: "safe",
      diff: {},
      requestedAt: new Date().toISOString(),
    };
    const res = await fetch(
      `http://127.0.0.1:${handle.port}/__nextly/pending`,
      {
        method: "POST",
        headers: {
          "x-nextly-ipc-token": TOKEN,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );
    expect(res.status).toBe(204);
    expect(received).toEqual(expect.objectContaining({ slug: "posts" }));
  });

  it("close() shuts down the server cleanly", async () => {
    handle = await startIpcServer({ port: EPHEMERAL_PORT, token: TOKEN });
    const port = handle.port;
    await handle.close();
    handle = null;

    // After close, a subsequent fetch should fail (connection refused).
    await expect(
      fetch(`http://127.0.0.1:${port}/__nextly/health`, {
        headers: { "x-nextly-ipc-token": TOKEN },
      })
    ).rejects.toThrow();
  });
});
