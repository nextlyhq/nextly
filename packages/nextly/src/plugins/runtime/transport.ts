/**
 * Sending a vetted request, to the address that was vetted.
 *
 * Node's bundled `fetch` resolves the name itself, so handing it a URL after
 * checking that name leaves a window in which the answer changes — which is
 * the rebinding the vetting exists to stop. `node:https` with a custom
 * `lookup` closes it: the connection goes to the address already judged, and
 * the resolver is never asked again.
 *
 * `undici` would also allow this through a custom agent, and is deliberately
 * not used: it is not a dependency of this package, and passing an npm-`undici`
 * agent to Node's bundled fetch risks a version-skew failure that would show
 * up as an outbound call breaking rather than as a build error.
 *
 * @module plugins/runtime/transport
 * @since 1.0.0
 */
import { Agent as HttpAgent, request as httpRequest } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import type { Socket } from "node:net";
import {
  brotliDecompressSync,
  gunzipSync,
  inflateRawSync,
  inflateSync,
} from "node:zlib";

import { NextlyError } from "../../errors/nextly-error";

import { abortReason, type ResolvedAddress } from "./fetch";

/**
 * The agents every vetted request is sent through, and no other code's.
 *
 * Not the global agents. Those can route through an egress proxy taken from
 * the environment (`NODE_USE_ENV_PROXY`), which re-resolves the name on its
 * own network, and they pool keep-alive sockets by `host:port` — a key the
 * pinned `lookup` is not part of — so a socket another library opened to the
 * same name at a different address would be reused. Either way the request
 * would leave for an address nobody vetted.
 *
 * Keep-alive is off for the same reason: every request opens its own socket,
 * through the `lookup` below, so the address a socket reached is always the
 * one this request vetted. An egress proxy is deliberately not supported.
 */
const pinnedHttpAgent = new HttpAgent({ keepAlive: false });
const pinnedHttpsAgent = new HttpsAgent({ keepAlive: false });

/**
 * Whether a connected socket reached the address that was vetted.
 *
 * The belt to the agents' braces: whatever produced the socket, nothing is
 * written to it unless its peer is the address judged. An IPv4 peer can be
 * reported in its IPv4-mapped IPv6 form, so both spellings compare equal.
 */
export function connectedToVetted(
  remoteAddress: string | undefined,
  vetted: ResolvedAddress
): boolean {
  if (!remoteAddress) return false;
  const normalise = (value: string) =>
    value.toLowerCase().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, "");
  return normalise(remoteAddress) === normalise(vetted.address);
}

/**
 * Content codings this transport decodes, and asks for when the caller did not
 * name its own `Accept-Encoding`.
 *
 * A request without the header accepts ANY coding (RFC 9110 §12.5.3), and a
 * compressed body handed back undecoded made `res.json()` fail where the
 * platform's `fetch` would have decoded it. Naming the codings this module
 * can decode keeps a server from choosing one it cannot.
 */
const DECODABLE_CODINGS = "gzip, deflate, br";

/**
 * Decode a response body by its `Content-Encoding`, bounded by `maxBytes`.
 *
 * The cap applies to the DECODED bytes: the wire cap alone lets a small
 * compressed body expand far past it. Codings are undone in reverse order of
 * application, as the header lists them. A coding this module cannot decode
 * is refused rather than handed back as bytes the caller would misread.
 */
function decodeBody(
  raw: Buffer,
  contentEncoding: string | undefined,
  maxBytes: number,
  host: string
): Buffer {
  const codings = (contentEncoding ?? "")
    .split(",")
    .map(coding => coding.trim().toLowerCase())
    .filter(coding => coding !== "" && coding !== "identity");
  let body = raw;
  for (const coding of codings.reverse()) {
    if (body.length === 0) return body;
    body = decodeOne(body, coding, maxBytes, host);
  }
  return body;
}

/** What undoes each coding this module accepts. */
const DECODERS: Readonly<
  Record<string, (body: Buffer, options: { maxOutputLength: number }) => Buffer>
