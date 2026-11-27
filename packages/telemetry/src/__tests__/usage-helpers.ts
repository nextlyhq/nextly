// Shared pieces for the usage-data tests: a receiver on this machine that
// records what reaches it, a fetch that records what it was asked to send,
// and a spy on Node's network layer that sees every outgoing connection,
// whoever opens it.
import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/** A machine id and a site id in the catalog's formats. */
export const MACHINE_ID = "a".repeat(64);
export const SITE_ID = "b".repeat(32);

export interface Receiver {
  /** The ingest address to give a session (ends in `/`). */
  endpoint: string;
  /** Each request body received, parsed. */
  bodies: unknown[];
  /** Each request's path and headers. */
  requests: { path: string; headers: Record<string, unknown> }[];
  close(): Promise<void>;
}

export interface ReceiverOptions {
  /** Accept the connection and never answer. */
  silent?: boolean;
}

/** A local HTTP receiver standing in for the ingest address. */
export async function startReceiver(
  opts: ReceiverOptions = {}
): Promise<Receiver> {
  const bodies: unknown[] = [];
  const requests: Receiver["requests"] = [];
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => (raw += chunk.toString("utf8")));
    req.on("end", () => {
      requests.push({ path: req.url ?? "", headers: { ...req.headers } });
      bodies.push(JSON.parse(raw));
      if (!opts.silent) res.end("{}");
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${port}/`,
    bodies,
    requests,
    close: () =>
      new Promise<void>(resolve => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** A fetch that records each call and answers 200 without any network. */
export function recordingFetch(): {
  fetch: typeof fetch;
  calls: { url: string; body: unknown; headers: Record<string, string> }[];
} {
  const calls: {
    url: string;
    body: unknown;
    headers: Record<string, string>;
  }[] = [];
  const fake = (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body)),
      headers: { ...(init?.headers as Record<string, string>) },
    });
    return Promise.resolve(new Response("{}"));
  };
  return { fetch: fake as typeof fetch, calls };
}

/**
 * Records every client socket Node opens while it is watching, through the
 * `net.client.socket` diagnostics channel that `net` publishes for each one,
 * so it sees connections from `fetch` as well as from `http` or `net`.
 */
export function watchConnections(): { count(): number; stop(): void } {
  let count = 0;
  const onSocket = () => {
    count += 1;
  };
  subscribe("net.client.socket", onSocket);
  return {
    count: () => count,
    stop: () => unsubscribe("net.client.socket", onSocket),
  };
}

/** An environment with nothing that turns usage data off. */
export const CLEAN_ENV: Readonly<Record<string, string>> = {};
