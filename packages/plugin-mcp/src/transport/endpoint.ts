/**
 * The Model Context Protocol endpoint: one address, one handler, three methods.
 *
 * The protocol library answers a web-standard `Request` with a web-standard
 * `Response`, which is exactly the shape a Nextly plugin route handler has. So
 * the endpoint is a route contribution rather than a file an integrator mounts:
 * a route inherits the authentication every other plugin route gets, and an
 * endpoint reaching an install's content is not one to leave depending on
 * whether somebody remembered to put a gate in front of it.
 *
 * @module transport/endpoint
 */
import {
  McpServer,
  createMcpHandler,
  type McpHttpHandler,
} from "@modelcontextprotocol/server";
import type { PluginRoute, RouteMethod } from "@nextlyhq/plugin-sdk";

import { refuseUnlessAddressedHere } from "./guard";

/**
 * What the endpoint needs to know about itself.
 */
export interface EndpointOptions {
  /** Hostnames the endpoint answers on; see `resolveAllowedHosts`. */
  allowedHosts: readonly string[];
  /** Path within the host application's Nextly handler mount. */
  path: string;
  /** Reported to clients as this server's version. */
  version: string;
}

/**
 * How this install names itself to a client.
 *
 * Every result carries it, and a client shows it to whoever is choosing which
 * server to trust with a question, so it names the product rather than the
 * package: an operator connecting an agent to their CMS is looking for their
 * CMS in that list.
 */
const SERVER_NAME = "nextly";

/**
 * Build the protocol server for one request.
 *
 * It carries no tools, resources or prompts yet, and that is the whole of what
 * this stage ships: an endpoint a client can reach, speaking the protocol,
 * exposing nothing. A client that connects sees a server with no capabilities,
 * which is an honest description of an install that has published nothing to
 * it.
 */
function buildServer(options: EndpointOptions): McpServer {
  return new McpServer({ name: SERVER_NAME, version: options.version });
}

/**
 * The methods the endpoint claims.
 *
 * `POST` is the protocol. `GET` and `DELETE` are claimed so that the protocol
 * library answers them, because it answers them CORRECTLY: the transport
 * specification says a server on this revision replies `405 Method Not
 * Allowed` to both, they being the session operations the revision removed.
 * Leaving them unclaimed hands an old client the host application's own
 * not-found instead, which is indistinguishable from a wrong URL.
 */
const ENDPOINT_METHODS: readonly RouteMethod[] = ["POST", "GET", "DELETE"];

/**
 * The endpoint, as routes a plugin contributes.
 *
 * One handler backs all three methods and it is built once, not per request.
 * The library's own factory is what runs per request, which is where a server
 * varying by caller belongs; rebuilding the handler around it would discard the
 * change-event bus every open subscription stream is attached to.
 *
 * `public` is deliberately left unset, so the route is authenticated like every
 * other plugin route: a session, or `Authorization: Bearer` with an API key.
 * The endpoint exposes nothing yet, so no permission is named beyond that.
 * Tools reaching content authorize their own reads as they arrive.
 */
export function mcpEndpointRoutes(options: EndpointOptions): PluginRoute[] {
  let handler: McpHttpHandler | undefined;

  const serve = async (request: Request): Promise<Response> => {
    // Before anything parses the body. A refused request must not reach the
    // protocol at all, or the check is an audit trail rather than a gate.
    const refused = refuseUnlessAddressedHere(request, options.allowedHosts);
    if (refused) return refused;

    handler ??= createMcpHandler(() => buildServer(options));
    return handler.fetch(request);
  };

  return ENDPOINT_METHODS.map(method => ({
    method,
    path: options.path,
    // The address an operator publishes to an agent, not one buried under this
    // plugin's own name.
    mount: "root" as const,
    handler: serve,
  }));
}