> = {
  gzip: gunzipSync,
  "x-gzip": gunzipSync,
  br: brotliDecompressSync,
  deflate: inflateEitherSync,
};

/**
 * Undo "deflate", which is the zlib-wrapped form by the specification and the
 * raw form by what some servers actually send; both are accepted. Exceeding
 * the size cap is not retried as the other form.
 */
function inflateEitherSync(
  body: Buffer,
  options: { maxOutputLength: number }
): Buffer {
  try {
    return inflateSync(body, options);
  } catch (error) {
    if (error instanceof RangeError) throw error;
    return inflateRawSync(body, options);
  }
}

/** Undo one coding, or refuse: unsupported, too large, or undecodable. */
function decodeOne(
  body: Buffer,
  coding: string,
  maxBytes: number,
  host: string
): Buffer {
  const decoder = Object.hasOwn(DECODERS, coding) ? DECODERS[coding] : null;
  if (!decoder) {
    throw NextlyError.forbidden({
      logContext: { reason: "outbound-unsupported-encoding", host, coding },
    });
  }
  try {
    return decoder(body, { maxOutputLength: maxBytes });
  } catch (error) {
    const tooLarge = error instanceof RangeError;
    throw NextlyError.forbidden({
      logContext: {
        reason: tooLarge ? "outbound-body-too-large" : "outbound-bad-response",
        host,
        ...(tooLarge ? { limit: maxBytes } : { coding }),
      },
    });
  }
}

/**
 * Build the `Response` handed back to the plugin, or refuse one the platform
 * cannot represent.
 *
 * Node's parser accepts any three-digit status, while `Response` throws a
 * `RangeError` outside 200–599. Thrown inside the response's `end` listener,
 * that error escaped the promise entirely: the caller waited past its
 * deadline with nothing left to settle it.
 */
function buildResponse(
  status: number,
  headers: NodeJS.Dict<string | string[]>,
  raw: Buffer,
  maxBytes: number,
  host: string
): Response {
  if (status < 200 || status > 599) {
    throw NextlyError.forbidden({
      logContext: { reason: "outbound-bad-response", host, status },
    });
  }
  if (NULL_BODY_STATUSES.has(status)) {
    return new Response(null, {
      status,
      headers: responseHeaderTuples(headers),
    });
  }
  const encoding = headers["content-encoding"];
  const decoded = decodeBody(
    raw,
    Array.isArray(encoding) ? encoding.join(",") : encoding,
    maxBytes,
    host
  );
  // A decoded body no longer matches the coding or the length the server
  // described, so both headers go, exactly as the platform's `fetch` does.
  const tuples = responseHeaderTuples(headers).filter(
    ([name]) =>
      decoded === raw ||
      !["content-encoding", "content-length"].includes(name.toLowerCase())
  );
  // Copied into a plain `ArrayBuffer`: zlib hands back a buffer typed over
  // any backing store, which the `Response` body type does not accept.
  return new Response(new Uint8Array(decoded), { status, headers: tuples });
}

/**
 * Statuses whose responses may not carry a body.
 *
 * The platform `Response` constructor THROWS on a non-null body for these, so
 * passing an empty buffer is not harmlessly equivalent to passing null: an
 * ordinary provider `DELETE` answering 204 made `ctx.fetch` raise instead of
 * returning the response the caller was waiting for.
 */
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

//
// The byte cap a REQUEST body may buffer to, mirroring the response cap the
// caller passes. Buffering precedes any socket, so nothing downstream can
// push back on a producer that keeps enqueueing -- the cap is the only
// bound between a public route forwarding a fast stream and the memory of
// the worker hosting it.
//
const MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024;

