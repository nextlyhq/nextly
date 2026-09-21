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
  timeoutMs: number;
  maxBodyBytes: number;
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
  const { url, address, init, timeoutMs, maxBodyBytes } = args;
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;

  return new Promise<Response>((resolve, reject) => {
    const req = send(
      {
        protocol: url.protocol,
        host: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: init.method ?? "GET",
        headers: { host: url.host, ...toHeaders(init) },
        // The whole point: connect to the address already judged, and never
        // consult the resolver a second time.
        lookup: (_hostname, _options, callback) => {
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

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(
        NextlyError.forbidden({
          logContext: {
            reason: "outbound-timeout",
            host: url.hostname,
            timeoutMs,
          },
        })
      );
    });
    req.on("error", reject);

    if (typeof init.body === "string") req.write(init.body);
    req.end();
  });
}
