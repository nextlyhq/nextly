#!/usr/bin/env node

/**
 * What an application's own production build makes of the packed admin.
 *
 * The package splits its pages into chunks that load on demand, and the bundle
 * report and budgets judge that split in the package's own build. An
 * application does not serve those files: its bundler reads them as modules
 * and writes chunks of its own, and it may flatten, regroup or copy what the
 * package kept apart. This judges the application's output instead.
 *
 * The application is the fixture in `__fixtures__/consumer-app`: a Next.js app
 * that mounts the admin from `@nextlyhq/admin`, its public entry, and
 * registers a plugin page through it, as an application does. The package is
 * packed as a release packs it and placed in the fixture's `node_modules`, so
 * the build reads the published files through the export map, and the
 * fixture is built for production with Next.js's default bundler, Turbopack,
 * with source maps on so each output chunk names the modules it holds.
 *
 * The package's own build is the reference for what each page needs: the
 * modules `index.mjs` loads before it renders (the shell), and each
 * on-demand piece's static closure (its route). The output must hold to it:
 *
 * - every page the package loads on demand is still loaded on demand;
 * - the page's first load holds no admin module outside the shell;
 * - a direct visit to each route, its first load plus what its loader
 *   fetches, holds no admin module that neither the shell nor that route
 *   uses, and fetches no module twice;
 * - every admin module's code sits in one module of the output, so state a
 *   module keeps, such as the component registry a plugin page is registered
 *   in, exists once;
 * - the plugin page's component is registered by the first load;
 * - Lexical arrives as its production build, never its development build;
 * - the admin it bundled is the packed one, not the workspace's source.
 *
 * A module the output holds in more than one chunk is counted and printed with
 * its bytes, and does not fail the check: Turbopack copies a module into the
 * chunks of each on-demand group that loads it, which the package cannot
 * change and the application configures.
 *
 * The output is read as Turbopack writes it: each chunk registers module
 * factories through `TURBOPACK.push`, and a chunk loaded on demand is fetched
 * by a loader module naming its chunk files and the module to run. A build
 * this reader does not recognise fails the check rather than passing it: it
 * must find every page's loader, the shell, and the admin's modules.
 *
 * Usage:
 *   node scripts/check-consumer-bundle.mjs
 *       packs this package, builds the fixture with it, and checks the output
 *   node scripts/check-consumer-bundle.mjs --built
 *       checks the fixture's last build again, without packing or building
 */

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  literalText,
  parseSource,
  walk,
} from "@nextlyhq/module-specifiers/parse-source";

import { measureBundle } from "./bundle-report.mjs";
import { routeKey } from "./check-bundle-budgets.mjs";
import { packInto } from "./check-published-build.mjs";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = join(PACKAGE_ROOT, "__fixtures__", "consumer-app");

/** The fixture's admin page, as Next.js names its route. */
export const ADMIN_ROUTE = "/admin/[[...params]]";

/** The component the fixture registers as a plugin page, by its file. */
export const PLUGIN_PAGE_FILE = "src/plugin/fixture-plugin-page.jsx";

/**
 * Text only Lexical's development build holds: its error messages, which the
 * production build replaces with a code and a link to its error page.
 */
export const LEXICAL_DEVELOPMENT_TEXTS = [
  "indexPath: root is not a parent of child",
  "DOMSlot.insertChild: before is not in element",
];

/** The link Lexical's production build gives in place of each message. */
export const LEXICAL_PRODUCTION_TEXT = "lexical.dev/docs/error";

// ---------------------------------------------------------------------------
// Source maps
// ---------------------------------------------------------------------------

const BASE64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const DIGIT = new Map([...BASE64].map((char, value) => [char, value]));

/** One segment's fields, decoded from base64 VLQ. */
function decodeSegment(segment) {
  const fields = [];
  let value = 0;
  let shift = 0;
  for (const char of segment) {
    const digit = DIGIT.get(char);
    if (digit === undefined) {
      throw new Error(`a source map segment holds "${char}", not base64`);
    }
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
    } else {
      fields.push(value & 1 ? -(value >>> 1) : value >>> 1);
      value = 0;
      shift = 0;
    }
  }
  return fields;
}

/**
 * Where in the generated code each mapped segment starts, with the source it
 * maps to: `{ at, source }`, `at` an offset into the code as a string.
 *
 * Columns count UTF-16 code units, as JavaScript strings do and as the parser
 * reports node offsets, so a segment and a node compare directly.
 */
