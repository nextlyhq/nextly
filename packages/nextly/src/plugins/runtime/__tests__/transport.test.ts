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

describe("bodyless response statuses", () => {
  it("returns a 204 instead of throwing on it", async () => {
    // The platform `Response` constructor REJECTS a non-null body for 204,
    // 205 and 304, so handing it an empty buffer is not harmlessly equivalent
    // to handing it null: an ordinary provider `DELETE` answering 204 made
    // `ctx.fetch` raise rather than return the response it was waiting for.
    const url = await listen((_req, res) => {
      res.writeHead(204);
      res.end();
    });

    const response = await send(url, { method: "DELETE" });
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
  });

  it("still returns a body on a status that permits one", async () => {
    // The control: passing null for everything would satisfy the test above
    // while emptying every ordinary response.
    const url = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("payload");
    });

    const response = await send(url, {});
    expect(await response.text()).toBe("payload");
  });
});

describe("repeated response headers", () => {
  it("keeps each Set-Cookie separate", async () => {
    // Joining them with ", " produces one malformed value that nobody can
    // split back apart, because an `Expires` attribute contains a comma of
    // its own — so `getSetCookie()` reported one cookie where the origin sent
    // two, and a session cookie beside a CSRF cookie became neither.
    const url = await listen((_req, res) => {
      res.setHeader("set-cookie", [
        "a=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/",
        "b=2; Path=/; HttpOnly",
      ]);
      res.end("ok");
    });

    const response = await send(url, {});
    const cookies = response.headers.getSetCookie();

    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain("a=1");
    expect(cookies[0]).toContain("Expires=Wed, 21 Oct 2026");
    expect(cookies[1]).toContain("b=2");
  });

  it("still comma-joins a header whose grammar allows it", async () => {
    // The control. Emitting every repeated header separately would satisfy
    // the assertion above while changing how ordinary list headers arrive.
    const url = await listen((_req, res) => {
      res.setHeader("x-forwarded-for", ["203.0.113.1", "198.51.100.2"]);
      res.end("ok");
    });

    const response = await send(url, {});
    expect(response.headers.get("x-forwarded-for")).toBe(
      "203.0.113.1, 198.51.100.2"
    );
  });
});

describe("the deadline covers work BEFORE the socket", () => {
  it("refuses a request body that never finishes", async () => {
    // `materializeBody` consumes the body before the request exists, so the
    // socket timer cannot cover it: a stream that never closes held
    // `ctx.fetch` open indefinitely without a byte leaving the process, and
    // the documented bound was one no caller could rely on.
    const url = await listen((_req, res) => {
      res.end("ok");
    });

    // Never enqueues and never closes.
    const body = new ReadableStream({ start() {} });

    const started = Date.now();
    await expect(
      sendVetted({
        url,
        address: LOOPBACK,
        init: { method: "POST", body },
        deadlineAt: started + 150,
        maxBodyBytes: 1_000_000,
      })
    ).rejects.toMatchObject({
      logContext: { reason: "outbound-timeout" },
    });
    // Bounded by the deadline rather than by the test timeout.
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("lets an ordinary body through", async () => {
    // The control: refusing every body would satisfy the assertion above
    // while breaking every POST the transport exists to make.
    const url = await listen((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        res.end(Buffer.concat(chunks).toString());
      });
    });

    const response = await send(url, { method: "POST", body: "hello" });
    expect(await response.text()).toBe("hello");
  });
});

describe("an expired body read is CANCELLED, not merely abandoned", () => {
  it("releases the stream when the deadline passes", async () => {
    // Racing a timer answers the caller and leaves the read running: nothing
    // reaches `arrayBuffer()`, so it goes on pulling from a stream nobody is
    // waiting for. One per call, so they accumulate. `cancel` firing is the
    // observable difference between stopping the WAIT and stopping the WORK.
    const url = await listen((_req, res) => {
      res.end("ok");
    });

    let cancelled = false;
    const body = new ReadableStream({
      start() {
        // Never enqueues, never closes.
      },
      cancel() {
        cancelled = true;
      },
    });

    await expect(
      sendVetted({
        url,
        address: LOOPBACK,
        init: { method: "POST", body },
        deadlineAt: Date.now() + 150,
        maxBodyBytes: 1_000_000,
      })
    ).rejects.toMatchObject({ logContext: { reason: "outbound-timeout" } });

    // The abort propagates asynchronously; give the microtask queue a turn.
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(cancelled).toBe(true);
  });

  it("does not cancel a body that finishes in time", async () => {
    // The control: aborting unconditionally would satisfy the assertion above
    // while breaking every request that works.
    const url = await listen((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        res.end(Buffer.concat(chunks).toString());
      });
    });

    let cancelled = false;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("hello"));
        controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });

    const response = await sendVetted({
      url,
      address: LOOPBACK,
      init: { method: "POST", body },
      deadlineAt: Date.now() + 5_000,
      maxBodyBytes: 1_000_000,
    });

    expect(await response.text()).toBe("hello");
    expect(cancelled).toBe(false);
  });
});
