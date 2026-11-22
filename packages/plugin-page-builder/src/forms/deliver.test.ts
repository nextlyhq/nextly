/**
 * Passing answers on, through core's real `safeFetch`.
 *
 * An address that is not `https` to a public host is refused before any
 * connection is made: a server listening on the loopback address it names
 * sees nothing. The sends that do go out are made to servers this test
 * runs on the loopback, so for those (and only those) the guard is told the
 * loopback is allowed; what is held there is what happens to the answers, a
 * redirect and a slow answer.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { safeFetch } from "nextly";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CheckedAnswer } from "./answers";
import {
  DELIVERY_TIMEOUT_MS,
  deliverAnswers,
  type DeliveryFetch,
} from "./deliver";

/** A request a test server received. */
interface Received {
  readonly method?: string;
  readonly url?: string;
  readonly type?: string;
  readonly body: string;
}

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      server =>
        new Promise<void>(resolve => {
          server.closeAllConnections();
          server.close(() => resolve());
        })
    )
  );
});

/** A server on the loopback answering each request with `answer`. */
async function serve(
  answer: (
    request: IncomingMessage,
    respond: (status: number, headers?: Record<string, string>) => void
  ) => void
): Promise<{ base: string; port: number; received: Received[] }> {
  const received: Received[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", chunk => {
      body += String(chunk);
    });
    request.on("end", () => {
      received.push({
        method: request.method,
        url: request.url,
        type: request.headers["content-type"],
        body,
      });
      answer(request, (status, headers) => {
        response.writeHead(status, headers);
        response.end();
      });
    });
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, port, received };
}

/** `safeFetch` with the loopback allowed, for this test's own servers only. */
const toTestServer =
  (extra: { timeoutMs?: number } = {}): DeliveryFetch =>
  (address, init) =>
    safeFetch(address, { ...init, ...extra, allowLocalhost: true });

const ANSWERS: CheckedAnswer[] = [
  { name: "name", values: ["Ada Lovelace"] },
  { name: "topics", values: ["a", "b"] },
  { name: "note", values: [] },
];

describe("an address the guard refuses", () => {
  it("is refused before anything connects, for the loopback a server listens on", async () => {
    const { port, received } = await serve((_, respond) => respond(200));
    for (const address of [
      `https://127.0.0.1:${port}/hook`,
      `https://localhost:${port}/hook`,
      `http://127.0.0.1:${port}/hook`,
    ]) {
      expect(await deliverAnswers(address, ANSWERS), address).toEqual({
        ok: false,
        reason: "refused",
      });
    }
    expect(received).toEqual([]);
  });

  it.each([
    "https://10.0.0.1/hook",
    "https://192.168.1.10/hook",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/hook",
    "https://[::ffff:127.0.0.1]/hook",
    "https://[fd00::1]/hook",
    "https://metadata.google.internal/",
    "http://example.com/hook",
    "mailto:someone@example.com",
    "not an address",
  ])("refuses %s", async address => {
    expect(await deliverAnswers(address, ANSWERS)).toEqual({
      ok: false,
      reason: "refused",
    });
  });
});

describe("a send that goes out", () => {
  it("posts the answers once, as a form, every field included", async () => {
    const { base, received } = await serve((_, respond) => respond(204));
    const outcome = await deliverAnswers(
      `${base}/hook?key=k`,
      ANSWERS,
      toTestServer()
    );

    expect(outcome).toEqual({ ok: true });
    expect(received).toEqual([
      {
        method: "POST",
        url: "/hook?key=k",
        type: "application/x-www-form-urlencoded;charset=UTF-8",
        body: "name=Ada+Lovelace&topics=a&topics=b&note=",
      },
    ]);
  });

  it("follows no redirect, and counts one as a failed send", async () => {
    const elsewhere = await serve((_, respond) => respond(200));
    const { base, received } = await serve((_, respond) =>
      respond(307, { location: `${elsewhere.base}/stolen` })
    );
    const outcome = await deliverAnswers(
      `${base}/hook`,
      ANSWERS,
      toTestServer()
    );

    expect(outcome).toEqual({ ok: false, reason: "redirected", status: 307 });
    expect(received.length).toBe(1);
    expect(elsewhere.received).toEqual([]);
  });

  it("gives up on an address too slow to answer", async () => {
    const { base } = await serve(() => {
      // Never answers.
    });
    const outcome = await deliverAnswers(
      `${base}/hook`,
      ANSWERS,
      toTestServer({ timeoutMs: 150 })
    );
    expect(outcome).toEqual({ ok: false, reason: "timed-out" });
  });

  it("allows ten seconds, and only https", async () => {
    const send = vi.fn<DeliveryFetch>(
      async () => new Response(null, { status: 200 })
    );
    await deliverAnswers("https://hooks.example.com/", ANSWERS, send);

    expect(DELIVERY_TIMEOUT_MS).toBe(10_000);
    expect(send).toHaveBeenCalledWith(
      "https://hooks.example.com/",
      expect.objectContaining({
        timeoutMs: 10_000,
        allowedProtocols: ["https:"],
        method: "POST",
      })
    );
    // Never the loopback switch a test server needs.
    expect(send.mock.calls[0]?.[1]).not.toHaveProperty("allowLocalhost");
  });

  it("counts an answer other than success as a failed send", async () => {
    const { base } = await serve((_, respond) => respond(500));
    expect(
      await deliverAnswers(`${base}/hook`, ANSWERS, toTestServer())
    ).toEqual({
      ok: false,
      reason: "answered",
      status: 500,
    });
  });
});
