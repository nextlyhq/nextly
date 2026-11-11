/**
 * Fetching one of the site's pages as a crawler would, without ever letting
 * the fetch reach anywhere but the site itself.
 *
 * Every hop, the first and each redirect, is held to the same rule
 * (`addresses`): the site's own production addresses, the standard web
 * ports, no user name or password. The name is then looked up once, every
 * answer must be a public network address (`mayConnect`), and the connection
 * is made to that very address: the name is never looked up a second time,
 * so an answer that changes between the check and the connection changes
 * nothing. Redirects are followed by hand, five at most, and the whole fetch
 * stops at ten seconds or once the page passes five megabytes unpacked.
 *
 * @module received/fetch
 */
import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import type { Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

import {
  mayConnect,
  refusedAt,
  type Refusal,
  type RefusalReason,
} from "./addresses";
import { kindOfIp } from "./ip";

/** How far one fetch may go. */
export interface FetchLimits {
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
}

/** Ten seconds, five megabytes and five redirects. */
export const LIMITS: FetchLimits = {
  timeoutMs: 10_000,
  maxBytes: 5 * 1024 * 1024,
  maxRedirects: 5,
};

/** A network address a name resolves to. */
export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

/** Looks a name up: every address it answers. */
export type Resolve = (name: string) => Promise<ResolvedAddress[]>;

/** One request, to be made to exactly `ip`. */
export interface TransportRequest {
  url: URL;
  ip: string;
  family: 4 | 6;
  headers: Record<string, string>;
  signal: AbortSignal;
  maxBytes: number;
}

/** What one request answered, or that its page was too large to read. */
export type TransportAnswer =
  | {
      kind: "answer";
      status: number;
      headers: Record<string, string>;
      body: string;
    }
  | { kind: "too-large" };

/** Makes one request, to the address it is given. */
export type Transport = (request: TransportRequest) => Promise<TransportAnswer>;

/** Why a fetch did not end in a page. */
export type FailReason =
  | RefusalReason
  | "too-slow"
  | "too-large"
  | "too-many-redirects"
  | "no-answer"
  | "unreachable";

/** What one crawler received, or why it received nothing. */
export type Fetched =
  | {
      kind: "received";
      status: number;
      /** Where the page was finally read from. */
      url: string;
      /** Each address a redirect led to, in order. */
      redirects: string[];
      headers: Record<string, string>;
      html: string;
      ms: number;
    }
  | {
      kind: "failed";
      reason: FailReason;
      message: string;
      /** Each address a redirect led to before it failed. */
      redirects: string[];
      ms: number;
    };

/** What the fetch is held to, and what it reaches the network with. */
export interface FetchOptions {
  /** The site's production addresses: the only places a hop may be. */
  origins: readonly string[];
  resolve?: Resolve;
  transport?: Transport;
  limits?: FetchLimits;
}

/** The statuses that redirect to the address their `location` names. */
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** Every address the system's resolver answers for `name`. */
const systemResolve: Resolve = async name => {
  const answers = await lookup(name, { all: true, verbatim: true });
  return answers.map(({ address, family }) => ({
    address,
    family: family === 6 ? 6 : 4,
  }));
};

/** The headers of an answer, one value each, by lower-case name. */
function headersOf(message: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(message.headers)) {
    if (value === undefined) continue;
    headers[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  return headers;
}

/** The answer's body, unpacked as it was sent. */
function unpacked(message: IncomingMessage): Readable {
  const encoding = (message.headers["content-encoding"] ?? "")
    .trim()
    .toLowerCase();
  if (encoding === "gzip" || encoding === "x-gzip") {
    return message.pipe(createGunzip());
  }
  if (encoding === "deflate") return message.pipe(createInflate());
  if (encoding === "br") return message.pipe(createBrotliDecompress());
  return message;
}

/**
 * The transport the check uses: Node's own HTTP client, connected to the
 * address it is given whatever the name would resolve to, with a fresh
 * connection each time so none is shared with another address. The name
 * still travels as the request's host and, over https, as the name the
 * certificate is checked against.
 */
export function nodeTransport(
  request: TransportRequest
): Promise<TransportAnswer> {
  const pinned: LookupFunction = (_name, options, callback) => {
    if (options.all === true) {
      callback(null, [{ address: request.ip, family: request.family }]);
    } else {
      callback(null, request.ip, request.family);
    }
  };
  const send = request.url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const outgoing = send(
      request.url,
      {
        method: "GET",
        headers: request.headers,
        agent: false,
        lookup: pinned,
        signal: request.signal,
      },
      message => {
        const status = message.statusCode ?? 0;
        const headers = headersOf(message);
        // A redirect's body is never read: only where it leads matters.
        if (REDIRECTS.has(status)) {
          message.destroy();
          resolve({ kind: "answer", status, headers, body: "" });
          return;
        }
        const declared = Number(headers["content-length"]);
        if (Number.isFinite(declared) && declared > request.maxBytes) {
          message.destroy();
          resolve({ kind: "too-large" });
          return;
        }
        const body = unpacked(message);
        const chunks: Buffer[] = [];
        let size = 0;
        body.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > request.maxBytes) {
            message.destroy();
            body.destroy();
            resolve({ kind: "too-large" });
            return;
          }
          chunks.push(chunk);
        });
        body.on("end", () => {
          resolve({
            kind: "answer",
            status,
            headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
        body.on("error", reject);
      }
    );
    outgoing.on("error", reject);
    outgoing.end();
  });
}

/** `bytes` in megabytes, as few digits as say it. */
function megabytes(bytes: number): string {
  return String(Number((bytes / (1024 * 1024)).toFixed(2)));
}

/** A fetch that failed for `reason`. */
function failure(
  reason: FailReason,
  message: string,
  redirects: string[],
  started: number
): Fetched {
  return {
    kind: "failed",
    reason,
    message,
    redirects,
    ms: Date.now() - started,
  };
}

/** `refusal`, said of the hop a redirect led to where it was not the first. */
function refusedHop(
  refusal: Refusal,
  url: URL,
  redirects: string[],
  started: number
): Fetched {
  const said =
    redirects.length === 0
      ? refusal.message
      : `It redirected to ${url.href}. ${refusal.message}`;
  return failure(refusal.reason, said, redirects, started);
}

/** `reason` as an error, which it nearly always already is. */
function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

/** `promise`, or a rejection as soon as `signal` aborts. */
function until<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(asError(signal.reason));
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(asError(signal.reason));
    signal.addEventListener("abort", stop, { once: true });
    promise.then(
      value => {
        signal.removeEventListener("abort", stop);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", stop);
        reject(asError(error));
      }
    );
  });
}

