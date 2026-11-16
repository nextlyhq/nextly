#!/usr/bin/env node

/**
 * The page builder's code on each admin screen of the playground's production
 * build, held to its budgets.
 *
 * The admin's bundle report (`packages/admin/scripts/bundle-report.mjs`)
 * measures the admin's own build, which cannot see what a plugin contributes:
 * the plugin reaches the admin through the app's generated component map, so
 * only the app's bundler decides where its code lands. This reads the
 * playground's build through that report's screens measure, for four screens:
 *
 * - the sign-in page and the dashboard: the page builder's code there is its
 *   registration alone, at most `REGISTRATION_BUDGET_KB` gzipped, and holds no
 *   module of the builder editor, of the block engine beyond its narrow
 *   entries (core checks colours with `./contrast` on every screen, and a
 *   block-contributing plugin reaches `./named-query` through the plugin
 *   SDK), or of the engine's CSS parser; the editor stylesheet is not among the stylesheets
 *   every admin screen links;
 * - the dashboard with the plugin's parts it draws without a click (the
 *   Bindings to fix card, the header's delete tools): held to the same
 *   budget, and none of those modules either;
 * - the builder, opened directly: the site's code section, the fonts panel
 *   and the icon set arrive when their panel or control opens, so none is in
 *   its set, and its chunks can fetch the editor stylesheet.
 *
 * A breach listed in `KNOWN_MISSES` is reported and does not fail the run,
 * until it stops happening, which fails the run so its line is removed, as
 * the builder speed check's expected failures work.
 *
 * The build must have browser source maps, which name each chunk's modules:
 * `NEXTLY_BROWSER_SOURCE_MAPS=1 pnpm --filter playground exec next build`.
 *
 * Usage:
 *   node scripts/page-builder-bundle-report.mjs [--next <dist dir>] [--json <file>]
 *
 * `--next` defaults to the playground's `.next`. Exits 1 naming each breach.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import {
  formatScreens,
  measureScreens,
} from "../packages/admin/scripts/bundle-report.mjs";
import {
  mappedSegments,
  readOutput,
} from "../packages/admin/scripts/check-consumer-bundle.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The playground's admin page, as Next.js names its route. */
export const ADMIN_ROUTE = "/admin/[[...params]]";

/** The admin page's module, as the build's client manifest keys its stylesheets. */
const ADMIN_PAGE_MODULE =
  "[project]/apps/playground/src/app/admin/[[...params]]/page";

/**
 * What the page builder may weigh, gzipped, on a screen that draws none of its
 * editor: the registration of its parts, its list column and its row actions,
 * and the small parts a dashboard draws without a click.
 */
export const REGISTRATION_BUDGET_KB = 30;

const ADMIN_PAGES = "packages/admin/src/";

/**
 * The screens, each by the modules whose loaders run on the way to it: the
 * admin's route, then the plugin's parts on that route. An `editorFree`
 * screen is held to `REGISTRATION_BUDGET_KB` with no module of the builder
 * editor, of the block engine beyond its narrow entries, or of the CSS parser.
 */
export const SCREENS = [
  {
    name: "sign-in",
    opens: [
      new RegExp(`^${ADMIN_PAGES}components/features/auth-login/index\\.tsx$`),
    ],
    editorFree: true,
  },
  {
    name: "dashboard",
    opens: [new RegExp(`^${ADMIN_PAGES}pages/dashboard/index\\.tsx$`)],
    editorFree: true,
  },
  {
    // The parts the dashboard draws as soon as it renders, each fetching its
    // code then: the Bindings to fix card while there are bindings to fix,
    // and the header's delete tools, on every page for a host's component
    // store. The playground draws neither, but its build holds their loaders.
    name: "dashboard, parts drawn",
    opens: [
      new RegExp(`^${ADMIN_PAGES}pages/dashboard/index\\.tsx$`),
      /^packages\/plugin-page-builder\/src\/admin\/bindings-report\/BindingsToFixCard\.tsx$/,
      /^packages\/plugin-page-builder\/src\/admin\/DeleteComponentAction\.tsx$/,
    ],
    editorFree: true,
  },
  {
    name: "builder",
    opens: [
      new RegExp(
        `^${ADMIN_PAGES}pages/dashboard/entries/\\[slug\\]/\\[id\\]/index\\.tsx$`
      ),
      /^packages\/plugin-page-builder\/src\/admin\/editor\/PageBuilderView\.tsx$/,
    ],
    onDemand: ["site-code section", "font studio", "icon set"],
    fetchesEditorStylesheet: true,
  },
];

