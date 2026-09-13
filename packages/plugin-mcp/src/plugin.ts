/**
 * `@nextlyhq/plugin-mcp` — the first-party Model Context Protocol server for
 * Nextly.
 *
 * EXPERIMENTAL. The surface lands in small reviewable pieces rather than as one
 * drop, and this piece is the transport: an address that speaks the protocol
 * and exposes nothing through it. No tool, resource or prompt is registered
 * yet, so a client that connects finds a server with no capabilities.
 *
 * Installing the package still changes nothing. The endpoint exists only once
 * an operator passes `enabled: true`, and while it is off the plugin
 * contributes no route at all, which `__tests__/plugin.test.ts` asserts rather
 * than leaves to be believed.
 *
 * Framework-agnostic by construction. The protocol surface is a request
 * handler, so nothing here couples to `next` or `react` and a headless install
 * exposes exactly what one running the admin panel does.
 *
 * @module plugin
 */
import { createRequire } from "node:module";

import { definePlugin, type PluginDefinition } from "@nextlyhq/plugin-sdk";

import { resolveAllowedHosts } from "./transport/allowed-hosts";
import { mcpEndpointRoutes } from "./transport/endpoint";

// Read from the manifest so the declared version cannot drift from what ships.
// A hand-copied string agrees on the day it is written; this is the same reason
// the other first-party plugins read theirs.
const require = createRequire(import.meta.url);
const { version: PLUGIN_VERSION } = require("../package.json") as {
  version: string;
};

/** The endpoint's address within the host application's Nextly handler mount. */
const DEFAULT_ENDPOINT_PATH = "/mcp";

export interface McpPluginOptions {
  /**
   * Serve the protocol endpoint. Defaults to `false`, and stays the default
   * while the surface is experimental.
   *
   * Off is the only safe default for this one. What it exposes is an install's
   * schema and content to any client that can reach the route, so a version
   * bump that silently began serving would widen what is readable without
   * anybody deciding to. An operator turns this on.
   */
  enabled?: boolean;
  /**
   * Hostnames the endpoint may be reached on.
   *
   * A request addressed to any other name is refused, which is what makes a
   * name an attacker controls useless even when it resolves to this server. Any
   * form of an address is accepted and reduced to its hostname, so
   * `https://cms.example.com`, `cms.example.com` and `cms.example.com:3000` are
   * one entry; IPv6 needs its brackets (`[::1]`).
   *
   * Left unset, the endpoint answers on the hostname of `NEXT_PUBLIC_APP_URL`,
   * which is the address the install already states about itself. With neither,
   * it answers only on localhost, so a development install works and a deployed
   * one that has said nothing about its address refuses rather than guesses.
   *
   * Setting this REPLACES that default rather than adding to it. Naming your
   * own hostnames is a statement about which names are legitimate, and a list
   * that quietly kept localhost would not be the list you wrote.
   */
  allowedHosts?: string[];
  /**
   * Where the endpoint answers, within the host application's Nextly handler
   * mount. Defaults to `/mcp`, so an app serving Nextly from `/admin/api`
   * publishes `https://<host>/admin/api/mcp`.
   *
   * A path core itself serves will NOT reach this endpoint. Core answers first
   * and consults root-mounted plugin routes only where it serves nothing, which
   * is deliberate: it is what stops a plugin taking over `/collections` by
   * declaring it, and it is why core keeps no list of reserved prefixes for a
   * plugin to check against. The consequence to know is that the shadowing is
   * per METHOD, so a path core serves for `GET` and not for `DELETE` would send
   * half this endpoint's traffic somewhere else. Pick a path core does not
   * serve; `/mcp` is the default because it is one.
   */
  path?: string;
}

/**
 * Refuse a path that cannot address one endpoint, at the moment it is written.
 *
 * Shape only, and the limit is worth stating rather than leaving to look like
 * more: this cannot tell whether core serves the path, because core keeps no
 * list to ask — its own answer coming first IS the mechanism, so a list here
 * would be a second one, drifting behind every route core adds. What it does
 * catch is the class it can decide, at config time rather than as a 404 an
 * operator has to explain.
 *
 * A capture is a SEGMENT that begins with `:`, which is the whole of the
 * matcher's grammar and therefore the whole of the rule here. Refusing the
 * character wherever it appears is a stricter grammar than the one that will
 * route the request, and a validation stricter than its matcher refuses paths
 * that would have worked: `/mcp:v1` addresses exactly one URL.
 */
function endpointPathOrRefuse(path: string): string {
  const capture = path.split("/").some(segment => segment.startsWith(":"));
  const problem = !path.startsWith("/")
    ? "must start with `/`"
    : capture
      ? "must name one address, not a `:param` pattern"
      : path.length > 1 && path.endsWith("/")
        ? "must not end with `/`"
        : path === "/"
          ? "must name a path under the Nextly handler mount, not the mount itself"
          : null;

  if (problem === null) return path;

  // A plain error on purpose. `NextlyError`'s public messages are canonical by
  // design, because they shape an HTTP response — and this never reaches one:
  // it fires while the developer's own config is being evaluated, where the
  // message IS the fix. A canonical "Validation failed." there would be a 404
  // with extra steps.
  throw new Error(
    `@nextlyhq/plugin-mcp: \`path\` ${problem}. Received ${JSON.stringify(path)}.`
  );
}

/**
 * The Nextly plugin.
 *
 * Takes its options now so that enabling the surface later is a value change
 * rather than a signature change for everyone who has already installed it.
 */
export function mcpPlugin(options: McpPluginOptions = {}): PluginDefinition {
  const { enabled = false } = options;
  const path = endpointPathOrRefuse(options.path ?? DEFAULT_ENDPOINT_PATH);

  return definePlugin({
    // Carried on the definition, not merely resolved. Core reads an OMITTED
    // `enabled` as enabled (`plugin.enabled !== false`), so a definition that
    // resolves the option and drops it reports this plugin as on — including
    // for a caller that passed `enabled: false` and read the default as off.
    enabled,
    name: "@nextlyhq/plugin-mcp",
    version: PLUGIN_VERSION,
    // Core-compat floor is the version exporting everything this imports. It is
    // the plugin contract alone today; it rises when the transport reaches for
    // a newer core export, and stating a wider range would advertise a
    // compatibility whose ESM import fails at module load.
    nextly: ">=0.0.2-alpha.65",
    author: "Nextly <contact@nextlyhq.com> (https://nextlyhq.com)",
    homepage: "https://nextlyhq.com",
    repository: "https://github.com/nextlyhq/nextly",
    license: "MIT",
    admin: {
      description:
        "Experimental. Serves a Model Context Protocol endpoint for AI agents when enabled, authenticated like every other Nextly route. It exposes no tools yet, so an agent that connects can read nothing.",
    },
    // Contributed only while the endpoint is on. Core independently skips a
    // disabled plugin's routes, so the two agree rather than one relying on the
    // other: this is the half testable from inside the package, and core's is
    // the half that holds for a definition built any other way.
    ...(enabled
      ? {
          contributes: {
            routes: mcpEndpointRoutes({
              allowedHosts: resolveAllowedHosts(options.allowedHosts),
              path,
              version: PLUGIN_VERSION,
            }),
          },
        }
      : {}),
  });
}
