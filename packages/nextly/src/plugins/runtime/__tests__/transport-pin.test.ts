/**
 * Where the transport's socket actually goes, and what it hands back.
 *
 * Against real local servers, because each property is about a connection or
 * bytes the transport produces itself: the address a socket reached, a socket
 * another library parked in Node's global pool, a status line the platform
 * `Response` cannot represent, and a compressed body.
 */
import {
  Agent as HttpAgent,
  createServer,
  get as httpGet,
  globalAgent,
  type Server,
} from "node:http";
import {
  createConnection,
  createServer as createTcpServer,
  type AddressInfo,
} from "node:net";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ResolvedAddress } from "../fetch";
import { connectedToVetted, sendVetted } from "../transport";

const LOOPBACK: ResolvedAddress = { address: "127.0.0.1", family: 4 };

const servers: Array<{ close: (cb: () => void) => void }> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      server =>
        new Promise<void>(resolve => {
          server.close(() => resolve());
        })
    )
  );
});

/** Start an HTTP server on `host` (and `port`, if given); return its port. */
async function listen(
  handler: Parameters<typeof createServer>[1],
  host = "127.0.0.1",
  port = 0
): Promise<number> {
  const server: Server = createServer(handler);
  // Keep-alive connections would otherwise hold `close` open until they idle.
  servers.push({
    close: cb => {
      server.closeAllConnections();
      server.close(cb);
    },
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });
  return (server.address() as AddressInfo).port;
}

function send(
  url: string,
  init: RequestInit = {},
  address: ResolvedAddress = LOOPBACK,
  maxBodyBytes = 1_000_000
): Promise<Response> {
  return sendVetted({
    url: new URL(url),
    address,
    init,
    deadlineAt: Date.now() + 3_000,
    maxBodyBytes,
  });
}

describe("the vetted address is where the socket goes", () => {
  it("connects to it for a name no resolver could answer", async () => {
    // `.invalid` never resolves, so reaching the server proves the connection
    // used the vetted address rather than asking DNS. Every case using
    // `localhost` would pass with or without the pin: the system resolver
    // maps it to the same address anyway.
    const port = await listen((_req, res) => res.end("pinned"));
    const response = await send(`http://pin-check.invalid:${String(port)}/`);
    expect(await response.text()).toBe("pinned");
  });

  it("never reuses a socket another library parked in the global pool", async () => {
    // Two servers on ONE port at two loopback addresses: a pooled socket is
    // keyed by name and port, so a socket opened to the name at the first
    // address would be handed to a request vetted for the second.
    const portA = await listen((_req, res) => res.end("unvetted"));
    try {
      await listen((_req, res) => res.end("vetted"), "127.0.0.2", portA);
    } catch {
      // A platform without a second loopback address cannot stage this; the
      // address comparison below still covers the rule on its own.
      return;
    }
    const url = `http://reuse.test:${String(portA)}/`;

    // Another library's request, through the global agent, pinned to A.
    await new Promise<void>((resolve, reject) => {
      httpGet(
        url,
        {
          agent: globalAgent,
          lookup: (_h, _o, cb) =>
            cb(null, [{ address: "127.0.0.1", family: 4 }] as never, 4),
        },
        res => {
          res.resume();
          res.on("end", () => resolve());
        }
      ).on("error", reject);
    });

    const response = await send(url, {}, { address: "127.0.0.2", family: 4 });
    expect(await response.text()).toBe("vetted");
    globalAgent.destroy();
  });
});

describe("a socket that reached another address", () => {
  it("is refused before a single request byte is written", async () => {
    // The pin decides where the socket SHOULD go; this check is what holds if
    // something else — an agent, a library hooking connections — sent it
    // elsewhere. Forced here: every connection goes to 127.0.0.1 while the
    // request was vetted for 127.0.0.2.
    let requests = 0;
    const port = await listen((_req, res) => {
      requests += 1;
      res.end("unvetted");
    });
    const spy = vi
      .spyOn(HttpAgent.prototype, "createConnection")
      .mockImplementation(options =>
        createConnection({ host: "127.0.0.1", port: Number(options.port) })
      );
    try {
      await expect(
        send(
          `http://elsewhere.test:${String(port)}/`,
          { method: "POST", body: "secret" },
          {
            address: "127.0.0.2",
            family: 4,
          }
        )
      ).rejects.toMatchObject({
        logContext: expect.objectContaining({
          reason: "outbound-socket-address-mismatch",
        }),
      });
    } finally {
      spy.mockRestore();
    }
    expect(requests).toBe(0);
  });
});