export function mappedSegments(code, map) {
  const lineStarts = [0];
  for (let at = 0; at < code.length; at++) {
    if (code.charCodeAt(at) === 10) lineStarts.push(at + 1);
  }
  const segments = [];
  let source = 0;
  map.mappings.split(";").forEach((line, index) => {
    let column = 0;
    for (const segment of line.split(",")) {
      if (!segment) continue;
      const fields = decodeSegment(segment);
      column += fields[0];
      if (fields.length < 4) continue;
      source += fields[1];
      segments.push({ at: lineStarts[index] + column, source });
    }
  });
  return segments;
}

// ---------------------------------------------------------------------------
// Turbopack's output
// ---------------------------------------------------------------------------

const TURBOPACK_SOURCE = /^turbopack:\/\/\/\[project\]\//;
const CHUNK_FILE = /^static\/chunks\/.+\.js$/;
const FUNCTIONS = new Set(["ArrowFunctionExpression", "FunctionExpression"]);

/** A source as the build names it, made relative to the build's project root. */
function projectPath(source) {
  return source.replace(TURBOPACK_SOURCE, "");
}

/** The `TURBOPACK.push([...])` array a chunk registers its modules with, if any. */
function pushedArray(program, code) {
  let found = null;
  walk(program, node => {
    if (found) return false;
    const pushes =
      node.type === "CallExpression" &&
      node.callee.type === "MemberExpression" &&
      !node.callee.computed &&
      node.callee.property.name === "push" &&
      code
        .slice(node.callee.object.start, node.callee.object.end)
        .includes("TURBOPACK") &&
      node.arguments[0]?.type === "ArrayExpression";
    if (pushes) found = node.arguments[0];
    return undefined;
  });
  return found;
}

function flatten(elements, into = []) {
  for (const element of elements) {
    if (element?.type === "ArrayExpression") flatten(element.elements, into);
    else into.push(element);
  }
  return into;
}

/**
 * What a loader module fetches and runs, or null for any other module.
 *
 * A loader is the module an `import()` becomes: it loads a list of chunk
 * files and then runs one module, `…Promise.all(["static/chunks/a.js", …]
 * .map(…)).then(() => require(12345))`.
 */
export function loaderOf(factory) {
  let chunks = null;
  let target = null;
  walk(factory, node => {
    chunks ??= chunkList(node);
    target ??= runTarget(node);
  });
  return chunks && target !== null ? { chunks, target } : null;
}

/** The chunk files an array literal names, when it names nothing else. */
function chunkList(node) {
  if (node.type !== "ArrayExpression" || node.elements.length === 0)
    return null;
  const files = node.elements.map(literalText);
  return files.every(file => file && CHUNK_FILE.test(file)) ? files : null;
}

/** The module id `.then(() => run(<id>))` runs, or null for any other node. */
function runTarget(node) {
  const isThen =
    node.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    node.callee.property.name === "then" &&
    FUNCTIONS.has(node.arguments[0]?.type);
  const body = isThen ? node.arguments[0].body : null;
  const id =
    body?.type === "CallExpression" && body.arguments.length === 1
      ? body.arguments[0]
      : null;
  return id?.type === "Literal" && typeof id.value === "number"
    ? id.value
    : null;
}

/**
 * The sources a factory's code maps to.
 *
 * A source counts when more than one segment inside the factory maps to it.
 * A module's code, however short, maps many tokens; a lone segment is the map
 * carrying a neighbouring module's source across a boundary, onto code the
 * bundler wrote (a factory's head, its import bindings), and read as code it
 * would place that module in a factory that holds none of it.
 */
function factorySources(factory, segments, map) {
  const counts = new Map();
  for (const { at, source } of segments) {
    if (at >= factory.start && at < factory.end) {
      counts.set(source, (counts.get(source) ?? 0) + 1);
    }
  }
  return new Set(
    [...counts]
      .filter(([, count]) => count > 1)
      .map(([source]) => projectPath(map.sources[source]))
  );
}

/**
 * One output chunk: the module factories it registers, each with the ids it
 * registers under, the sources its code maps to, and what it loads when it is
 * a loader.
 *
 * A chunk registers each factory after the ids it answers to: one id, or
 * several when the bundler merged modules into one factory. A chunk with no
 * `TURBOPACK.push` (the runtime, a polyfill) registers no modules. One that
 * registers modules without a source map cannot be read, and throws.
 */