export interface SendArgs {
  url: URL;
  address: ResolvedAddress;
  init: RequestInit;
  /**
   * When the WHOLE call expires, as an epoch milliseconds value.
   *
   * A deadline rather than a duration because the caller follows redirects in
   * a loop, and a duration is restarted by each hop — thirty seconds per
   * redirect is not the thirty-second bound the option promises. Passing the
   * instant lets every hop share one budget.
   */
  deadlineAt: number;
  maxBodyBytes: number;
}

/**
 * The request body as bytes, plus whatever headers describing it follow.
 *
 * Built by the platform's own `Request` rather than by hand. It already knows
 * every `BodyInit` variant, and it is the only thing that can produce a
 * multipart boundary that matches the bytes it wrote — a hand-rolled encoder
 * would be a second implementation of the part hardest to get right.
 *
 * Without this the transport wrote a body only when it was a string, so an
 * OAuth token exchange posting `URLSearchParams` reached the provider with its
 * method and headers intact and no body at all.
 */
async function materializeBody(
  init: RequestInit,
  signal?: AbortSignal
): Promise<{ body: Buffer | null; headers: Record<string, string> }> {
  if (init.body === undefined || init.body === null) {
    return { body: null, headers: {} };
  }

  // A STREAM is read here rather than through `Request`, because only a
  // stream can fail to end and only a reader we hold can be cancelled.
  // `arrayBuffer()` LOCKS the body — measured — so once it is reading,
  // `cancel()` throws `ReadableStream is locked` and the producer is never
  // told to stop. Owning the reader is what makes the deadline able to
  // release it. A stream carries no implied content type, so there is none
  // to recover from a probe.
  if (init.body instanceof ReadableStream) {
    // A stream carries no implied content type, so there is none to recover.
    return { body: await drainStream(init.body, signal), headers: {} };
  }

  // `duplex` is required before a stream body is accepted, and is not in the
  // DOM lib's RequestInit; the cast names that gap rather than widening it.
  const probe = new Request("https://body.invalid", {
    method: "POST",
    body: init.body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });

  // Every other body shape is read through the probe's STREAM, and so
  // through the same bounded reader as a stream body. `arrayBuffer()` would
  // materialize the whole value before any size is known: a plugin route
  // forwarding a large `Blob` or `FormData` buffered all of it, and the cap
  // held only for streams.
  const body = probe.body
    ? await drainStream(probe.body, signal)
    : Buffer.alloc(0);
  const contentType = probe.headers.get("content-type");
  return {
    body,
    // Only what the body itself implies. `requestHeaders` decides which of
    // this and the caller's own content type is sent.
    headers: contentType ? { "content-type": contentType } : {},
  };
}

/**
 * The headers a request is sent with.
 *
 * `bodyHeaders` first, so a caller's explicit content type wins over the one
 * inferred from the body — spread after, a JSON string sent with
 * `application/json` went out as `text/plain;charset=UTF-8` and providers
 * rejected it.
 *
 * Except for a `FormData` body. Its boundary is generated with the bytes
 * `materializeBody` produced, so the generated content type is the only one
 * that describes them: a caller's `multipart/form-data` without that boundary,
 * or with one of its own, names a boundary the body does not contain. A body
 * the caller built itself — a `Blob` or string of `multipart/related`, say —
 * keeps the caller's header, which carries the boundary the caller wrote.
 *
 * `host` is written last, after the caller's: spread first, a plugin could
 * send `Host: internal.example` to an allowlisted address, and a reverse proxy
 * there would route to a virtual host the manifest never declared. DNS and TLS
 * are still checked against the declared name, so nothing else catches it.
 */
