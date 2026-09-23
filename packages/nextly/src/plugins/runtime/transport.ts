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
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

import { NextlyError } from "../../errors/nextly-error";

import type { ResolvedAddress } from "./fetch";

/**
 * Statuses whose responses may not carry a body.
 *
 * The platform `Response` constructor THROWS on a non-null body for these, so
 * passing an empty buffer is not harmlessly equivalent to passing null: an
 * ordinary provider `DELETE` answering 204 made `ctx.fetch` raise instead of
 * returning the response the caller was waiting for.
 */
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

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

  const body = Buffer.from(await probe.arrayBuffer());
  const contentType = probe.headers.get("content-type");
  return {
    body,
    // Only what the body itself implies. A caller's explicit content-type is
    // spread after this at the call site and still wins — except for
    // multipart, where the boundary is part of the bytes just produced.
    headers: contentType ? { "content-type": contentType } : {},
  };
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
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(Buffer.from(value));
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
  url: URL
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
  try {
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
    ]);
  } finally {
    // Cleared on every exit, so work that finished early does not keep a
    // timer alive for the remainder of the budget.
    if (timer !== undefined) clearTimeout(timer);
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
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  // Inside the deadline, because reading the REQUEST body happens before any
  // socket exists and therefore before the timer below is armed. A plugin
  // handing over a `ReadableStream` that never ends held `ctx.fetch` open
  // indefinitely without a single byte leaving the process — the documented
  // bound stood, and nothing had started that could enforce it.
  const { body, headers: bodyHeaders } = await withRequestDeadline(
    signal => materializeBody(init, signal),
    deadlineAt,
    url
  );

  return new Promise<Response>((resolve, reject) => {
    const req = send(
      {
        protocol: url.protocol,
        host: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: init.method ?? "GET",
        // Written AFTER the caller's, not before: spread first, a plugin
        // could send `Host: internal.example` to an allowlisted address, and
        // a reverse proxy there would route to a virtual host the manifest
        // never declared. DNS and TLS are still checked against the declared
        // name, so nothing else catches it.
        // `bodyHeaders` FIRST, so a caller's explicit content type wins over
        // the one inferred from the body — spread after, a JSON string sent
        // with `application/json` went out as `text/plain;charset=UTF-8` and
        // providers rejected it. `host` stays last: that one is not the
        // caller's to choose.
        headers: { ...bodyHeaders, ...toHeaders(init), host: url.host },
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
          const status = response.statusCode ?? 502;
          resolve(
            new Response(
              NULL_BODY_STATUSES.has(status) ? null : Buffer.concat(chunks),
              {
                status,
                headers: responseHeaderTuples(response.headers),
              }
            )
          );
        });
        response.on("error", reject);
      }
    );

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
    };
    req.on("close", done);
    req.on("error", error => {
      done();
      reject(error);
    });

    if (body !== null) req.write(body);
    req.end();
  });
}