export function readChunk(name, code, map) {
  const program = parseSource(code, name).program;
  const array = pushedArray(program, code);
  if (!array) return { name, factories: [], sources: new Set(), code };
  if (!map) {
    throw new Error(
      `${name} registers modules and has no source map to name them`
    );
  }
  const segments = mappedSegments(code, map);
  const factories = [];
  let ids = [];
  for (const element of flatten(array.elements.slice(1))) {
    if (element?.type === "Literal" && typeof element.value === "number") {
      ids.push(element.value);
      continue;
    }
    if (!FUNCTIONS.has(element?.type) || ids.length === 0) {
      throw new Error(
        `${name} registers something other than a module factory after its ids: ${element?.type}`
      );
    }
    const sources = factorySources(element, segments, map);
    factories.push({ ids, sources, loader: loaderOf(element) });
    ids = [];
  }
  const sources = new Set(factories.flatMap(factory => [...factory.sources]));
  return { name, factories, sources, code };
}

/** The first-load chunk files of each route, from the build's route statistics. */
function readFirstLoads(nextDir) {
  const file = join(nextDir, "diagnostics", "route-bundle-stats.json");
  if (!existsSync(file)) {
    throw new Error(
      `${relative(PACKAGE_ROOT, file)} is missing: the build wrote no route statistics`
    );
  }
  return new Map(
    JSON.parse(readFileSync(file, "utf8")).map(
      ({ route, firstLoadChunkPaths }) => [
        route,
        firstLoadChunkPaths.map(path => path.replace(/^\.next\//, "")),
      ]
    )
  );
}

/** Every client chunk of a build, read, and each route's first load. */
export function readOutput(nextDir) {
  const chunksDir = join(nextDir, "static", "chunks");
  const chunks = new Map();
  for (const file of readdirSync(chunksDir).filter(name =>
    name.endsWith(".js")
  )) {
    const code = readFileSync(join(chunksDir, file), "utf8");
    const mapFile = /\/\/# sourceMappingURL=(\S+)\s*$/.exec(code)?.[1];
    const map = mapFile
      ? JSON.parse(readFileSync(join(chunksDir, mapFile), "utf8"))
      : null;
    const name = `static/chunks/${file}`;
    chunks.set(name, readChunk(name, code, map));
  }
  return { chunks, firstLoads: readFirstLoads(nextDir) };
}

// ---------------------------------------------------------------------------
// The package's own graph
// ---------------------------------------------------------------------------

/**
 * The shell and each on-demand piece, from the package's own build.
 *
 * The bundle report already derives both from the import graph, so this reads
 * its answer rather than walking the graph a second way. A route's own code is
 * its static closure; what it may load on a direct visit is that plus the shell.
 */
export function packageGraph(distDir) {
  const report = measureBundle({ distDir, commit: "unversioned" });
  const shell = new Set(
    report.categories.firstScreen.chunks.map(chunk => chunk.rel)
  );
  const routes = report.routes.map(route => ({
    root: route.root,
    uses: new Set([...shell, ...route.beyondFirstScreen]),
  }));
  return {
    shell,
    routes,
    modules: new Set(report.chunks.map(chunk => chunk.file)),
  };
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

/**
 * The routes the admin loads on demand, by name: the ones the bundle budgets
 * pin. The budget gate holds every route the package's build has to a pin, so
 * the pins name each one; a route whose own chunk is gone, its code moved into
 * the shell or another chunk, keeps its pin and is missed here.
 */
export function pinnedRoutes(
  file = join(PACKAGE_ROOT, "scripts", "route-budgets.json")
) {
  return Object.keys(JSON.parse(readFileSync(file, "utf8")).routes).sort();
}

/** One problem, as every check below reports it. */
const problem = (kind, message) => ({ kind, message });

/**
 * The output, read against the package: which admin module each source is,
 * the first load, every factory with the id it answers to, and the loaders
 * that run each on-demand route.
 */
function outputModel({ pkg, output, adminDir, route }) {
  const prefix = `${adminDir}/dist/`;
  const adminModule = source =>
    source.startsWith(prefix) ? source.slice(prefix.length) : null;
  const sourcesIn = names =>
    names.flatMap(name => [...(output.chunks.get(name)?.sources ?? [])]);
  const adminModulesIn = names =>
    new Set(sourcesIn(names).map(adminModule).filter(Boolean));
  const firstLoad = output.firstLoads.get(route) ?? [];
  const factories = [...output.chunks.values()].flatMap(
    chunk => chunk.factories
  );
  const allSources = new Set(sourcesIn([...output.chunks.keys()]));
  return {
    prefix,
    adminModule,
    sourcesIn,
    adminModulesIn,
    firstLoad,
    factories,
    allSources,
    shellModules: adminModulesIn(firstLoad),
    outputModules: new Set([...allSources].map(adminModule).filter(Boolean)),
    loaded: loadersByRoot(pkg, factories, adminModule),
    rootOf: new Map(pkg.routes.map(r => [routeKey(r.root), r.root])),
  };
}

/** Each on-demand route of the package, with the loaders in the output that run it. */
function loadersByRoot(pkg, factories, adminModule) {
  const byId = new Map(factories.flatMap(f => f.ids.map(id => [id, f])));
  const loaded = new Map(pkg.routes.map(r => [r.root, []]));
  for (const { loader } of factories.filter(f => f.loader)) {
    for (const source of byId.get(loader.target)?.sources ?? []) {
      loaded.get(adminModule(source))?.push(loader);
    }
  }
  return loaded;
}

function firstLoadProblems(model, output, route) {
  const named = model.firstLoad.length
    ? []
    : [problem("no-first-load", `the build names no first load for ${route}`)];
  return named.concat(
    model.firstLoad
      .filter(name => !output.chunks.has(name))
      .map(name =>
        problem(
          "no-first-load",
          `${route}'s first load names ${name}, which the output does not hold`
        )
      )
  );
}

/** Routes whose code a module is, for a message; at most five named. */
function ownersOf(pkg, module) {
  const owners = pkg.routes
    .filter(r => r.uses.has(module) && !pkg.shell.has(module))
    .map(r => routeKey(r.root));
  if (owners.length === 0) return "";
  const more = owners.length > 5 ? ", …" : "";
  return ` (code of ${owners.slice(0, 5).join(", ")}${more})`;
}

/** The first load holds nothing the package keeps out of the shell. */
function shellProblems(model, pkg, route) {
  return [...model.shellModules]
    .filter(module => !pkg.shell.has(module))
    .map(module =>
      problem(
        "shell-loads-route-code",
        `${route}'s first load holds ${module}, which the shell does not use${ownersOf(pkg, module)}`
      )
    );
}

/** Every pinned route is its own chunk in the package and has a loader in the output. */
function onDemandProblems(model, pinned) {
  return pinned.flatMap(name => {
    const root = model.rootOf.get(name);
    if (!root) {
      return [
        problem(
          "route-not-on-demand",
          `${name} has no chunk of its own in the packed package, so nothing loads it on demand (a route removed on purpose leaves its pin: re-pin with check:budgets --pin)`
        ),
      ];
    }
    return model.loaded.get(root).length
      ? []
      : [
          problem(
            "route-not-on-demand",
            `${name} is not loaded on demand in the output: no loader runs it`
          ),
        ];
  });
}

/** Each route's direct visits: one per loader that runs it. */
function visits(model, pkg) {
  return pkg.routes.flatMap(r =>
    model.loaded.get(r.root).map(loader => ({ route: r, loader }))
  );
}

/**
 * What a route's loader adds holds only that route's code and the shell's.
 * The first load itself is judged once, against the shell.
 */
function foreignCodeProblems(model, pkg) {
  return visits(model, pkg).flatMap(({ route, loader }) =>
    [...model.adminModulesIn(loader.chunks)]
      .filter(module => !route.uses.has(module))
      .map(module =>
        problem(
          "route-loads-foreign-code",
          `a direct visit to ${routeKey(route.root)} loads ${module}, which neither the shell nor that route uses`
        )
      )
  );
}

/** A direct visit fetches each admin module in one chunk. */
function fetchedTwiceProblems(model, pkg) {
  return visits(model, pkg).flatMap(({ route, loader }) => {
    const chunks = [...new Set([...model.firstLoad, ...loader.chunks])];
    const counts = new Map();
    for (const module of model.sourcesIn(chunks).map(model.adminModule)) {
      if (module) counts.set(module, (counts.get(module) ?? 0) + 1);
    }
    return [...counts]
      .filter(([, count]) => count > 1)
      .map(([module, count]) =>
        problem(
          "fetched-twice",
          `a direct visit to ${routeKey(route.root)} fetches ${module} in ${count} chunks`
        )
      );
  });
}

/**
 * One module of the output per admin module: a factory registered under the
 * same ids in several chunks runs once; under different ids, once each.
 */
function runsTwiceProblems(model) {
  const homes = new Map();
  for (const factory of model.factories) {
    for (const module of [...factory.sources]
      .map(model.adminModule)
      .filter(Boolean)) {
      homes.set(
        module,
        (homes.get(module) ?? new Set()).add(factory.ids.join(","))
      );
    }
  }
  return [...homes]
    .filter(([, ids]) => ids.size > 1)
    .map(([module, ids]) =>
      problem(
        "module-runs-twice",
        `${module} is in ${ids.size} modules of the output (ids ${[...ids].join(" / ")}), so its state exists once per module`
      )
    );
}

/** The plugin page is registered as the admin page loads. */
function pluginPageProblems(model, pluginPage, route) {
  return model.sourcesIn(model.firstLoad).includes(pluginPage)
    ? []
    : [
        problem(
          "plugin-page-not-registered",
          `${route}'s first load does not hold ${pluginPage}, the plugin page the fixture registers`
        ),
      ];
}

/** The admin bundled is the packed one. */
function packedPackageProblems(model) {
  return [...model.allSources]
    .filter(source => /^packages\/admin\/(src|dist)\//.test(source))
    .map(source =>
      problem(
        "not-the-packed-package",
        `the output holds ${source}, the workspace's admin rather than the packed one`
      )
    );
}

/** Chunks holding Lexical's production build, and a problem per development-build text. */
function lexicalProblems(output) {
  const chunks = [...output.chunks.values()];
  const development = LEXICAL_DEVELOPMENT_TEXTS.flatMap(text =>
    chunks
      .filter(chunk => chunk.code.includes(text))
      .map(chunk =>
        problem(
          "lexical-development-build",
          `${chunk.name} holds Lexical's development build: "${text}"`
        )
      )
  );
  const production = chunks.filter(chunk =>
    chunk.code.includes(LEXICAL_PRODUCTION_TEXT)
  ).length;
  const unread = production
    ? []
    : [
        problem(
          "lexical-unread",
          "no chunk holds Lexical's production build, so which build the editor ships cannot be judged"
        ),
      ];
  return { problems: [...development, ...unread], production };
}

/** What was read, so a run that found nothing fails rather than passing. */
function populationProblems(model, pkg, pinned, route) {
  const empty = [
    [pinned.length, "no route is pinned, so no route can be expected"],
    [
      model.outputModules.size,
      `no output chunk holds a module under ${model.prefix}`,
    ],
    [model.shellModules.size, `${route}'s first load holds no admin module`],
  ];
  const unknown = [...model.outputModules]
    .filter(module => !pkg.modules.has(module))
    .map(module =>
      problem(
        "unknown-module",
        `the output holds ${module}, which the packed package does not`
      )
    );
  return empty
    .filter(([count]) => count === 0)
    .map(([, message]) => problem("nothing-read", message))
    .concat(unknown);
}

/** Admin modules the output holds in more than one chunk: measured, not judged. */
function copiedModules(model, output) {
  const counts = new Map();
  for (const chunk of output.chunks.values()) {
    for (const module of [...chunk.sources]
      .map(model.adminModule)
      .filter(Boolean)) {
      counts.set(module, (counts.get(module) ?? 0) + 1);
    }
  }
  return [...counts]
    .filter(([, count]) => count > 1)
    .map(([module, count]) => ({ module, count }));
}

/** Each problem once: a route with several loaders reports the same one again. */
function distinct(problems) {
  const seen = new Set();
  return problems.filter(({ kind, message }) => {
    const key = `${kind}\0${message}`;
    return seen.has(key) ? false : Boolean(seen.add(key));
  });
}

/**
 * Every problem in a consumer's output, each with a kind a caller can name,
 * and what it counted, so a run that read nothing cannot pass.
 *
 * `adminDir` is where the packed package sits, relative to the build's
 * project root; a source under it is the admin module at the same path in the
 * package. `pluginPage` is the fixture's plugin component, the same way.
 */
export function consumerFindings({
  pkg,
  output,
  adminDir,
  pluginPage,
  pinned,
  route = ADMIN_ROUTE,
}) {
  const model = outputModel({ pkg, output, adminDir, route });
  const lexical = lexicalProblems(output);
  const problems = [
    ...firstLoadProblems(model, output, route),
    ...shellProblems(model, pkg, route),
    ...onDemandProblems(model, pinned),
    ...foreignCodeProblems(model, pkg),
    ...fetchedTwiceProblems(model, pkg),
    ...runsTwiceProblems(model),
    ...pluginPageProblems(model, pluginPage, route),
    ...packedPackageProblems(model),
    ...lexical.problems,
    ...populationProblems(model, pkg, pinned, route),
  ];
  return {
    problems: distinct(problems),
    counts: {
      pinned: pinned.length,
      onDemand: [...model.loaded.values()].filter(l => l.length > 0).length,
      pieces: pkg.routes.length,
      shell: model.shellModules.size,
      modules: model.outputModules.size,
      chunks: output.chunks.size,
      lexicalChunks: lexical.production,
    },
    routeNames: [...model.rootOf.keys()].sort(),
    copied: copiedModules(model, output),
  };
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

/**
 * The fixture, with the packed admin placed in its `node_modules` and built.
 *
 * Placed rather than installed: the fixture resolves the admin from its own
 * `node_modules`, and everything else (Next.js, React, the admin's external
 * dependencies) from the package's own, one directory up, at the versions the
 * lockfile pins. A build from the same commit is therefore the same build.
 */
function buildFixture() {
  const placed = join(FIXTURE, "node_modules", "@nextlyhq", "admin");
  rmSync(join(FIXTURE, ".next"), { recursive: true, force: true });
  rmSync(placed, { recursive: true, force: true });
  const scratch = mkdtempSync(join(tmpdir(), "nx-admin-consumer-"));
  try {
    cpSync(packInto(scratch), placed, { recursive: true });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const next = createRequire(join(PACKAGE_ROOT, "package.json")).resolve(
    "next/dist/bin/next"
  );
  // A release build: the mode is the build's own, whatever the shell carries.
  const env = { ...process.env };
  delete env.NODE_ENV;
  execFileSync(process.execPath, [next, "build", FIXTURE], {
    cwd: FIXTURE,
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...env, NEXT_TELEMETRY_DISABLED: "1" },
  });
  return join(FIXTURE, ".next");
}

/** The build's project root: where the lockfile sits, which Turbopack names sources from. */
function projectRoot() {
  let dir = PACKAGE_ROOT;
  while (!existsSync(join(dir, "pnpm-lock.yaml"))) {
    const up = dirname(dir);
    if (up === dir) throw new Error("no pnpm-lock.yaml above the package");
    dir = up;
  }
  return dir;
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function main(argv) {
  const started = Date.now();
  const rebuild = !argv.includes("--built");
  const nextDir = rebuild ? buildFixture() : join(FIXTURE, ".next");
  const built = Date.now();
  const root = projectRoot();
  const adminDir = relative(
    root,
    join(FIXTURE, "node_modules", "@nextlyhq", "admin")
  )
    .split("\\")
    .join("/");
  const pluginPage = relative(root, join(FIXTURE, PLUGIN_PAGE_FILE))
    .split("\\")
    .join("/");
  const distDir = join(FIXTURE, "node_modules", "@nextlyhq", "admin", "dist");
  const pinned = pinnedRoutes();
  const { problems, counts, routeNames, copied } = consumerFindings({
    pkg: packageGraph(distDir),
    output: readOutput(nextDir),
    adminDir,
    pluginPage,
    pinned,
  });
  const seconds = ms => `${(ms / 1000).toFixed(1)} s`;
  console.log(
    `check-consumer-bundle: read ${counts.chunks} chunks holding ${counts.modules} admin modules; ` +
      `${counts.onDemand} of the ${counts.pieces} routes the package loads on demand have a loader, against ${counts.pinned} pinned; ` +
      `the first load holds ${counts.shell} admin modules; Lexical's production build is in ${counts.lexicalChunks} chunks. ` +
      `${rebuild ? `Build ${seconds(built - started)}` : "Last build read"}, check ${seconds(Date.now() - built)}.`
  );
  console.log(`  routes: ${routeNames.join(", ")}`);
  const copiedBytes = copied.reduce((sum, { module, count }) => {
    const path = join(distDir, module);
    return (
      sum + (existsSync(path) ? readFileSync(path).length * (count - 1) : 0)
    );
  }, 0);
  console.log(
    `  measured, not judged: ${copied.length} admin modules sit in more than one chunk, ${kb(copiedBytes)} of extra copies, the bundler's own chunking.`
  );
  if (problems.length > 0) {
    console.error(
      `check-consumer-bundle: ${problems.length} problem(s) in the consumer's production build:`
    );
    for (const { kind, message } of problems)
      console.error(`  ${kind}: ${message}`);
    return 1;
  }
  console.log(
    "check-consumer-bundle: ok, each direct visit loads the shell and its route only, every admin module runs once, the plugin page registers at load, and Lexical ships its production build."
  );
  return 0;
}

const invokedDirectly =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  process.exitCode = main(process.argv.slice(2));
}
