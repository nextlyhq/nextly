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
 * - once the first load has run, the registry the admin reads holds the
 *   plugin page under its key: the first load runs in a DOM through the
 *   build's own runtime, and the registry's reader is asked;
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
 *   node scripts/check-consumer-bundle.mjs --must-fail-with <kind,...>
 *       succeeds only if the check reports every named kind: CI packs the
 *       admin built in development mode and requires
 *       `lexical-development-build`, so a Lexical whose development texts are
 *       no longer recognised fails there instead of passing quietly here
 */

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
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
import { option, packInto, unreported } from "./check-published-build.mjs";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = join(PACKAGE_ROOT, "__fixtures__", "consumer-app");

/** The fixture's admin page, as Next.js names its route. */
export const ADMIN_ROUTE = "/admin/[[...params]]";

/** The fixture's admin page, whose module registers the plugin page as it loads. */
export const ADMIN_PAGE_FILE = "src/app/admin/[[...params]]/page.jsx";

/** The key the fixture registers its plugin page under. */
export const PLUGIN_PAGE_KEY =
  "@fixture/consumer-plugin/admin#FixturePluginPage";

/** The `data-testid` the fixture's plugin page renders, which tells it apart. */
export const PLUGIN_PAGE_MARK = "fixture-plugin-page";

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
  if (!isThenCall(node)) return null;
  const body = node.arguments[0].body;
  const runs = body.type === "CallExpression" && body.arguments.length === 1;
  return runs ? numberValue(body.arguments[0]) : null;
}

/** Whether a node is `<promise>.then(<function>, …)`. */
function isThenCall(node) {
  return (
    node.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    node.callee.property.name === "then" &&
    FUNCTIONS.has(node.arguments[0]?.type)
  );
}

/** A number literal's value, or null for any other node. */
function numberValue(node) {
  return node?.type === "Literal" && typeof node.value === "number"
    ? node.value
    : null;
}

/**
 * The sources the code of a factory, or of a call inside one, maps to.
 *
 * A source counts when more than one segment inside the node maps to it.
 * A module's code, however short, maps many tokens; a lone segment is the map
 * carrying a neighbouring module's source across a boundary, onto code the
 * bundler wrote (a factory's head, its import bindings), and read as code it
 * would place that module in a factory that holds none of it.
 */
