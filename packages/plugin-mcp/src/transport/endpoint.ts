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
  DEFAULT_NEGOTIATED_PROTOCOL_VERSION,
  McpServer,
  createMcpHandler,
  type McpHttpHandler,
} from "@modelcontextprotocol/server";
import type {
  PluginRoute,
  PluginRouteContext,
  RouteMethod,
} from "@nextlyhq/plugin-sdk";

import { registerInitialContext } from "../tools/initial-context";
import { registerWorkflowTools } from "../tools/workflows";

import { callerNow, whileServing } from "./caller";
import { refuseUnlessAddressedHere } from "./guard";
import {
  MAX_REQUEST_BYTES,
  MAX_TOOL_INPUT_ELEMENTS,
  PRIVATE_ANSWER,
  SERVED_REVISIONS,
} from "./limits";

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
 * It carries five tools and no resources or prompts, so a client sees a server
 * advertising `tools` alone: `get_initial_context` and the review tools, of
 * which only `submit_for_review` writes. Built per request rather than once,
 * because every tool answers for the caller and a server shared between them
 * would answer for whichever one built it.
 *
 * The caller is resolved HERE, before anything is constructed, so a request
 * whose caller cannot be established is refused rather than served a server
 * built for nobody: every tool is closed over the caller resolved here.
 *
 * Exported for its own test rather than only through a request, because a
 * precondition whose rejection branch nothing reaches is a guard nobody has
 * seen work. Not part of the package's public surface: `index.ts` does not
 * re-export it.
 */
export function buildServer(options: EndpointOptions): McpServer {
  const ctx = callerNow();
  const server = new McpServer(
    { name: SERVER_NAME, version: options.version },
    {
      // Each stated here rather than left to the library's defaults, which a
      // library release could change under an unchanged door: the revisions
      // served, the most a call's arguments may hold, and that discovery and
      // the tool list are private to this caller and never reused.
      supportedProtocolVersions: [...SERVED_REVISIONS],
      maxToolInputElements: MAX_TOOL_INPUT_ELEMENTS,
      cacheHints: {
        "server/discover": PRIVATE_ANSWER,
        "tools/list": PRIVATE_ANSWER,
      },
    }
  );
  // Registered per request, with THIS caller closed over. A tool reading the
  // ambient scope instead would run when the callback fires rather than when
  // the server was built, and the two are not the same request.
  registerInitialContext(server, ctx);
  // The review tools, closed over the same caller: each calls
  // `ctx.services.workflows` as this request's user and key.
  registerWorkflowTools(server, ctx);
  return server;
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
 * `request`, carrying the revision a client that names none is taken to speak.
 *
 * Clients from `2025-06-18` on send `MCP-Protocol-Version` on every request
 * after `initialize`; older ones never do, and the transport specification
 * says to take a request without it as `2025-03-26`. That is a revision this
 * door does not serve, and a server that does not serve such clients must
 * refuse their requests. The library instead serves a request without the
 * header, since it keeps no record of what `initialize` agreed. So the header
 * is supplied here, and the library's own check answers it: `initialize` is
 * exempt from that check and still opens, and every other request is refused
 * `400` with the revisions the door serves.
 *
 * Only an absent header is filled in; one the client sent is never replaced,
 * and the body is neither read nor copied.
 */
function withRevisionHeader(request: Request): Request {
  if (
    request.method !== "POST" ||
    request.headers.has("mcp-protocol-version")
  ) {
    return request;
  }
  const headers = new Headers(request.headers);
  headers.set("mcp-protocol-version", DEFAULT_NEGOTIATED_PROTOCOL_VERSION);
  return new Request(request, { headers });
}

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
 * No `requiredPermission` is named beyond that, deliberately: a route-level
 * permission would be a second gate in front of tools that already authorize
 * their own reads, and the coarser of two gates is the one that goes stale.
 * `get_initial_context` decides per entity, and the review tools per document,
 * through the same service checks the REST routes make.
 *
 * ## What that costs, stated rather than left to be found
 *
 * Core authenticates BEFORE the handler runs, so a caller with no credential
 * never reaches the address guard below and is answered `401`. The transport
 * specification names `403` for a disallowed `Origin`, so an unauthenticated
 * probe gets the wrong status and the guard has no part in refusing it.
 *
 * It is still refused, and by the stronger of the two checks: an unauthenticated
 * caller cannot reach the protocol however its request is addressed. The guard
 * covers the case that authentication cannot — a request carrying a real
 * credential from a page that had no business sending it, which is the browser
 * half of the attack. `__tests__/endpoint-dispatch.integration.test.ts` pins the
 * `401` through the real dispatcher, so the gap is a recorded fact.
 *
 * Making the route `public` would put the guard first and answer `403`. It would
 * also mean authenticating here instead, which is the one thing this endpoint
 * exists not to do.
 */
export function mcpEndpointRoutes(options: EndpointOptions): PluginRoute[] {
  let handler: McpHttpHandler | undefined;

  const serve = async (
    request: Request,
    ctx: PluginRouteContext
  ): Promise<Response> => {
    // Before anything parses the body. A refused request must not reach the
    // protocol at all, or the check is an audit trail rather than a gate.
    const refused = refuseUnlessAddressedHere(request, options.allowedHosts);
    if (refused) return refused;

    // The body bound is the library's to apply, since it reads the body; it is
    // stated here so a larger request is refused at a size this door chose.
    const serving = (handler ??= createMcpHandler(() => buildServer(options), {
      maxRequestBodySize: MAX_REQUEST_BYTES,
    }));
    // The context reaches the protocol layer as itself. Declaring only
    // `request` was enough while the endpoint exposed nothing, and it discards
    // the services facade and the user that every tool will read.
    return whileServing(ctx, () => serving.fetch(withRevisionHeader(request)));
  };

  return ENDPOINT_METHODS.map(method => ({
    method,
    path: options.path,
    // The address an operator publishes to an agent, not one buried under this
    // plugin's own name.
    mount: "root" as const,
    // Each tool answers for this caller, and the one that writes is held to the
    // same step rules as a REST request: the handler judges every caller, so
    // signing in is required and nothing more is.
    checksAccess: true as const,
    handler: serve,
  }));
}