/**
 * The network address to connect `url` to: the address itself where its
 * host is one, else the first answer for its name, once every answer has
 * been checked. A refusal where any answer is not one the check may reach,
 * and undefined where the name has none.
 */
async function addressFor(
  url: URL,
  origins: readonly string[],
  resolve: Resolve,
  signal: AbortSignal
): Promise<ResolvedAddress | Refusal | undefined> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const literal = kindOfIp(host) !== undefined;
  const answers = literal
    ? [{ address: host, family: host.includes(":") ? 6 : 4 } as const]
    : await until(resolve(host), signal).catch(() => []);
  if (answers.length === 0) return undefined;
  for (const answer of answers) {
    const refused = mayConnect(url, answer.address, origins);
    if (refused !== undefined) return refused;
  }
  return answers[0];
}

/** The headers a crawler sends. */
function crawlerHeaders(userAgent: string): Record<string, string> {
  return {
    "user-agent": userAgent,
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-encoding": "gzip, deflate, br",
  };
}

/** One hop of a fetch: what it answered, or how the fetch ends there. */
async function hop(
  url: URL,
  userAgent: string,
  context: {
    options: FetchOptions;
    limits: FetchLimits;
    signal: AbortSignal;
    redirects: string[];
    started: number;
  }
): Promise<TransportAnswer | Fetched> {
  const { options, limits, signal, redirects, started } = context;
  const refused = refusedAt(url, options.origins);
  if (refused !== undefined)
    return refusedHop(refused, url, redirects, started);
  const address = await addressFor(
    url,
    options.origins,
    options.resolve ?? systemResolve,
    signal
  );
  if (address === undefined) {
    return failure(
      "no-answer",
      `${url.hostname} has no address in DNS, so the page couldn't be fetched.`,
      redirects,
      started
    );
  }
  if ("reason" in address) {
    return refusedHop(address, url, redirects, started);
  }
  const transport = options.transport ?? nodeTransport;
  return until(
    transport({
      url,
      ip: address.address,
      family: address.family,
      headers: crawlerHeaders(userAgent),
      signal,
      maxBytes: limits.maxBytes,
    }),
    signal
  );
}

/** Whether a hop's result is the end of the fetch rather than an answer. */
function isEnd(value: TransportAnswer | Fetched): value is Fetched {
  return value.kind === "received" || value.kind === "failed";
}

/** Where a hop's answer leads: the end of the fetch, or the next address. */
function nextStep(
  answered: TransportAnswer,
  url: URL,
  context: { limits: FetchLimits; redirects: string[]; started: number }
): Fetched | URL {
  const { limits, redirects, started } = context;
  if (answered.kind === "too-large") {
    return failure(
      "too-large",
      `The page is larger than ${megabytes(limits.maxBytes)} MB, so the check stopped reading it.`,
      redirects,
      started
    );
  }
  const location = answered.headers.location;
  if (!REDIRECTS.has(answered.status) || location === undefined) {
    return {
      kind: "received",
      status: answered.status,
      url: url.href,
      redirects,
      headers: answered.headers,
      html: answered.body,
      ms: Date.now() - started,
    };
  }
  if (redirects.length >= limits.maxRedirects) {
    return failure(
      "too-many-redirects",
      `It redirected more than ${limits.maxRedirects} times, so the check stopped.`,
      redirects,
      started
    );
  }
  return new URL(location, url);
}

/** How a fetch that threw ends: out of time, or the site unreachable. */
function thrown(
  error: unknown,
  url: URL,
  context: {
    limits: FetchLimits;
    signal: AbortSignal;
    redirects: string[];
    started: number;
  }
): Fetched {
  const { limits, signal, redirects, started } = context;
  if (signal.aborted) {
    return failure(
      "too-slow",
      `The page didn't answer within ${limits.timeoutMs / 1000} seconds, so the check stopped.`,
      redirects,
      started
    );
  }
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "no answer";
  return failure(
    "unreachable",
    `The site couldn't be reached at ${url.host} (${code}).`,
    redirects,
    started
  );
}

/** Fetches `start` as a crawler naming itself `userAgent`. */
export async function fetchAs(
  start: URL,
  userAgent: string,
  options: FetchOptions
): Promise<Fetched> {
  const limits = options.limits ?? LIMITS;
  const signal = AbortSignal.timeout(limits.timeoutMs);
  const context = {
    options,
    limits,
    signal,
    redirects: [] as string[],
    started: Date.now(),
  };
  let url = start;
  try {
    for (;;) {
      const answered = await hop(url, userAgent, context);
      if (isEnd(answered)) return answered;
      const next = nextStep(answered, url, context);
      if (!(next instanceof URL)) return next;
      url = next;
      context.redirects.push(url.href);
    }
  } catch (error) {
    return thrown(error, url, context);
  }
}