/** The groups of modules each screen is measured by, by their sources. */
export const GROUPS = [
  {
    // The plugin's own code and the packages only it brings to the admin.
    name: "page builder",
    matches: source =>
      /^packages\/(plugin-page-builder|builder|blocks-react)\//.test(source),
  },
  {
    // Measured, not budgeted: its narrow entries may be on every screen (see
    // the next group, which is judged).
    name: "block engine",
    matches: source => source.startsWith("packages/blocks-engine/"),
  },
  {
    // Judged on a screen that draws no part: the engine less what its narrow
    // entries reach (`narrowEngineSources`). Core reads `./format` and checks
    // colours with `./contrast` on every screen, and a plugin that
    // contributes blocks reaches `./named-query` through the plugin SDK.
    name: "block engine beyond its narrow entries",
    matches: source =>
      source.startsWith(`${ENGINE}/`) && !NARROW_ENGINE_SOURCES.has(source),
  },
  {
    name: "builder editor",
    matches: source => source.startsWith("packages/builder/"),
  },
  {
    name: "CSS parser",
    matches: source => /\/node_modules\/css-tree\//.test(source),
  },
  {
    name: "site-code section",
    matches: source =>
      /^packages\/plugin-page-builder\/src\/admin\/(editor\/site-code-settings\.tsx|site-code-client\.ts)$/.test(
        source
      ),
  },
  {
    name: "icon set",
    matches: source =>
      source === "packages/blocks-react/src/icons/lucide-data.ts",
  },
  {
    name: "font studio",
    matches: source =>
      source ===
      "packages/plugin-page-builder/src/admin/editor/site-style-fonts.tsx",
  },
  {
    // Measured, not judged: the builder's own fonts panel ships inside
    // `@nextlyhq/builder/shell`, one module the editor imports whole.
    name: "builder fonts panel",
    matches: source =>
      /^packages\/builder\/src\/(fonts-panel\.tsx|font-library\.ts)$/.test(
        source
      ),
  },
];

/** The block engine's package, as the build's source maps name its files. */
const ENGINE = "packages/blocks-engine";

/**
 * Every source of the block engine its narrow entries reach, as the build's
 * source maps name them, with their built files: each subpath export other
 * than the root, walked through the engine build's own module graph (its
 * metafile), so an entry's reach is read rather than listed and cannot drift.
 * Empty when either is missing, so every engine module then counts as beyond
 * them: the check fails rather than passing on nothing.
 */
export function narrowEngineSources(packageJson, metafile) {
  const outputs = metafile?.outputs;
  if (packageJson?.exports === undefined || outputs === undefined) {
    return new Set();
  }
  const entries = Object.entries(packageJson.exports)
    .filter(([subpath]) => subpath !== ".")
    .map(([, target]) => target?.import ?? target?.default)
    .filter(target => typeof target === "string")
    .map(target => target.replace(/^\.\//, ""));
  const reached = new Set();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || reached.has(file)) continue;
    reached.add(file);
    for (const edge of outputs[file]?.imports ?? []) {
      if (edge.external !== true) queue.push(edge.path);
    }
  }
  const sources = new Set();
  for (const file of reached) {
    sources.add(`${ENGINE}/${file}`);
    for (const input of Object.keys(outputs[file]?.inputs ?? {})) {
      sources.add(`${ENGINE}/${input}`);
    }
  }
  return sources;
}

/** Reads the engine's package and its build's metafile, if there is one. */
function readNarrowEngineSources(root = ROOT) {
  const read = path =>
    existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
  return narrowEngineSources(
    read(join(root, ENGINE, "package.json")),
    read(join(root, ENGINE, "dist", "metafile-esm.json"))
  );
}

const NARROW_ENGINE_SOURCES = readNarrowEngineSources();

/** The editor stylesheet, as the build's CSS source maps name it. */
const EDITOR_STYLESHEET =
  /^packages\/plugin-page-builder\/(dist|src)\/styles\/editor\.css$/;

/**
 * Breaches known today, each with why, by the start of its sentence. None:
 * each breach fails the run.
 */
export const KNOWN_MISSES = [];