function requestHeaders(
  bodyHeaders: Record<string, string>,
  init: RequestInit,
  url: URL,
  body: Uint8Array | string | null
): Record<string, string> {
  const generated = bodyHeaders["content-type"];
  const formData = init.body instanceof FormData && generated !== undefined;
  const headers: Record<string, string> = {
    // Only codings the response side can decode, unless the caller named its
    // own: a server free to pick any coding may pick one nobody here reads.
    "accept-encoding": DECODABLE_CODINGS,
    ...bodyHeaders,
    ...toHeaders(init),
    ...(formData ? { "content-type": generated } : {}),
    host: url.host,
  };
  // The transport writes the body it materialized, so it states the length
  // of that: a caller's Content-Length describes the body it built, which
  // materialization may have re-encoded, and the connection is written in
  // chunks when no length is set — framing a strict receiver can refuse.
  // The transfer-encoding a caller declared for its own streaming body
  // goes with it: both together describe the same bytes two ways, which a
  // destination is entitled to refuse.
  delete headers["transfer-encoding"];
  if (body !== null) {
    headers["content-length"] = String(Buffer.byteLength(body));
  } else {
    delete headers["content-length"];
  }
  return headers;
}

/**
 * Read a stream body through a reader THIS module holds.
 *
 * Not `Request.arrayBuffer()`, which LOCKS the body — measured — so a later
 * `cancel()` throws `ReadableStream is locked` and the producer is never told
 * to stop. Owning the reader is what lets the deadline release it, instead of
 * merely abandoning a read that goes on pulling bytes for nobody.
 *
 * Its own function so `materializeBody` stays a choice between body shapes
 * rather than also being the loop.
 */
async function drainStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): Promise<Buffer> {
  const reader = body.getReader();
  const release = () => {
    void reader.cancel().catch(() => {
      // Already finished or already failed: nothing left to release.
    });
  };
  if (signal?.aborted) release();
  signal?.addEventListener("abort", release, { once: true });

  const chunks: Buffer[] = [];
  // Bounded like the response side. Buffering the whole body before any
  // socket exists means no backpressure can apply: an unbounded drain let a
  // public proxy or upload route hand `ctx.fetch` a fast body far larger
  // than anything the response cap permits, and exhaust the worker's memory
  // well before the deadline — refusing is the only bound that holds.
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        size += value.length;
        if (size > MAX_REQUEST_BODY_BYTES) {
          release();
          throw NextlyError.forbidden({
            logContext: {
              reason: "outbound-request-body-too-large",
              limit: MAX_REQUEST_BODY_BYTES,
            },
          });
        }
        chunks.push(Buffer.from(value));
      }
    }
  } finally {
    signal?.removeEventListener("abort", release);
  }
  return Buffer.concat(chunks);
}

/**
 * Hold work that precedes the socket to the same wall-clock budget.
 *
 * The request timer cannot cover this: it is armed against a `ClientRequest`
 * that does not exist until the body has been read. Refusing with the same
 * reason the socket timer uses keeps one outcome for one cause, whichever
 * side of the connection ran out of time.
 */
async function withRequestDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  deadlineAt: number,
  url: URL,
  caller?: AbortSignal
): Promise<T> {
  const refuse = () =>
    NextlyError.forbidden({
      logContext: {
        reason: "outbound-timeout",
        host: url.hostname,
        deadlineAt,
      },
    });

  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) throw refuse();

  // Takes a SIGNAL rather than a promise, so expiry CANCELS the work instead
  // of merely stopping the wait for it. A race alone leaves the losing side
  // running: the caller is answered and the read goes on pulling bytes with
  // nobody left to receive them.
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Detaches the caller-abort listener once the race settles, so a completed
  // read leaves nothing attached to a signal its owner may hold for the life
  // of a request of its own.
  let detachCaller: (() => void) | undefined;
  try {
    // The CALLER'S cancellation, racing the same race the deadline does.
    // Aborting the controller releases the body reader exactly as an expiry
    // would; without this arm, a plugin cancelling because its own incoming
    // request disconnected left the body read pulling bytes for nobody until
    // the deadline ran out.
    const callerRace: Promise<never> | null = caller
      ? new Promise<never>((_resolve, reject) => {
          const onAbort = () => {
            controller.abort();
            reject(abortReason(caller));
          };
          caller.addEventListener("abort", onAbort, { once: true });
          detachCaller = () => caller.removeEventListener("abort", onAbort);
        })
      : null;
    return await Promise.race([
      run(controller.signal),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(refuse());
        }, remaining);
        // Never holds the loop open on its own; it races work that does.
        timer.unref?.();
      }),
      ...(callerRace ? [callerRace] : []),
    ]);
  } finally {
    // Cleared on every exit, so work that finished early does not keep a
    // timer alive for the remainder of the budget.
    if (timer !== undefined) clearTimeout(timer);
    detachCaller?.();
  }
}