describe("connectedToVetted", () => {
  it("accepts the vetted address", () => {
    expect(
      connectedToVetted("127.0.0.2", { address: "127.0.0.2", family: 4 })
    ).toBe(true);
  });

  it("accepts the IPv4-mapped spelling of the same address", () => {
    expect(
      connectedToVetted("::ffff:127.0.0.2", { address: "127.0.0.2", family: 4 })
    ).toBe(true);
  });

  it("refuses a socket that reached another address", () => {
    // The separating case: a comparison that only checked the family, or
    // only that an address was present, would accept this.
    expect(
      connectedToVetted("127.0.0.1", { address: "127.0.0.2", family: 4 })
    ).toBe(false);
  });

  it("refuses a socket that reports no address", () => {
    expect(connectedToVetted(undefined, LOOPBACK)).toBe(false);
  });
});

describe("a status the platform Response cannot represent", () => {
  it("is refused within the deadline instead of hanging", async () => {
    // Node's parser takes any three-digit status; `new Response` throws
    // outside 200–599, and thrown inside the response listener that left the
    // call pending with nothing to settle it.
    const sockets = new Set<import("node:net").Socket>();
    const server = createTcpServer(socket => {
      sockets.add(socket);
      socket.end(
        "HTTP/1.1 600 Weird\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok"
      );
    });
    servers.push({
      close: cb => {
        for (const socket of sockets) socket.destroy();
        server.close(cb);
      },
    });
    await new Promise<void>(resolve =>
      server.listen(0, "127.0.0.1", () => resolve())
    );
    const { port } = server.address() as AddressInfo;

    await expect(
      send(`http://localhost:${String(port)}/`)
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      logContext: expect.objectContaining({ reason: "outbound-bad-response" }),
    });
  });
});

describe("a compressed response", () => {
  const payload = JSON.stringify({ keys: [] });

  it.each([
    ["gzip", gzipSync],
    ["br", brotliCompressSync],
    ["deflate", deflateSync],
  ] as const)(
    "comes back decoded when the server used %s",
    async (coding, compress) => {
      const port = await listen((_req, res) => {
        res.writeHead(200, {
          "content-type": "application/json",
          "content-encoding": coding,
        });
        res.end(compress(Buffer.from(payload)));
      });
      const response = await send(`http://localhost:${String(port)}/`);
      expect(await response.json()).toEqual({ keys: [] });
      // Decoded bytes no longer match the coding or length the server stated.
      expect(response.headers.get("content-encoding")).toBeNull();
    }
  );

  it("holds the DECODED body to the size cap", async () => {
    // A small compressed body can expand far past the wire cap.
    const port = await listen((_req, res) => {
      res.writeHead(200, { "content-encoding": "gzip" });
      res.end(gzipSync(Buffer.alloc(2_000_000)));
    });
    await expect(
      send(`http://localhost:${String(port)}/`, {}, LOOPBACK, 1_000_000)
    ).rejects.toMatchObject({
      logContext: expect.objectContaining({
        reason: "outbound-body-too-large",
      }),
    });
  });

  it("refuses a coding it cannot decode rather than handing back its bytes", async () => {
    const port = await listen((_req, res) => {
      res.writeHead(200, { "content-encoding": "zstd" });
      res.end("opaque");
    });
    await expect(
      send(`http://localhost:${String(port)}/`)
    ).rejects.toMatchObject({
      logContext: expect.objectContaining({
        reason: "outbound-unsupported-encoding",
      }),
    });
  });

  it("asks only for the codings it can decode", async () => {
    const port = await listen((req, res) =>
      res.end(req.headers["accept-encoding"] ?? "")
    );
    const response = await send(`http://localhost:${String(port)}/`);
    expect(await response.text()).toBe("gzip, deflate, br");
  });

  it("keeps an Accept-Encoding the caller chose", async () => {
    const port = await listen((req, res) =>
      res.end(req.headers["accept-encoding"] ?? "")
    );
    const response = await send(`http://localhost:${String(port)}/`, {
      headers: { "accept-encoding": "identity" },
    });
    expect(await response.text()).toBe("identity");
  });
});

describe("the request framing on the wire", () => {
  /** A server answering with the framing headers and body it received. */
  async function echoFraming(): Promise<number> {
    return listen((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        res.end(
          JSON.stringify({
            contentLength: req.headers["content-length"] ?? null,
            transferEncoding: req.headers["transfer-encoding"] ?? null,
            body: Buffer.concat(chunks).toString(),
          })
        );
      });
    });
  }

  it("states the length of the body it writes, not the caller's", async () => {
    const port = await echoFraming();
    const response = await send(`http://localhost:${String(port)}/`, {
      method: "POST",
      body: "hello",
      headers: { "content-length": "999", "transfer-encoding": "chunked" },
    });
    expect(await response.json()).toEqual({
      contentLength: "5",
      transferEncoding: null,
      body: "hello",
    });
  });

  it("delivers the whole body whatever length the caller declared", async () => {
    const port = await echoFraming();
    const body = JSON.stringify({ id: "a-long-identifier" });
    const response = await send(`http://localhost:${String(port)}/`, {
      method: "DELETE",
      body,
      headers: { "Content-Length": "1", "content-type": "application/json" },
    });
    expect(((await response.json()) as { body: string }).body).toBe(body);
  });
});