function sourcesWithin(node, segments, map) {
  const counts = new Map();
  for (const { at, source } of segments) {
    if (at >= node.start && at < node.end) {
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
 * The modules a factory gives exports to, each by the id the exports are
 * given under and the sources the call's code maps to.
 *
 * A factory holding several modules, merged by the bundler, gives each its
 * exports with `e.s([name, …], <id>)`, and that call's code maps to the
 * module it exports from, so it names which id a module of the package became.
 */
function exportedModules(factory, segments, map) {
  const modules = [];
  walk(factory, node => {
    const id = exportsId(node);
    if (id !== null) {
      modules.push({ id, sources: sourcesWithin(node, segments, map) });
    }
  });
  return modules;
}

/** The id `e.s([name, …], <id>)` gives exports under, or null for any other node. */
function exportsId(node) {
  if (node.type !== "CallExpression") return null;
  const [names, id] = node.arguments;
  const gives =
    node.callee.type === "MemberExpression" &&
    node.callee.property.name === "s" &&
    names?.type === "ArrayExpression";
  return gives ? numberValue(id) : null;
}

/**
 * One output chunk: the module factories it registers, each with the ids it
 * registers under, the sources its code maps to, the modules it gives exports
 * to by id, and what it loads when it is a loader.
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
    factories.push({
      ids,
      sources: sourcesWithin(element, segments, map),
      modules: exportedModules(element, segments, map),
      loader: loaderOf(element),
    });
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
// Lexical's development builds
// ---------------------------------------------------------------------------

const LEXICAL_PACKAGE = /^(lexical|@lexical\/.+)$/;

/**
 * Text short of this is too likely to occur in other code, and a text with
 * quotes, backslashes or line breaks can be re-escaped by a minifier, so it
 * is not looked for.
 */
const SHORTEST_TEXT = 24;
const PLAIN_TEXT = /^[\w $.:,;()[\]{}<>=!?/-]+$/;

/**
 * Lexical's packages a package's build bundles, by name and directory: the
 * ones its manifest names, and those packages' own Lexical dependencies in
 * turn, each resolved beside the package that names it, as pnpm lays them out.
 */
export function lexicalPackages(manifestDir = PACKAGE_ROOT) {
  const found = new Map();
  const visit = (manifest, modulesDir) => {
    const names = Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
    }).filter(name => LEXICAL_PACKAGE.test(name) && !found.has(name));
    for (const name of names) {
      const at = join(modulesDir, name);
      if (!existsSync(at)) continue;
      const dir = realpathSync(at);
      found.set(name, dir);
      visit(
        JSON.parse(readFileSync(join(dir, "package.json"), "utf8")),
        dir.slice(0, dir.length - name.length - 1)
      );
    }
  };
  visit(
    JSON.parse(readFileSync(join(manifestDir, "package.json"), "utf8")),
    join(manifestDir, "node_modules")
  );
  return found;
}

/**
 * The text each development build holds that no production build does, each
 * with the package it comes from.
 *
 * `builds` is each Lexical module's development and production build, as
 * `{ from, development, production }` with the code of each. Every string and
 * template text of a development build is a candidate; one that any production
 * build holds is not development-only. Derived from the builds rather than
 * listed, so a release that rewords its messages moves the texts with it.
 */
export function developmentTexts(builds) {
  const texts = new Map();
  for (const { from, development } of builds) {
    walk(parseSource(development, `${from}.dev.mjs`).program, node => {
      const candidates =
        node.type === "TemplateLiteral"
          ? node.quasis.map(quasi => quasi.value.cooked)
          : node.type === "Literal" && typeof node.value === "string"
            ? [node.value]
            : [];
      for (const text of candidates) {
        const plain =
          text && text.length >= SHORTEST_TEXT && PLAIN_TEXT.test(text);
        if (plain && !texts.has(text)) texts.set(text, from);
      }
    });
  }
  for (const text of texts.keys()) {
    if (builds.some(({ production }) => production.includes(text))) {
      texts.delete(text);
    }
  }
  return texts;
}

/**
 * The development-only texts of every Lexical module the package's build
 * bundles: each `*.dev.mjs` beside its `*.prod.mjs` in each package's `dist`.
 */
export function lexicalDevelopmentTexts(manifestDir = PACKAGE_ROOT) {
  const builds = [];
  for (const [from, dir] of lexicalPackages(manifestDir)) {
    const dist = join(dir, "dist");
    if (!existsSync(dist)) continue;
    for (const file of readdirSync(dist).filter(name =>
      name.endsWith(".dev.mjs")
    )) {
      const production = join(dist, file.replace(/\.dev\.mjs$/, ".prod.mjs"));
      if (!existsSync(production)) continue;
      builds.push({
        from,
        development: readFileSync(join(dist, file), "utf8"),
        production: readFileSync(production, "utf8"),
      });
    }
  }
  return developmentTexts(builds);
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
  const reachable = [...reachableChunks(output, firstLoad)].flatMap(
    name => output.chunks.get(name)?.factories ?? []
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
    loaded: loadersByRoot(pkg, reachable, adminModule),
    rootOf: new Map(pkg.routes.map(r => [routeKey(r.root), r.root])),
  };
}

/**
 * The chunks a visit to the page can reach: its first load, and what each
 * loader registered in a reachable chunk fetches, in turn. A loader in a chunk
 * nothing reaches never runs, so the route it names is not loaded on demand.
 */
function reachableChunks(output, firstLoad) {
  const reached = new Set(firstLoad);
  for (const name of reached) {
    for (const { loader } of output.chunks.get(name)?.factories ?? []) {
      for (const next of loader?.chunks ?? []) reached.add(next);
    }
  }
  return reached;
}

/**
 * Each on-demand route of the package, with the loaders that run it, from the
 * factories of the chunks the page reaches: a loader and the module it runs
 * both have to be among them.
 */
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

/**
 * The registry the admin reads holds the fixture's plugin page under its key
 * once the first load has run. "Could not ask" is its own kind, so a run that
 * failed is not read as a registration that failed.
 */
export function registrationProblems(registration, route) {
  if (registration.error) {
    return [
      problem(
        "registration-unread",
        `the registry could not be asked for the plugin page after ${route}'s first load ran: ${registration.error}`
      ),
    ];
  }
  if (registration.rendered === PLUGIN_PAGE_MARK) return [];
  const holds =
    registration.rendered == null
      ? "nothing"
      : `a component rendering "${registration.rendered}", not the fixture's plugin page`;
  return [
    problem(
      "plugin-page-not-registered",
      `once ${route}'s first load has run, the registry the admin reads holds ${holds} under ${PLUGIN_PAGE_KEY}`
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

/**
 * Chunks holding Lexical's production build, and a problem per chunk and
 * Lexical package whose development-only text the chunk holds.
 *
 * `developmentTexts` maps each text to the package whose development build
 * holds it ({@link lexicalDevelopmentTexts}). None at all means the
 * development build could not be recognised, which fails rather than passes.
 */
function lexicalProblems(output, developmentTexts) {
  const chunks = [...output.chunks.values()];
  const development = chunks.flatMap(chunk => {
    const found = new Map();
    for (const [text, from] of developmentTexts) {
      if (chunk.code.includes(text)) {
        found.set(from, [...(found.get(from) ?? []), text]);
      }
    }
    return [...found].map(([from, texts]) =>
      problem(
        "lexical-development-build",
        `${chunk.name} holds the development build of ${from}: ${texts.length} of its development-only texts, such as "${texts[0]}"`
      )
    );
  });
  const unrecognised = developmentTexts.size
    ? []
    : [
        problem(
          "lexical-unread",
          "no development-only text was found in Lexical's installed development builds, so a development build in the output cannot be recognised"
        ),
      ];
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
  return {
    problems: [...development, ...unrecognised, ...unread],
    production,
  };
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
 * package. `registration` is what {@link askRegistry} found, and
 * `developmentTexts` what {@link lexicalDevelopmentTexts} read.
 */
export function consumerFindings({
  pkg,
  output,
  adminDir,
  registration,
  developmentTexts,
  pinned,
  route = ADMIN_ROUTE,
}) {
  const model = outputModel({ pkg, output, adminDir, route });
  const lexical = lexicalProblems(output, developmentTexts);
  const problems = [
    ...firstLoadProblems(model, output, route),
    ...shellProblems(model, pkg, route),
    ...onDemandProblems(model, pinned),
    ...foreignCodeProblems(model, pkg),
    ...fetchedTwiceProblems(model, pkg),
    ...runsTwiceProblems(model),
    ...registrationProblems(registration, route),
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
// The plugin page's registration, run
// ---------------------------------------------------------------------------

const nameOf = node => node.name ?? node.value;

/**
 * The registry's reader as the package publishes it: the module of `dist`
 * `getComponent` comes from, and the name that module exports it under.
 *
 * The package's `./lib/component-registry` entry is the public name for the
 * reader, and its build re-exports a minified module's export, so the mapping
 * is read from the package rather than guessed from a minified name.
 */
export function registryReader(packageDir) {
  const manifest = JSON.parse(
    readFileSync(join(packageDir, "package.json"), "utf8")
  );
  const entry = manifest.exports?.["./lib/component-registry"];
  const file =
    typeof entry === "string" ? entry : (entry?.import ?? entry?.default);
  if (!file) {
    throw new Error("the package exports no ./lib/component-registry entry");
  }
  const path = join(packageDir, file);
  const asModule = from =>
    relative(join(packageDir, "dist"), from).split("\\").join("/");
  const program = parseSource(readFileSync(path, "utf8"), path).program;
  for (const node of program.body) {
    if (node.type !== "ExportNamedDeclaration") continue;
    if (node.declaration?.id?.name === "getComponent") {
      return { module: asModule(path), name: "getComponent" };
    }
    const spec = (node.specifiers ?? []).find(
      each => nameOf(each.exported) === "getComponent"
    );
    if (!spec) continue;
    return node.source
      ? {
          module: asModule(resolve(dirname(path), literalText(node.source))),
          name: nameOf(spec.local),
        }
      : { module: asModule(path), name: "getComponent" };
  }
  throw new Error(`${file} does not export getComponent`);
}

/**
 * The ids the module of a source answers to in the output: the id a merged
 * factory gives its exports under, or the factory's own when it holds that
 * module alone.
 */
export function outputIds(output, source) {
  const factories = [...output.chunks.values()].flatMap(
    chunk => chunk.factories
  );
  return [...new Set(factories.flatMap(factory => idsFor(factory, source)))];
}

/** The ids one factory gives the module of a source. */
function idsFor(factory, source) {
  const given = (factory.modules ?? [])
    .filter(module => module.sources.has(source))
    .map(module => module.id);
  const alone = factory.ids.length === 1 && factory.sources.size === 1;
  return alone && factory.sources.has(source)
    ? [...given, factory.ids[0]]
    : given;
}

const PROBE_CHUNK = "static/chunks/check-consumer-bundle-probe.js";
const PROBE_ENTRY = "static/chunks/check-consumer-bundle-entry.js";
const PROBE_ID = -1;

/**
 * The chunk the check adds to the run: one module that evaluates the page's
 * module, as rendering the page does, then asks the registry's reader for the
 * plugin page and renders what it returns. The fixture's plugin page has no
 * hooks, so it renders called as a function.
 */
function probeChunk({ pageId, registryId, getter }) {
  const json = JSON.stringify;
  return `TURBOPACK.push([${json(PROBE_CHUNK)}, ${PROBE_ID}, function (context) {
  let answer;
  try {
    context.i(${json(pageId)});
    const reader = context.i(${json(registryId)})[${json(getter)}];
    const component = reader(${json(PLUGIN_PAGE_KEY)});
    const element = typeof component === "function" ? component({}) : null;
    answer = { rendered: element?.props?.["data-testid"] ?? null };
  } catch (error) {
    answer = { error: String(error?.message ?? error) };
  }
  __checkConsumerBundleAnswer(answer);
}]);`;
}

/**
 * What the registry holds for the plugin page once the page's first load has
 * run, asked through the registry's own reader.
 *
 * The first-load chunks run in a DOM as a browser runs them, through the
 * build's own Turbopack runtime: the chunks that register nothing (the
 * runtime) first, then each chunk, which registers its factories. The probe
 * chunk then runs. Returns `{ rendered }`, the `data-testid` of what the
 * registry returned (null for nothing), or `{ error }` when it could not ask.
 */
export async function runRegistration({
  nextDir,
  output,
  firstLoad,
  pageId,
  registryId,
  getter,
}) {
  const { JSDOM, VirtualConsole } = createRequire(
    join(PACKAGE_ROOT, "package.json")
  )("jsdom");
  const dom = new JSDOM(
    "<!doctype html><html><head></head><body></body></html>",
    {
      url: "http://localhost/admin",
      runScripts: "outside-only",
      virtualConsole: new VirtualConsole(),
    }
  );
  const { window } = dom;
  // What a browser has and jsdom does not, which modules use as they load.
  Object.assign(window, {
    TextEncoder,
    TextDecoder,
    ReadableStream,
    MessageChannel,
  });
  const registers = name => output.chunks.get(name).factories.length > 0;
  const order = [
    ...firstLoad.filter(name => !registers(name)),
    ...firstLoad.filter(registers),
  ];
  const run = (name, code) => {
    // A chunk names itself by its script element; run here, it has none.
    window.TURBOPACK_NEXT_CHUNK_URLS = [`/_next/${name}`];
    window.eval(code);
  };
  try {
    for (const name of order) {
      run(name, readFileSync(join(nextDir, name), "utf8"));
    }
    return await new Promise(settle => {
      const timer = setTimeout(
        () => settle({ error: "the probe gave no answer within 10 s" }),
        10_000
      );
      window.__checkConsumerBundleAnswer = answer => {
        clearTimeout(timer);
        settle(answer);
      };
      run(PROBE_CHUNK, probeChunk({ pageId, registryId, getter }));
      const entry = [
        PROBE_ENTRY,
        { otherChunks: [], runtimeModuleIds: [PROBE_ID] },
      ];
      run(PROBE_ENTRY, `TURBOPACK.push(${JSON.stringify(entry)});`);
    });
  } catch (error) {
    return { error: String(error?.message ?? error) };
  } finally {
    window.close();
  }
}

/**
 * Asks the registry the admin reads for the fixture's plugin page, after the
 * page's first load has run. Finding what to run is part of asking: a page
 * or registry module the output does not hold once is an answer of its own.
 */
export async function askRegistry({
  nextDir,
  output,
  adminDir,
  adminPage,
  packageDir,
  route = ADMIN_ROUTE,
}) {
  try {
    const reader = registryReader(packageDir);
    const registry = `${adminDir}/dist/${reader.module}`;
    const pageIds = outputIds(output, adminPage);
    const registryIds = outputIds(output, registry);
    for (const [source, ids] of [
      [adminPage, pageIds],
      [registry, registryIds],
    ]) {
      if (ids.length !== 1) {
        return {
          error: `the output holds ${source} as ${ids.length} modules (${ids.join(", ") || "none"}), not one`,
        };
      }
    }
    return await runRegistration({
      nextDir,
      output,
      firstLoad: output.firstLoads.get(route) ?? [],
      pageId: pageIds[0],
      registryId: registryIds[0],
      getter: reader.name,
    });
  } catch (error) {
    return { error: String(error?.message ?? error) };
  }
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

/** A run that must fail: it passes only if every expected kind is reported. */
function expectedFailure(expected, problems) {
  const absent = unreported(expected, problems);
  if (absent.length > 0) {
    console.error(
      `check-consumer-bundle: expected this build to fail with ${expected.join(", ")}; not reported: ${absent.join(", ")}`
    );
    for (const { kind, message } of problems)
      console.error(`  ${kind}: ${message}`);
    return 1;
  }
  console.log(
    `check-consumer-bundle: ok, this build fails as it should (${expected.join(", ")}).`
  );
  return 0;
}

async function main(argv) {
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
  const adminPage = relative(root, join(FIXTURE, ADMIN_PAGE_FILE))
    .split("\\")
    .join("/");
  const packageDir = join(FIXTURE, "node_modules", "@nextlyhq", "admin");
  const distDir = join(packageDir, "dist");
  const pinned = pinnedRoutes();
  const output = readOutput(nextDir);
  const registration = await askRegistry({
    nextDir,
    output,
    adminDir,
    adminPage,
    packageDir,
  });
  const developmentTexts = lexicalDevelopmentTexts();
  const { problems, counts, routeNames, copied } = consumerFindings({
    pkg: packageGraph(distDir),
    output,
    adminDir,
    registration,
    developmentTexts,
    pinned,
  });
  const seconds = ms => `${(ms / 1000).toFixed(1)} s`;
  console.log(
    `check-consumer-bundle: read ${counts.chunks} chunks holding ${counts.modules} admin modules; ` +
      `${counts.onDemand} of the ${counts.pieces} routes the package loads on demand have a loader, against ${counts.pinned} pinned; ` +
      `the first load holds ${counts.shell} admin modules; Lexical's production build is in ${counts.lexicalChunks} chunks, and ${developmentTexts.size} texts only its development builds hold were looked for. ` +
      `${rebuild ? `Build ${seconds(built - started)}` : "Last build read"}, check ${seconds(Date.now() - built)}.`
  );
  console.log(`  routes: ${routeNames.join(", ")}`);
  console.log(
    `  the registry, asked for ${PLUGIN_PAGE_KEY} once the first load had run: ${
      registration.error
        ? `not asked (${registration.error})`
        : `returned ${registration.rendered == null ? "nothing" : `a component rendering "${registration.rendered}"`}`
    }`
  );
  const copiedBytes = copied.reduce((sum, { module, count }) => {
    const path = join(distDir, module);
    return (
      sum + (existsSync(path) ? readFileSync(path).length * (count - 1) : 0)
    );
  }, 0);
  console.log(
    `  measured, not judged: ${copied.length} admin modules sit in more than one chunk, ${kb(copiedBytes)} of extra copies, the bundler's own chunking.`
  );
  const expected = option(argv, "--must-fail-with")?.split(",");
  if (expected) return expectedFailure(expected, problems);
  if (problems.length > 0) {
    console.error(
      `check-consumer-bundle: ${problems.length} problem(s) in the consumer's production build:`
    );
    for (const { kind, message } of problems)
      console.error(`  ${kind}: ${message}`);
    return 1;
  }
  console.log(
    "check-consumer-bundle: ok, each direct visit loads the shell and its route only, every admin module runs once, the registry holds the plugin page once the first load has run, and Lexical ships its production build."
  );
  return 0;
}

const invokedDirectly =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  process.exitCode = await main(process.argv.slice(2));
}
