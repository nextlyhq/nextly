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
  init: RequestInit
): Promise<{ body: Buffer | null; headers: Record<string, string> }> {
  if (init.body === undefined || init.body === null) {
    return { body: null, headers: {} };
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
  const { body, headers: bodyHeaders } = await materializeBody(init);

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
        headers: { ...toHeaders(init), ...bodyHeaders, host: url.host },
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
          resolve(
            new Response(Buffer.concat(chunks), {
              status: response.statusCode ?? 502,
              headers: Object.entries(response.headers).flatMap(([k, v]) =>
                v === undefined
                  ? []
                  : [
                      [k, Array.isArray(v) ? v.join(", ") : v] as [
                        string,
                        string,
                      ],
                    ]
              ),
            })
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