/**
 * How much of a chunk's code each source accounts for, in characters: the
 * code from each mapped segment to the next belongs to the segment's source.
 * Code before the first segment, and between a module and the next, is the
 * bundler's own and counts for no source.
 */
export function sourceLengths(code, map) {
  const segments = mappedSegments(code, map).sort((a, b) => a.at - b.at);
  const lengths = new Map();
  segments.forEach(({ at, source }, index) => {
    const end = segments[index + 1]?.at ?? code.length;
    const name = map.sources[source].replace(
      /^turbopack:\/\/\/\[project\]\//,
      ""
    );
    lengths.set(name, (lengths.get(name) ?? 0) + (end - at));
  });
  return lengths;
}

/**
 * The build's output as the screens measure reads it: each chunk with how
 * much of its code each source accounts for, and each route's first-load
 * chunks named from the build directory however it is called (the route
 * statistics prefix them with it).
 */
export function readBuild(nextDir) {
  const output = readOutput(nextDir);
  for (const [name, chunk] of output.chunks) {
    const mapFile = /\/\/# sourceMappingURL=(\S+)\s*$/.exec(chunk.code)?.[1];
    chunk.sourceLength = mapFile
      ? sourceLengths(
          chunk.code,
          JSON.parse(
            readFileSync(join(nextDir, dirname(name), mapFile), "utf8")
          )
        )
      : new Map();
  }
  return {
    ...output,
    firstLoads: new Map(
      [...output.firstLoads].map(([route, names]) => [
        route,
        names.map(name => name.replace(/^.*?(?=static\/chunks\/)/, "")),
      ])
    ),
  };
}

/**
 * The sources each stylesheet the admin page links before it renders maps to,
 * read from the page's client manifest and the stylesheets' source maps.
 */
export function firstLoadStylesheets(nextDir) {
  const manifestFile = join(
    nextDir,
    "server/app/admin/[[...params]]/page_client-reference-manifest.js"
  );
  const sandbox = { self: {} };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(readFileSync(manifestFile, "utf8"), sandbox);
  const manifest = sandbox.__RSC_MANIFEST?.["/admin/[[...params]]/page"];
  const files = manifest?.entryCSSFiles?.[ADMIN_PAGE_MODULE];
  if (!files) {
    throw new Error(
      `the build's client manifest names no stylesheets for ${ADMIN_PAGE_MODULE}`
    );
  }
  return readStylesheets(
    nextDir,
    files.map(({ path }) => path)
  );
}

/** Each breach of the screens' budgets, as a sentence; empty when all hold. */
export function breaches(measured, stylesheets) {
  return [
    ...measured.flatMap(screen => {
      const spec = SCREENS.find(s => s.name === screen.name) ?? {};
      return [
        ...(spec.editorFree ? editorFreeBreaches(screen) : []),
        ...onDemandBreaches(screen, spec.onDemand ?? []),
        ...(spec.fetchesEditorStylesheet
          ? stylesheetFetchBreaches(screen)
          : []),
      ];
    }),
    ...stylesheets
      .filter(sheet =>
        sheet.sources.some(source => EDITOR_STYLESHEET.test(source))
      )
      .map(
        sheet =>
          `every admin screen links the editor stylesheet (${sheet.path}) before it renders`
      ),
  ];
}

/** A screen that draws none of the builder's editor: within the budget. */
function editorFreeBreaches(screen) {
  const found = [];
  const kb = screen.groups["page builder"].gzippedBytes / 1024;
  if (kb > REGISTRATION_BUDGET_KB) {
    found.push(
      `${screen.name}: the page builder's code is ${kb.toFixed(1)} KB gzipped, over its budget of ${REGISTRATION_BUDGET_KB} KB`
    );
  }
  for (const group of [
    "builder editor",
    "block engine beyond its narrow entries",
    "CSS parser",
  ]) {
    const sources = screen.groups[group].sources;
    if (sources.length > 0) {
      found.push(
        `${screen.name}: holds the ${group} (${sources.length} modules, e.g. ${sources[0]})`
      );
    }
  }
  return found;
}

/** The parts a screen fetches on demand, found in its set before they open. */
function onDemandBreaches(screen, groups) {
  return groups
    .filter(group => screen.groups[group].sources.length > 0)
    .map(
      group =>
        `${screen.name}: holds the ${group} before it opens (${screen.groups[group].sources[0]})`
    );
}

