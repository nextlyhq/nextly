/**
 * What a visual check run is asked to do: its routes and flags, the views it
 * captures of each route, what each capture is called, and the port it serves
 * on.
 *
 * @module scripts/visual-check/options
 */
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

import { DEFAULT_PORTS } from "../worktree.mjs";

/**
 * The viewports each route is captured at: a phone, a tablet in landscape or a
 * small laptop, and a desktop. The heights are each device's usual one, so a
 * viewport capture shows what the first screen shows.
 */
const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
];

/** Every visual change in the admin has to work in both, so both are always captured. */
const SCHEMES = ["light", "dark"];

/** Where every topic's captures are published, as `pr-screenshots/<topic>`. */
export const SCREENSHOT_BRANCHES = "pr-screenshots/";

/** A wrong invocation, answered with the usage rather than a stack. */
export class UsageError extends Error {}

export const USAGE = `Usage: pnpm visual-check <route...> [--full] [--reuse | --keep] [--publish <topic>] [--out <dir>]
       pnpm visual-check --unpublish <topic>

  <route>              an admin path, such as /admin or /admin/collections/posts
  --full               capture the whole page, not only the first screen
  --reuse              use the server already running on this checkout's port; build nothing
  --keep               leave the server this run starts running, for later runs with --reuse
  --publish <topic>    push the captures to pr-screenshots/<topic> and print "The look"
  --out <dir>          where the captures go (default e2e/.playwright/visual-check)
  --unpublish <topic>  delete pr-screenshots/<topic>, once its pull request is merged or closed
  --help               print this`;

/**
 * A topic becomes one path segment of a branch name and of every raw URL, so
 * it is held to characters both take as they are: no slash, no leading dot or
 * dash, nothing a URL would escape.
 */
const TOPIC = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * A capture's name: the route's path and query as one slug, then width and
 * scheme. The query is kept, since `?tab=fields` is a different screen.
 */
export function captureName(route, width, scheme) {
  const slug = route
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "root"}-${width}-${scheme}.png`;
}

/** Every capture of every route, route by route, narrowest first, light before dark. */
export function capturePlan(routes) {
  return routes.flatMap(route =>
    VIEWPORTS.flatMap(viewport =>
      SCHEMES.map(scheme => ({
        route,
        viewport,
        width: viewport.width,
        scheme,
        file: captureName(route, viewport.width, scheme),
      }))
    )
  );
}

/**
 * Refuses a topic that cannot be the last part of `pr-screenshots/<topic>`.
 *
 * Git is asked, since its rules are longer than any pattern here (no trailing
 * dot, no `.lock`, no `..`, and more); the pattern above keeps the topic to one
 * path segment a URL takes as it is. Run while parsing, so a bad topic costs
 * no build.
 */
function checkTopic(topic) {
  if (!TOPIC.test(topic)) {
    throw new UsageError(
      `"${topic}" cannot name a branch: use letters, digits, ".", "_" and "-".`
    );
  }
  const checked = spawnSync(
    "git",
    ["check-ref-format", "--branch", `${SCREENSHOT_BRANCHES}${topic}`],
    { encoding: "utf8" }
  );
  if (checked.status !== 0) {
    throw new UsageError(
      `git refuses ${SCREENSHOT_BRANCHES}${topic} as a branch name; choose another topic.`
    );
  }
}

/** The flags as `parseArgs` reads them, a parsing failure answered as a usage error. */
function readArgs(argv) {
  try {
    return parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        full: { type: "boolean", default: false },
        reuse: { type: "boolean", default: false },
        keep: { type: "boolean", default: false },
        publish: { type: "string" },
        unpublish: { type: "string" },
        out: { type: "string" },
        help: { type: "boolean", default: false },
      },
    });
  } catch (error) {
    throw new UsageError(
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Refuses routes that are not paths, and two routes that slug to the same
 * name, which would write over each other's captures and leave one route
 * silently uncaptured.
 */
function checkRoutes(routes) {
  if (routes.length === 0) throw new UsageError("Name at least one route.");
  const notPaths = routes.filter(route => !route.startsWith("/"));
  if (notPaths.length > 0) {
    throw new UsageError(
      `A route is a path starting with "/": ${notPaths.join(", ")}`
    );
  }
  const byName = new Map();
  for (const route of routes) {
    const name = captureName(route, VIEWPORTS[0].width, SCHEMES[0]);
    if (byName.has(name) && byName.get(name) !== route) {
      throw new UsageError(
        `${byName.get(name)} and ${route} would get the same capture names.`
      );
    }
    byName.set(name, route);
  }
}

/**
 * The routes and flags of one run. `--unpublish` is a run of its own, with no
 * route; `--help` asks for nothing else.
 */
export function parseOptions(argv) {
  const { values, positionals: routes } = readArgs(argv);
  if (values.help) return { help: true, routes: [] };
  if (values.unpublish !== undefined) {
    if (routes.length > 0 || values.publish !== undefined) {
      throw new UsageError(
        "--unpublish deletes a published topic, and takes no route and no --publish."
      );
    }
    checkTopic(values.unpublish);
    return { unpublish: values.unpublish, routes: [] };
  }
  checkRoutes(routes);
  // With --reuse this run starts no server, so there would be nothing to keep.
  if (values.reuse && values.keep) {
    throw new UsageError(
      "--keep leaves this run's server running, and --reuse starts none."
    );
  }
  if (values.publish !== undefined) checkTopic(values.publish);
  return {
    routes: [...new Set(routes)],
    full: values.full,
    reuse: values.reuse,
    keep: values.keep,
    publish: values.publish,
    out: values.out,
  };
}

/**
 * The port this checkout's production server uses: `E2E_PROD_PORT` from the
 * environment, else the one its worktree slot recorded in
 * `.claude/settings.local.json`, else slot 0's, which the worktree allocator
 * owns. The settings file matters because a plain terminal never loaded it,
 * and the default there would be another checkout's server.
 */
export function prodPort(env, settings) {
  const port =
    Number(env.E2E_PROD_PORT) || Number(settings?.env?.E2E_PROD_PORT);
  return port || DEFAULT_PORTS.E2E_PROD_PORT;
}
