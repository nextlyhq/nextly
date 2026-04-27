// Tests for the HTTP IPC client against a real local server fixture rather
// than a fetch mock so we exercise real request/response handling.
import { type AddressInfo, createServer, type Server } from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IpcClient } from "./ipc-client.js";

function createIpcServer(
  token: string,
  handler: (
    method: string,
    path: string,
    body: string
  ) => { status: number; body?: string }
): Promise<{ server: Server; baseUrl: string }> {
  return new Promise(resolve => {
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", chunk => {
        body += String(chunk);
      });
      req.on("end", () => {
        if (req.headers["x-nextly-ipc-token"] !== token) {
          res.statusCode = 401;
          res.end();
          return;
        }
        const result = handler(req.method ?? "GET", req.url ?? "/", body);
        res.statusCode = result.status;
        if (result.body !== undefined) {
          res.setHeader("content-type", "application/json");
          res.end(result.body);
        } else {
          res.end();
        }
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

describe("IpcClient", () => {
  const token = "t".repeat(32);
  let server: Server | null = null;
  let baseUrl = "";

  afterEach(() => {
    if (server) server.close();
    server = null;
  });

  it("healthCheck returns true when server responds 200 with matching token", async () => {
    const up = await createIpcServer(token, () => ({ status: 200 }));
    server = up.server;
    baseUrl = up.baseUrl;
    const client = new IpcClient({ baseUrl, token });
    expect(await client.healthCheck()).toBe(true);
  });

  it("healthCheck returns false when token is wrong", async () => {
    const up = await createIpcServer(token, () => ({ status: 200 }));
    server = up.server;
    baseUrl = up.baseUrl;
    const client = new IpcClient({ baseUrl, token: "x".repeat(32) });
    expect(await client.healthCheck()).toBe(false);
  });

  it("healthCheck returns false when server is unreachable", async () => {
    const client = new IpcClient({
      baseUrl: "http://127.0.0.1:1",
      token,
      retryMs: 50,
      maxRetryMs: 100,
    });
    expect(await client.healthCheck()).toBe(false);
  });

  it("postPending returns normally on 204", async () => {
    const received = vi.fn();
    const up = await createIpcServer(token, (method, path, body) => {
      received(method, path, body);
      return { status: 204 };
    });
    server = up.server;
    baseUrl = up.baseUrl;
    const client = new IpcClient({ baseUrl, token });
    await expect(
      client.postPending({
        slug: "posts",
        classification: "safe",
        diff: {},
        requestedAt: new Date().toISOString(),
      })
    ).resolves.toBeUndefined();
    expect(received).toHaveBeenCalledWith(
      "POST",
      "/__nextly/pending",
      expect.any(String)
    );
  });

  it("getApplyRequests returns [] on server error rather than throwing", async () => {
    const up = await createIpcServer(token, () => ({ status: 500 }));
    server = up.server;
    baseUrl = up.baseUrl;
    const client = new IpcClient({ baseUrl, token });
    expect(await client.getApplyRequests()).toEqual([]);
  });
});