/** Header values as Node wants them, from whatever shape the caller used. */
function toHeaders(init: RequestInit): Record<string, string> {
  const out: Record<string, string> = {};
  const headers = new Headers(init.headers ?? {});
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

/**
 * A header name whose values must stay SEPARATE, not comma-joined.
 *
 * `Set-Cookie` is the one field whose grammar forbids the list form every
 * other repeated header uses: an `Expires` attribute contains a comma of its
 * own, so a joined value cannot be split back apart by anyone — including
 * `Headers.getSetCookie()`, which reported one malformed cookie where the
 * origin sent several. Lower-case because Node reports header names that way.
 */
const UNJOINABLE_HEADERS = new Set(["set-cookie"]);

/**
 * Node's header bag as the tuples `Response` accepts.
 *
 * Repeated headers arrive as an array. Most may be comma-joined, which is what
 * the list grammar means; `Set-Cookie` may not, so it contributes ONE TUPLE
 * PER VALUE and `Headers` keeps them apart.
 */
function responseHeaderTuples(
  headers: NodeJS.Dict<string | string[]>
): Array<[string, string]> {
  return Object.entries(headers).flatMap(([name, value]) => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) return [[name, value] as [string, string]];
    if (UNJOINABLE_HEADERS.has(name.toLowerCase())) {
      return value.map(one => [name, one] as [string, string]);
    }
    return [[name, value.join(", ")] as [string, string]];
  });
}

/**
 * Send one request and read its response.
 *
 * The `Host` header keeps the original NAME while the socket goes to the
 * vetted address, because that is what TLS and virtual hosting are matched on
 * — connecting by address alone would reach the right machine and be served
 * the wrong site.
 */
