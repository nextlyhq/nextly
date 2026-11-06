/**
 * The development warning for an outbound call made from an in-transaction
 * handler, against a real local server: `fetch` and `http.request` are both
 * seen, the warning names the handler's owner and is given once per owner,
 * a call made outside a handler is not reported, and outside development
 * nothing is watched at all.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

import {
  runWatched,
  stopWatchingOutboundCalls,
  watchOutboundCalls,
} from "../in-transaction-outbound";

let server: http.Server;
let url: string;

beforeAll(async () => {
  server = http.createServer((_request, response) => {
    response.end("ok");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/path?token=secret`;
});

afterAll(async () => {
  // `fetch` keeps its connection alive, which would hold `close` open.
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
});

afterEach(() => {
  stopWatchingOutboundCalls();
  vi.unstubAllEnvs();
});

/** A request through `http.request`, read to the end. */
function httpGet(target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    http
      .get(target, response => {
        response.resume();
        response.on("end", resolve);
      })
      .on("error", reject);
  });
}

/** A request through the runtime's `fetch`, read to the end. */
async function fetchGet(target: string): Promise<void> {
  await (await fetch(target)).text();
}

function logger() {
  return { warn: vi.fn<(payload: object) => void>() };
}

it("warns once per owner for a fetch or http.request made from a handler, in development", async () => {
  vi.stubEnv("NODE_ENV", "development");
  const log = logger();
  watchOutboundCalls(log);

  await runWatched("plugin:@acme/a", () => fetchGet(url));
  await runWatched("plugin:@acme/a", () => httpGet(url));
  await runWatched("plugin:@acme/b", () => httpGet(url));

  expect(log.warn).toHaveBeenCalledTimes(2);
  const payloads = log.warn.mock.calls.map(([payload]) => payload);
  expect(payloads[0]).toMatchObject({
    kind: "in-transaction-outbound-call",
    owner: "plugin:@acme/a",
  });
  expect(payloads[1]).toMatchObject({ owner: "plugin:@acme/b" });
  // The host only: a path or a query can carry a token.
  expect(JSON.stringify(payloads)).not.toContain("secret");
  expect((payloads[1] as { target?: unknown }).target).toMatch(/^127\.0\.0\.1/);
});

it("does not warn for a call made outside a handler", async () => {
  vi.stubEnv("NODE_ENV", "development");
  const log = logger();
  watchOutboundCalls(log);

  await fetchGet(url);
  await httpGet(url);

  expect(log.warn).not.toHaveBeenCalled();
});

it("watches nothing outside development", async () => {
  vi.stubEnv("NODE_ENV", "production");
  const log = logger();
  watchOutboundCalls(log);

  await runWatched("plugin:@acme/a", () => fetchGet(url));
  await runWatched("plugin:@acme/a", () => httpGet(url));

  expect(log.warn).not.toHaveBeenCalled();
});
