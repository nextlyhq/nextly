/**
 * What the transport actually puts on the wire.
 *
 * Driven against a real `node:http` server rather than a fake, because all
 * three properties here are about bytes and timing the transport produces
 * ITSELF. `fetch.test.ts` injects `send`, so nothing it does can observe the
 * Host header that was written, whether a body arrived, or when a socket was
 * torn down — and every one of those was wrong while that suite was green.
 */
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import type { ResolvedAddress } from "../fetch";
import { sendVetted } from "../transport";

const LOOPBACK: ResolvedAddress = { address: "127.0.0.1", family: 4 };

let server: Server | undefined;

afterEach(async () => {
  if (!server) return;
  await new Promise<void>(resolve => {
    server?.close(() => {
      resolve();
    });
  });
  server = undefined;
});

/** Start a server on a free port and return the URL that reaches it. */
async function listen(
  handler: Parameters<typeof createServer>[1]
): Promise<URL> {
  server = createServer(handler);
  await new Promise<void>(resolve => {
    server?.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;
  return new URL(`http://localhost:${String(port)}/`);
}

function send(url: URL, init: RequestInit, ms = 5_000): Promise<Response> {
  return sendVetted({
    url,
    address: LOOPBACK,
    init,
    deadlineAt: Date.now() + ms,
    maxBodyBytes: 1_000_000,
  });
}

describe("the Host header", () => {
  it("is the vetted URL's, even when the caller supplies another", async () => {
    // The boundary: DNS and TLS are checked against the declared name, so a
    // caller-supplied Host is never re-vetted. A reverse proxy at the allowed
    // address would route on it to a virtual host the manifest never declared.
    const url = await listen((req, res) => {
      res.end(JSON.stringify({ host: req.headers.host }));
    });

    const response = await send(url, {
      headers: { host: "internal.example", Host: "other.example" },
    });

    expect(await response.json()).toEqual({ host: url.host });
  });
});

describe("request bodies", () => {
  it("sends a URLSearchParams body, with its content type", async () => {
    // The OAuth token exchange shape. This reached providers empty while
    // keeping its method and headers, which reads as the provider rejecting
    // the credentials rather than as a client that sent nothing.
    const url = await listen((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        res.end(
          JSON.stringify({
            body: Buffer.concat(chunks).toString(),
            type: req.headers["content-type"],
          })
        );
      });
    });

    const response = await send(url, {
      method: "POST",
      body: new URLSearchParams({ grant_type: "authorization_code" }),
    });

    expect(await response.json()).toEqual({
      body: "grant_type=authorization_code",
      type: "application/x-www-form-urlencoded;charset=UTF-8",
    });
  });

  it("sends a typed-array body byte for byte", async () => {
    const url = await listen((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        res.end(JSON.stringify({ bytes: [...Buffer.concat(chunks)] }));
      });
    });

    const response = await send(url, {
      method: "POST",
      body: new Uint8Array([1, 2, 250]),
    });

    expect(await response.json()).toEqual({ bytes: [1, 2, 250] });
  });

  it("keeps the caller's explicit content type over the inferred one", async () => {
    // The inferred header was spread AFTER the caller's, so a JSON string sent
    // with `application/json` went out as `text/plain;charset=UTF-8` and
    // providers rejected an otherwise valid request.
    const url = await listen((req, res) => {
      res.end(JSON.stringify({ type: req.headers["content-type"] }));
    });

    const response = await send(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    });

    expect(await response.json()).toEqual({ type: "application/json" });
  });

  it("still infers a content type when the caller states none", async () => {
    // The control: letting the caller always win would drop the inferred
    // header entirely, and a form post would arrive undeclared.
    const url = await listen((req, res) => {
      res.end(JSON.stringify({ type: req.headers["content-type"] }));
    });

    const response = await send(url, {
      method: "POST",
      body: new URLSearchParams({ a: "1" }),
    });

    expect((await response.json()).type).toContain(
      "application/x-www-form-urlencoded"
    );
  });

  it("still sends a string body", async () => {
    // The one shape that already worked: it must keep working, or the fix
    // traded one silently dropped body for another.
    const url = await listen((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        res.end(Buffer.concat(chunks).toString());
      });
    });

    const response = await send(url, { method: "POST", body: "plain" });
    expect(await response.text()).toBe("plain");
  });
});

describe("the deadline", () => {
  it("fires on a server that TRICKLES, which an idle timeout never sees", async () => {
    // The separating property. `req.setTimeout` measures inactivity on one
    // socket, so a server writing a byte before each expiry is never idle and
    // holds the request open indefinitely. A wall-clock deadline ends it.
    const url = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      const timer = setInterval(() => res.write("."), 20);
      // Never ends on its own; the transport must be what stops this.
      res.on("close", () => {
        clearInterval(timer);
      });
    });

    const started = Date.now();
    await expect(send(url, {}, 300)).rejects.toThrow();
    // Bounded well under what a trickle would otherwise run to, and the
    // assertion is that it ENDED rather than exactly when.
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it("leaves a response that arrives inside the deadline alone", async () => {
    // The control: a deadline that rejects everything would pass the test
    // above while breaking every real call.
    const url = await listen((_req, res) => {
      res.end("in time");
    });
    const response = await send(url, {}, 5_000);
    expect(await response.text()).toBe("in time");
  });
});
