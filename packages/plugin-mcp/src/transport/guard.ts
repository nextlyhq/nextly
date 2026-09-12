/**
 * The check that has to run before the protocol handler sees a request.
 *
 * The transport specification requires a server to validate the `Origin`
 * header on every connection and to answer `403` when a present one is not
 * allowed, because without it a page on any website can drive an MCP endpoint
 * the browser can reach. The protocol library ships both checks and applies
 * neither: a handler wired straight to a route answers `200` to a request
 * carrying `Host: evil.example.com`. Applying them is this module.
 *
 * @module transport/guard
 */
import {
  hostHeaderValidationResponse,
  originValidationResponse,
} from "@modelcontextprotocol/server";

/**
 * Refuse a request that reached the wrong name, or came from the wrong page.
 *
 * Answers a ready-to-return `403` carrying a JSON-RPC error with no `id`,
 * which is the shape the transport specification names, or `undefined` when the
 * request may proceed.
 *
 * ## Why both checks, and why `Host` first
 *
 * They defend different halves of the same attack and neither covers the other.
 *
 * `Origin` is only ever sent by a browser. A missing one therefore passes, by
 * design and by specification: an MCP client is not a browser and sends none,
 * so refusing on absence would refuse every real client. That is also the limit
 * of the check. It says a browser page was not entitled to send this request;
 * it cannot say anything at all about a request from anything else.
 *
 * `Host` is what closes the other half. In a DNS rebinding attack the
 * attacker's own name is made to resolve to the address the endpoint listens
 * on, so the browser considers the page same-origin and the `Origin` header
 * agrees with itself. What does not agree is the name: the request arrives
 * addressed to `evil.example.com`, which no operator published. Pinning the
 * endpoint to the names it was told about is what makes the rebinding
 * pointless.
 *
 * `Host` runs first because it is the one that does not depend on the client
 * sending anything. A refusal should not be contingent on the attacker's
 * cooperation.
 */
export function refuseUnlessAddressedHere(
  request: Request,
  allowedHosts: readonly string[]
): Response | undefined {
  // Copied because the checks take a mutable array and this list is shared
  // across every request the endpoint serves.
  const names = [...allowedHosts];
  return (
    hostHeaderValidationResponse(request, names) ??
    originValidationResponse(request, names)
  );
}