export async function sendVetted(args: SendArgs): Promise<Response> {
  const { url, address, init, deadlineAt, maxBodyBytes } = args;
  // The CALLER'S cancellation, honoured at every phase the deadline is. Before
  // it was consulted nowhere: a plugin aborting because its own incoming
  // request disconnected left the outbound call running — DNS, socket and all
  // — until the fixed deadline answered for it. Normalised to undefined
  // because `RequestInit.signal` may be explicitly null.
  const caller = init.signal ?? undefined;
  // A cancellation the caller asked for is not a policy refusal, so it is
  // not one of this module's NextlyErrors: it rejects with the signal's own
  // reason, the value `fetch` rejects with.
  if (caller?.aborted) throw abortReason(caller);
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  // Inside the deadline, because reading the REQUEST body happens before any
  // socket exists and therefore before the timer below is armed. A plugin
  // handing over a `ReadableStream` that never ends held `ctx.fetch` open
  // indefinitely without a single byte leaving the process — the documented
  // bound stood, and nothing had started that could enforce it.
  const { body, headers: bodyHeaders } = await withRequestDeadline(
    signal => materializeBody(init, signal),
    deadlineAt,
    url,
    caller
  );

  return new Promise<Response>((resolve, reject) => {
    let cancelledByCaller = false;
    const req = send(
      {
        protocol: url.protocol,
        host: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: init.method ?? "GET",
        headers: requestHeaders(bodyHeaders, init, url, body),
        // This module's own agents, never the global ones: see
        // `pinnedHttpAgent` for what the global agents would bypass.
        agent: url.protocol === "https:" ? pinnedHttpsAgent : pinnedHttpAgent,
        // The whole point: connect to the address already judged, and never
        // consult the resolver a second time.
        lookup: (_hostname, options, callback) => {
          // TWO shapes, because `net` asks for both. With `autoSelectFamily`
          // — on by default since Node 20 — it passes `all: true` and expects
          // an ARRAY; the three-argument form then lands as `undefined` and
          // the connection fails with "Invalid IP address". Answering only
          // the older shape meant every outbound plugin call broke on a
          // default-configured runtime, and no test ran this function to say
          // so.
          const entry = { address: address.address, family: address.family };
          if ((options as { all?: boolean }).all === true) {
            (
              callback as unknown as (
                error: null,
                addresses: { address: string; family: number }[]
              ) => void
            )(null, [entry]);
            return;
          }
          callback(null, address.address, address.family);
        },
        // Matched on the original name, or a certificate valid for the site
        // would be rejected because the socket was opened by address.
        servername: url.hostname,
      },
      response => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBodyBytes) {
            req.destroy();
            reject(
              NextlyError.forbidden({
                logContext: {
                  reason: "outbound-body-too-large",
                  host: url.hostname,
                  limit: maxBodyBytes,
                },
              })
            );
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          // Inside a try: anything thrown in this listener would escape the
          // promise, leaving the caller waiting on a request already closed.
          try {
            resolve(
              buildResponse(
                response.statusCode ?? 502,
                response.headers,
                Buffer.concat(chunks),
                maxBodyBytes,
                url.hostname
              )
            );
          } catch (error) {
            // A refused response releases its socket rather than leaving it
            // to whatever the server decides to do with the connection.
            req.destroy();
            reject(
              error instanceof Error ? error : new TypeError(String(error))
            );
          }
        });
        response.on("error", reject);
      }
    );

    // No request byte — headers or body — is written until the socket is
    // known to have reached the vetted address. A socket that arrives still
    // connecting is judged once it connects; one already connected is judged
    // at once. Over HTTPS the TLS handshake (whose ClientHello names the host)
    // starts on connect, before this runs; nothing of the request does.
    req.on("socket", (socket: Socket) => {
      const judge = () => {
        if (connectedToVetted(socket.remoteAddress, address)) return;
        const refusal = NextlyError.forbidden({
          logContext: {
            reason: "outbound-socket-address-mismatch",
            host: url.hostname,
            vetted: address.address,
            connected: socket.remoteAddress ?? null,
          },
        });
        req.destroy(refusal);
        reject(refusal);
      };
      if (socket.connecting) socket.once("connect", judge);
      else judge();
    });

    // The caller's cancellation, applied to the socket the same way the
    // deadline applies itself: destroy the request rather than wait out a
    // timer the caller has already decided the answer to. The flag keeps the
    // signal's own reason as what the promise settles with, whichever of this
    // handler and the socket's own error event the destroy surfaces first.
    const onCallerAbort = () => {
      cancelledByCaller = true;
      req.destroy();
      reject(abortReason(caller as AbortSignal));
    };
    if (caller) caller.addEventListener("abort", onCallerAbort, { once: true });

    // A wall-clock deadline, not `req.setTimeout`: that one is per-socket
    // INACTIVITY, so a server sending a byte before each expiry holds the
    // request open forever while never appearing idle.
    const remaining = deadlineAt - Date.now();
    const timer = setTimeout(
      () => {
        req.destroy();
        reject(
          NextlyError.forbidden({
            logContext: {
              reason: "outbound-timeout",
              host: url.hostname,
              deadlineAt,
            },
          })
        );
      },
      Math.max(0, remaining)
    );
    // Never keeps the process alive on its own: this races a request that has
    // its own reasons to hold the loop open.
    timer.unref?.();
    const done = (): void => {
      clearTimeout(timer);
      caller?.removeEventListener("abort", onCallerAbort);
    };
    req.on("close", done);
    req.on("error", error => {
      done();
      reject(cancelledByCaller ? abortReason(caller as AbortSignal) : error);
    });

    if (body !== null) req.write(body);
    req.end();
  });
}
