/**
 * The builder's start-up read: several of this plugin's own reads asked in
 * one request, each answered as its own route answers it.
 *
 * The builder opens on several reads of this plugin at once (the collections
 * a list may show, the custom sources, what the author may do, the site
 * style and the pages collection). Each one sent alone is a request, and on
 * a deployed site a function call and a draw on the session's read
 * allowance. Here they are one.
 *
 * ## Each read is its own route's
 *
 * The route is built from the very route objects the plugin registers, so a
 * read here runs the same handler with the same caller as a request to that
 * route would. Only a route whose HANDLER judges every caller may be batched
 * (`checksAccess: true` or `siteWide: false`): its access is decided where it
 * always is, and this route decides nothing. A route gated by a declared
 * `requiredPermission` is judged by the dispatcher before its handler runs,
 * which a read here could not do the same way, so it is not batched.
 *
 * Nor is any route this could not answer exactly as the dispatcher would: it
 * must be a `GET`, mounted under the plugin, with no path parameters,
 * middleware, rate limit, principal or timestamp formatting, and not public.
 * Any other is refused while the config is read.
 *
 * ## One refusal refuses one read
 *
 * Each read is answered on its own: its route's status, and its body when it
 * answered. A read its route refused, or one that failed, answers its status
 * and nothing else, so it never fails the reads beside it, and the editor
 * asks that route itself to show the refusal as the route words it. Each
 * route is read at most once a request.
 *
 * The answer is one person's, so it is never stored.
 *
 * @module builder-startup-route
 */
import {
  NextlyError,
  type PluginRoute,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import { respondDoc } from "nextly";

import {
  BUILDER_STARTUP_MAX_READS,
  BUILDER_STARTUP_PATH_MAX,
  BUILDER_STARTUP_READ_PARAM,
  BUILDER_STARTUP_ROUTE_PATH,
  type BuilderStartupAnswer,
  type BuilderStartupResponse,
} from "./builder-startup-contract";

/** Why a route cannot be answered here, or `undefined` when it can. */
function unbatchable(route: PluginRoute): string | undefined {
  if (route.method !== "GET") return "it is not a GET";
  if (route.path.includes(":")) return "its path has parameters";
  if (route.public === true) return "it is public";
  if (route.principal !== undefined) return "it serves a principal";
  if ((route.middleware ?? []).length > 0) return "it has middleware";
  if (route.rateLimit !== undefined) return "it has its own rate limit";
  if (route.formatTimestamps === true) return "it formats timestamps";
  if (route.mount === "root") return "it is mounted at the root";
  if (route.requiredPermission !== undefined) {
    return "the dispatcher judges its permission before its handler runs";
  }
  const judgesCaller = route.checksAccess === true || route.siteWide === false;
  return judgesCaller ? undefined : "it declares no access";
}

/** Where a read is asked, as a URL of its own. */
function addressOf(read: string): URL {
  return new URL(read, "http://startup.invalid");
}

/**
 * The reads a request names, or a refusal of the request: between one and
 * the most a request may name, each a path of this plugin, and no route
 * named twice (with another query, say), so one request runs each route at
 * most once.
 */
function readsOf(req: Request): string[] {
  const reads = new URL(req.url).searchParams.getAll(
    BUILDER_STARTUP_READ_PARAM
  );
  const malformed = reads.some(
    read =>
      !read.startsWith("/") ||
      read.startsWith("//") ||
      read.length > BUILDER_STARTUP_PATH_MAX
  );
  const routes = new Set(reads.map(read => addressOf(read).pathname));
  if (
    reads.length === 0 ||
    reads.length > BUILDER_STARTUP_MAX_READS ||
    malformed ||
    routes.size !== reads.length
  ) {
    throw NextlyError.validation({
      errors: [
        {
          path: BUILDER_STARTUP_READ_PARAM,
          code: "INVALID",
          message: `Name between 1 and ${String(BUILDER_STARTUP_MAX_READS)} reads, each a path of this plugin and each route once.`,
        },
      ],
    });
  }
  return reads;
}

/**
 * The request a read's own route would have been sent: the same address with
 * the read's path and query in place of this route's, and the same headers.
 */
function requestFor(req: Request, read: URL): Request {
  const url = new URL(req.url);
  const base = url.pathname.endsWith(BUILDER_STARTUP_ROUTE_PATH)
    ? url.pathname.slice(0, -BUILDER_STARTUP_ROUTE_PATH.length)
    : "";
  url.pathname = `${base}${read.pathname}`;
  url.search = read.search;
  return new Request(url, {
    method: "GET",
    headers: req.headers,
    signal: req.signal,
  });
}

/** A route's answer as one read's: its status, and its body when it answered. */
async function answerOf(response: Response): Promise<BuilderStartupAnswer> {
  if (!response.ok) return { status: response.status };
  const type = response.headers.get("content-type") ?? "";
  if (!type.toLowerCase().includes("application/json")) {
    return { status: response.status };
  }
  return { status: response.status, body: (await response.json()) as unknown };
}

/** One read, answered as its own route answers it. */
async function answerRead(
  read: string,
  routes: ReadonlyMap<string, PluginRoute>,
  req: Request,
  ctx: PluginRouteContext
): Promise<BuilderStartupAnswer> {
  const at = addressOf(read);
  const route = routes.get(at.pathname);
  if (route === undefined) return { status: 404 };
  try {
    return await answerOf(await route.handler(requestFor(req, at), ctx));
  } catch (error) {
    if (NextlyError.is(error)) return { status: error.statusCode };
    ctx.logger.warn(
      "[page-builder] one of the builder's start-up reads failed; the editor asks its route itself.",
      { path: at.pathname, error }
    );
    return { status: 500 };
  }
}

/**
 * The start-up read over `parts`, the routes it may answer for, each already
 * built as the plugin registers it.
 */
export function builderStartupRoute(parts: readonly PluginRoute[]): {
  method: "GET";
  path: string;
  checksAccess: true;
  noStore: true;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  const routes = new Map<string, PluginRoute>();
  for (const part of parts) {
    const why = unbatchable(part);
    if (why !== undefined) {
      throw new Error(
        `[page-builder] ${part.path} cannot be one of the builder's start-up reads: ${why}.`
      );
    }
    routes.set(part.path, part);
  }
  return {
    method: "GET",
    path: BUILDER_STARTUP_ROUTE_PATH,
    // Each read's own handler judges the caller.
    checksAccess: true,
    noStore: true,
    handler: async (req, ctx) => {
      const reads = readsOf(req);
      const answers = await Promise.all(
        reads.map(read => answerRead(read, routes, req, ctx))
      );
      const answer: BuilderStartupResponse = {
        reads: Object.fromEntries(reads.map((read, at) => [read, answers[at]])),
      };
      return respondDoc(answer);
    },
  };
}