/** A screen whose chunks cannot fetch the editor stylesheet it is drawn with. */
function stylesheetFetchBreaches(screen) {
  const fetches = screen.fetchableStylesheets.some(sheet =>
    sheet.sources.some(source => EDITOR_STYLESHEET.test(source))
  );
  return fetches
    ? []
    : [`${screen.name}: none of its chunks can fetch the editor stylesheet`];
}

/**
 * The breaches that fail the run: every one not known, and a sentence for each
 * known miss that no longer happens, so its line is removed and the gain kept.
 */
export function judge(found, known = KNOWN_MISSES) {
  const isKnown = line => known.some(miss => line.startsWith(miss.starts));
  return [
    ...found.filter(line => !isKnown(line)),
    ...known
      .filter(miss => !found.some(line => line.startsWith(miss.starts)))
      .map(
        miss =>
          `"${miss.starts}" no longer happens: remove it from KNOWN_MISSES`
      ),
  ];
}

/**
 * The stylesheets the named chunks can fetch on demand: each one a loader in
 * them names, as `"static/chunks/<file>.css"`, with the sources it maps to.
 */
export function fetchableStylesheets(output, names, sheets) {
  return sheets.filter(sheet =>
    [...names].some(name =>
      output.chunks.get(name)?.code.includes(`"${sheet.path}"`)
    )
  );
}

/** Every stylesheet the build holds, with the sources its source map names. */
export function readStylesheets(nextDir, paths) {
  return paths.map(path => {
    const code = readFileSync(join(nextDir, path), "utf8");
    const mapFile = /sourceMappingURL=(\S+?)\s*\*\//.exec(code)?.[1];
    if (!mapFile) throw new Error(`${path} has no source map to name it`);
    const map = JSON.parse(
      readFileSync(join(nextDir, dirname(path), mapFile), "utf8")
    );
    return {
      path,
      sources: (map.sources ?? []).map(source =>
        source.replace(/^turbopack:\/\/\/\[project\]\//, "")
      ),
    };
  });
}

function option(argv, name) {
  const at = argv.indexOf(name);
  if (at === -1) return undefined;
  const value = argv[at + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} needs a value`);
  }
  return value;
}

function main(argv) {
  const nextDir = resolve(
    option(argv, "--next") ?? join(ROOT, "apps/playground/.next")
  );
  if (!existsSync(join(nextDir, "static/chunks"))) {
    throw new Error(`${nextDir} holds no production build`);
  }
  const output = readBuild(nextDir);
  const allSheets = readStylesheets(
    nextDir,
    readdirSync(join(nextDir, "static/chunks"))
      .filter(name => name.endsWith(".css"))
      .map(name => `static/chunks/${name}`)
  );
  const measured = measureScreens({
    output,
    route: ADMIN_ROUTE,
    screens: SCREENS,
    groups: GROUPS,
  }).map(screen => ({
    ...screen,
    fetchableStylesheets: fetchableStylesheets(
      output,
      screen.chunks,
      allSheets
    ),
  }));
  const stylesheets = firstLoadStylesheets(nextDir);
  console.log(
    formatScreens(measured, {
      title: "Page builder code per admin screen (playground production build)",
    })
  );
  console.log(
    `Stylesheets every admin screen links: ${stylesheets
      .map(
        sheet => `${sheet.path} (${sheet.sources.join(", ") || "no source"})`
      )
      .join("; ")}`
  );
  const json = option(argv, "--json");
  if (json) {
    writeFileSync(json, JSON.stringify({ measured, stylesheets }, null, 2));
  }
  const found = breaches(measured, stylesheets);
  for (const miss of KNOWN_MISSES) {
    if (found.some(line => line.startsWith(miss.starts))) {
      console.log(`known miss: ${miss.starts} (${miss.why})`);
    }
  }
  const failing = judge(found);
  if (failing.length > 0) {
    console.error(`page-builder-bundle-report: ${failing.length} breach(es):`);
    for (const line of failing) console.error(`  ${line}`);
    return 1;
  }
  console.log(
    `page-builder-bundle-report: ok, the sign-in page and the dashboard carry the page builder's registration alone, and the dashboard with its card and header tools drawn no editor either (within ${REGISTRATION_BUDGET_KB} KB gzipped), with no editor stylesheet, and the builder fetches its site-code section, fonts panel and icon set when they open.`
  );
  return 0;
}

const invokedDirectly =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`page-builder-bundle-report: ${error.message}`);
    process.exitCode = 1;
  }
}
