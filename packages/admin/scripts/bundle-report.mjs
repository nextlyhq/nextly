#!/usr/bin/env node

/**
 * bundle-report.mjs — Measure what @nextlyhq/admin ships and what the first screen loads.
 *
 * The contract, stated here because the code is where it lives:
 * - Names every shipped chunk with its on-disk (minified browser build; raw
 *   CLI) and gzipped size.
 * - Distinguishes chunks that load before the first screen renders (the static
 *   pre-render graph of index.mjs) from those a route loads later (dynamic
 *   imports), the other entrypoints the package publishes, and chunks nothing
 *   can load.
 * - Records the date, the git commit, and the dist's own build time.
 * - Accounts for every chunk the build emits and derives classification from
 *   import graphs, so a subtotal that reconciles is a subtotal that measured.
 *
 * Usage:
 *   node scripts/bundle-report.mjs
 *   node scripts/bundle-report.mjs --json
 *   node scripts/bundle-report.mjs --dist <dir>
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import {
  literalText,
  parseSource,
  walk,
} from "@nextlyhq/module-specifiers/parse-source";

import { exportTargets } from "./check-published-build.mjs";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Format byte count to kilobytes with 2 decimal places.
 */
export function formatKB(bytes) {
  return (bytes / 1024).toFixed(2);
}

/**
 * Find all JS files (.mjs, .cjs) recursively within a directory.
 */
export function findJsFiles(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findJsFiles(full));
    } else if (entry.name.endsWith(".mjs") || entry.name.endsWith(".cjs")) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Parse an emitted JS chunk to extract relative static and dynamic import specifiers.
 *
 * Static ones come from `import`/`export ... from` declarations, dynamic ones
 * from an `import("...")` of a literal. The shared walk is iterative: a
 * minified chunk is one deep expression chain, and a recursive visitor over it
 * can blow the call stack before the report renders. Specifiers are collected
 * in source document order.
 */
export function parseChunkImports(filePath, code) {
  const staticImports = [];
  const dynamicImports = [];

  walk(parseSource(code, filePath).program, node => {
    if (
      node.type === "ImportDeclaration" ||
      node.type === "ExportNamedDeclaration" ||
      node.type === "ExportAllDeclaration"
    ) {
      const declared = literalText(node.source);
      if (declared?.startsWith(".")) staticImports.push(declared);
    } else if (node.type === "ImportExpression") {
      const dynamic = literalText(node.source);
      if (dynamic?.startsWith(".")) dynamicImports.push(dynamic);
    }
  });

  return {
    staticImports: [...new Set(staticImports)],
    dynamicImports: [...new Set(dynamicImports)],
  };
}

/**
 * Build the module import graph of all emitted chunks in distDir.
 */
export function buildImportGraph(distDir, files = findJsFiles(distDir)) {
  const graph = new Map();

  for (const file of files) {
    const rel = relative(distDir, file).replace(/\\/g, "/");
    const buffer = readFileSync(file);
    const code = buffer.toString("utf8");
    const minifiedBytes = buffer.length;
    const gzippedBytes = gzipSync(buffer).length;

    const { staticImports, dynamicImports } = parseChunkImports(file, code);

    const fromDir = posix.dirname(rel);
    const resolveSpecifier = spec => posix.normalize(posix.join(fromDir, spec));

    graph.set(rel, {
      file,
      rel,
      minifiedBytes,
      gzippedBytes,
      staticImports: staticImports.map(resolveSpecifier),
      dynamicImports: dynamicImports.map(resolveSpecifier),
    });
  }

  return graph;
}

/**
 * Read the current git commit SHA, with fallback to environment variables.
 */
export function readCommit(cwd = PACKAGE_ROOT) {
  if (process.env.GIT_COMMIT) return process.env.GIT_COMMIT;
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unversioned";
  }
}

/**
 * The transitive closure of `entry` over the named edge kinds, throwing when
 * an edge names a chunk the graph does not hold — a dangling edge means the
 * emit and the graph disagree, and the classification would be fiction.
 */
function closureFrom(graph, entry, edgeKinds) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length > 0) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    const node = graph.get(current);
    if (!node) {
      throw new Error(`import edge resolves to unknown chunk: ${current}`);
    }
    for (const kind of edgeKinds) {
      for (const target of node[kind]) {
        if (!seen.has(target)) queue.push(target);
      }
    }
  }
  return seen;
}

/**
 * The static pre-render closure of the entry chunk: everything the first
 * screen loads before it renders.
 */
function firstScreenClosure(graph, entryChunk) {
  return closureFrom(graph, entryChunk, ["staticImports"]);
}

/**
 * Everything the entry chunk can reach at all, eagerly or lazily. Route-later
 * is the lazily reached part of this set — a chunk outside it is reached by
 * neither edge from the entry, and is some other entrypoint's business.
 */
function reachableClosure(graph, entryChunk) {
  return closureFrom(graph, entryChunk, ["staticImports", "dynamicImports"]);
}

/**
 * The browser entrypoints the package publishes, derived from the `exports`
 * map rather than re-typed here: `exportTargets` (the traversal
 * check-published-build.mjs already maintains) walks the manifest to any
 * depth of nested conditions, and every target that names an emitted chunk
 * keeps its `dist/` prefix stripped to a graph path. A new published
 * entrypoint — however its conditions nest — is then classified correctly
 * without editing a second list.
 */
export const DECLARED_BROWSER_ENTRIES = new Set(
  exportTargets(
    JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"))
      .exports ?? {}
  )
    .map(({ target }) => target)
    .filter(target => /\.(mjs|cjs)$/.test(target))
    .map(target => target.replace(/^\.?\/?dist\//, ""))
);

/**
 * Everything the package's OTHER declared entrypoints can reach, eagerly or
 * lazily. These chunks ship for a consumer of that entry, so when the main
 * entry's graph does not reach them they are still not orphans — only what
 * no declared entry reaches is.
 */
function otherEntryClosure(graph, entryChunk) {
  const reachable = new Set();
  for (const entry of DECLARED_BROWSER_ENTRIES) {
    if (entry === entryChunk || !graph.has(entry)) continue;
    for (const rel of closureFrom(graph, entry, [
      "staticImports",
      "dynamicImports",
    ])) {
      reachable.add(rel);
    }
  }
  return reachable;
}

/**
 * The category one chunk belongs to, by the report's definitions:
 * - cli: the CLI tools, not loaded by any browser.
 * - first-screen: in the entry's static pre-render closure.
 * - route-later: reachable from the entry, but only through dynamic imports.
 * - other-entry: outside the entry's graph, but reachable from another
 *   declared entrypoint — the build emits it for that consumer.
 * - unreachable: reachable from no declared entrypoint: an orphan the
 *   build retained that no consumer can load.
 */
function categoryOf(rel, firstScreenSet, reachableSet, otherEntrySet) {
  if (rel.startsWith("cli.") || rel.includes("/cli.")) {
    return "cli";
  }
  if (firstScreenSet.has(rel)) {
    return "first-screen";
  }
  if (reachableSet.has(rel)) {
    return "route-later";
  }
  if (otherEntrySet.has(rel)) {
    return "other-entry";
  }
  return "unreachable";
}

/**
 * The provenance the BUILD stamped into the dist, when it holds one: the
 * commit the build ran on and when it ran. A report without it can only
 * warn on time order; with it, a dist from a different commit than the one
 * the report labels is a fact, not a guess.
 */
function readBuildInfo(distDir) {
  const file = join(distDir, ".build-info.json");
  if (!existsSync(file)) return undefined;
  try {
    const info = JSON.parse(readFileSync(file, "utf8"));
    if (info && typeof info.commit === "string") {
      return {
        commit: info.commit,
        builtAt:
          typeof info.builtAt === "string" ? info.builtAt : undefined,
      };
    }
  } catch {
    // A stamp that does not parse is no stamp.
  }
  return undefined;
}

/**
 * The newest mtime among the measured files: when the bytes the dist holds
 * were built. A report's commit means nothing without it — a dist built
 * before the last commit would otherwise wear that commit's label.
 */
function builtAtOf(files) {
  let newest = 0;
  for (const file of files) {
    const mtime = statSync(file).mtimeMs;
    if (mtime > newest) newest = mtime;
  }
  return new Date(newest).toISOString();
}

/**
 * Measure and classify the bundle chunks in distDir.
 */
export function measureBundle({
  distDir = resolve(PACKAGE_ROOT, "dist"),
  entryChunk = "index.mjs",
  commit = readCommit(),
  date = new Date().toISOString(),
} = {}) {
  if (!existsSync(distDir)) {
    throw new Error(
      `dist directory not found at ${distDir} — run build before measuring`
    );
  }

  const files = findJsFiles(distDir);
  if (files.length === 0) {
    throw new Error(`no JS chunks found in ${distDir}`);
  }

  const graph = buildImportGraph(distDir, files);

  // The report claims to measure the entry's pre-render closure; an absent
  // entry would silently measure an empty first screen instead.
  if (!graph.has(entryChunk)) {
    throw new Error(
      `entry chunk ${entryChunk} not found in ${distDir} — is this dist the build you meant to measure?`
    );
  }

  const firstScreenSet = firstScreenClosure(graph, entryChunk);
  const reachableSet = reachableClosure(graph, entryChunk);
  const otherEntrySet = otherEntryClosure(graph, entryChunk);

  const buckets = {
    "first-screen": [],
    "route-later": [],
    "other-entry": [],
    unreachable: [],
    cli: [],
  };
  const chunks = [];

  for (const [rel, node] of graph.entries()) {
    const category = categoryOf(
      rel,
      firstScreenSet,
      reachableSet,
      otherEntrySet
    );
    buckets[category].push(node);
    chunks.push({
      file: rel,
      category,
      // The CLI build does not minify: its on-disk size is its raw size,
      // and labelling it minified would overstate what the report measures.
      minified: category !== "cli",
      minifiedBytes: node.minifiedBytes,
      gzippedBytes: node.gzippedBytes,
      staticImports: node.staticImports,
      dynamicImports: node.dynamicImports,
    });
  }

  // Sort chunks alphabetically within categories for deterministic output
  for (const list of Object.values(buckets)) {
    list.sort((a, b) => a.rel.localeCompare(b.rel));
  }
  chunks.sort((a, b) => a.file.localeCompare(b.file));

  const sumBytes = list => ({
    count: list.length,
    minifiedBytes: list.reduce((sum, c) => sum + c.minifiedBytes, 0),
    gzippedBytes: list.reduce((sum, c) => sum + c.gzippedBytes, 0),
  });

  const firstScreenTotal = sumBytes(buckets["first-screen"]);
  const routeLaterTotal = sumBytes(buckets["route-later"]);
  const otherEntryTotal = sumBytes(buckets["other-entry"]);
  const unreachableTotal = sumBytes(buckets.unreachable);
  const cliTotal = sumBytes(buckets.cli);

  // The shell is the first-screen bucket the shell budget reads: each
  // route's direct visit is that total plus what the route adds, so the two
  // can never disagree about which chunks the shell holds.
  const shellSet = new Set(buckets["first-screen"].map(node => node.rel));

  // What a DIRECT visit to each lazily loaded route must fetch before that
  // route renders: the route root's static closure, shared shell included.
  // The entry's eager graph alone understates that visit, which fetches the
  // route's closure too before it can show anything.
  //
  // Route roots are every dynamic-import target anywhere in the entry's
  // reachable graph, not just the entry chunk's own direct ones: the bundler
  // hoists shared registries into eager chunks, so a page the entry reaches
  // only through such a chunk would otherwise vanish from the route list.
  const routeRoots = [];
  for (const rel of reachableSet) {
    for (const target of graph.get(rel).dynamicImports) {
      if (graph.has(target) && !routeRoots.includes(target)) {
        routeRoots.push(target);
      }
    }
  }
  const routes = routeRoots
    .map(root => {
      const closure = closureFrom(graph, root, ["staticImports"]);
      const chunks = [...closure];
      const minifiedBytes = chunks.reduce(
        (sum, rel) => sum + graph.get(rel).minifiedBytes,
        0
      );
      const gzippedBytes = chunks.reduce(
        (sum, rel) => sum + graph.get(rel).gzippedBytes,
        0
      );
      const beyond = [...closure].filter(rel => !shellSet.has(rel));
      const beyondGzipped = beyond.reduce(
        (sum, rel) => sum + graph.get(rel).gzippedBytes,
        0
      );
      const beyondMinified = beyond.reduce(
        (sum, rel) => sum + graph.get(rel).minifiedBytes,
        0
      );
      return {
        root,
        chunks: chunks.length,
        minifiedBytes,
        gzippedBytes,
        beyondFirstScreen: beyond,
        // A direct visit downloads the shell once and then this route's own
        // remainder: the union of the entry's pre-render closure and the
        // route's closure. Shared chunks count once — the browser fetches
        // them once — so a route is judged by the union, not by a closure
        // that double-counts everything the shell already carried.
        directVisit: {
          minifiedBytes: firstScreenTotal.minifiedBytes + beyondMinified,
          gzippedBytes: firstScreenTotal.gzippedBytes + beyondGzipped,
        },
        // What this route adds to the shell: the part of its direct visit
        // that is its own, which the budgets hold each route to.
        beyondShell: {
          minifiedBytes: beyondMinified,
          gzippedBytes: beyondGzipped,
        },
      };
    })
    .sort((a, b) => b.minifiedBytes - a.minifiedBytes);

  const browserChunks = [
    ...buckets["first-screen"],
    ...buckets["route-later"],
    ...buckets["other-entry"],
    ...buckets.unreachable,
  ];
  const browserTotal = sumBytes(browserChunks);
  const totalEmitted = sumBytes(chunks);

  // Assert accounting invariant: every chunk lands in exactly one bucket,
  // so the categories always reassemble into the emitted total.
  if (
    chunks.length !==
    firstScreenTotal.count +
      routeLaterTotal.count +
      otherEntryTotal.count +
      unreachableTotal.count +
      cliTotal.count
  ) {
    throw new Error("Accounting error: total chunks count mismatch");
  }

  return {
    date,
    commit,
    builtAt: builtAtOf(files),
    buildInfo: readBuildInfo(distDir),
    distDir,
    entryChunk,
    chunks,
    routes,
    categories: {
      firstScreen: { chunks: buckets["first-screen"], ...firstScreenTotal },
      routeLater: { chunks: buckets["route-later"], ...routeLaterTotal },
      otherEntry: { chunks: buckets["other-entry"], ...otherEntryTotal },
      unreachable: { chunks: buckets.unreachable, ...unreachableTotal },
      cli: { chunks: buckets.cli, ...cliTotal, minified: false },
    },
    totals: {
      firstScreen: firstScreenTotal,
      routeLater: routeLaterTotal,
      otherEntry: otherEntryTotal,
      unreachable: unreachableTotal,
      browser: browserTotal,
      cli: { ...cliTotal, minified: false },
      totalEmitted,
    },
  };
}

/**
 * One report section: the heading, the chunk table, and its subtotal.
 */
function pushChunkSection(lines, { heading, chunks, subtotalLabel, total }) {
  lines.push("");
  lines.push(heading);
  lines.push("-".repeat(72));
  for (const chunk of chunks) {
    const min = `${formatKB(chunk.minifiedBytes)} KB`.padStart(11);
    const gz = `${formatKB(chunk.gzippedBytes)} KB gzip`.padStart(16);
    lines.push(`  ${chunk.rel.padEnd(42)} ${min}  (${gz})`);
  }
  lines.push("-".repeat(72));
  const min = `${formatKB(total.minifiedBytes)} KB`;
  const gz = `${formatKB(total.gzippedBytes)} KB`;
  lines.push(
    `  ${subtotalLabel}`.padEnd(44) +
      `${min.padStart(11)}  (${gz.padStart(11)} gzip)`
  );
}

/**
 * Format measurement results into a readable text report or JSON string.
 */
export function formatReport(result, { json = false } = {}) {
  if (json) {
    return JSON.stringify(result, null, 2);
  }

  const lines = [];
  lines.push("📊 Admin Bundle Size Report");
  lines.push("=".repeat(72));
  lines.push(`Date:    ${result.date}`);
  lines.push(`Commit:  ${result.commit}`);
  lines.push(`Built:   ${result.builtAt}`);
  if (result.stale) {
    lines.push("Stale:   YES — these bytes predate the commit above; rebuild.");
  }
  lines.push(`Entry:   ${result.entryChunk}`);
  lines.push("=".repeat(72));

  pushChunkSection(lines, {
    heading: `📦 First-screen chunks (${result.categories.firstScreen.count} chunks — pre-render static closure of ${result.entryChunk}):`,
    chunks: result.categories.firstScreen.chunks,
    subtotalLabel: "Subtotal First-Screen:",
    total: result.totals.firstScreen,
  });

  pushChunkSection(lines, {
    heading: `🔄 Route-later chunks (${result.categories.routeLater.count} chunks — on-demand / lazy routes):`,
    chunks: result.categories.routeLater.chunks,
    subtotalLabel: "Subtotal Route-Later:",
    total: result.totals.routeLater,
  });

  if (result.categories.otherEntry.count > 0) {
    pushChunkSection(lines, {
      heading: `🚪 Other entry chunks (${result.categories.otherEntry.count} chunks — entrypoints the build emits for other consumers, not lazy routes):`,
      chunks: result.categories.otherEntry.chunks,
      subtotalLabel: "Subtotal Other Entries:",
      total: result.totals.otherEntry,
    });
  }

  if (result.categories.unreachable.count > 0) {
    pushChunkSection(lines, {
      heading: `🗑️  Unreachable chunks (${result.categories.unreachable.count} chunks — retained by the build but imported by nothing; no consumer can load them):`,
      chunks: result.categories.unreachable.chunks,
      subtotalLabel: "Subtotal Unreachable:",
      total: result.totals.unreachable,
    });
  }

  if (result.categories.cli.count > 0) {
    pushChunkSection(lines, {
      heading: `⚙️  Non-browser chunks (${result.categories.cli.count} chunks — CLI tools, raw sizes: the CLI build does not minify):`,
      chunks: result.categories.cli.chunks,
      subtotalLabel: "Subtotal CLI:",
      total: result.totals.cli,
    });
  }

  if (result.routes.length > 0) {
    lines.push("");
    lines.push(
      `🛣️  Route first loads (${result.routes.length} lazy routes — what a DIRECT visit to each must fetch before it renders, shared shell included):`
    );
    lines.push("-".repeat(72));
    for (const route of result.routes) {
      // The direct visit, shell included, as the heading says and as the
      // budgets measure it; the route's own closure alone is smaller.
      const min = `${formatKB(route.directVisit.minifiedBytes)} KB`.padStart(11);
      const gz = `${formatKB(route.directVisit.gzippedBytes)} KB gzip`.padStart(16);
      const beyond = route.beyondFirstScreen.length;
      lines.push(
        `  ${route.root.padEnd(42)} ${min}  (${gz})` +
          `  +${beyond} beyond the shell`
      );
    }
    lines.push("-".repeat(72));
  }

  lines.push("");
  lines.push("=".repeat(72));
  lines.push("Summary Totals:");
  lines.push("-".repeat(72));
  const bMin = `${formatKB(result.totals.browser.minifiedBytes)} KB`;
  const bGz = `${formatKB(result.totals.browser.gzippedBytes)} KB`;
  lines.push(
    `  Shipped Browser JS (${result.totals.browser.count} chunks):`.padEnd(44) +
      `${bMin.padStart(11)}  (${bGz.padStart(11)} gzip)`
  );

  const totMin = `${formatKB(result.totals.totalEmitted.minifiedBytes)} KB`;
  const totGz = `${formatKB(result.totals.totalEmitted.gzippedBytes)} KB`;
  lines.push(
    `  Total Emitted JS (${result.totals.totalEmitted.count} chunks):`.padEnd(44) +
      `${totMin.padStart(11)}  (${totGz.padStart(11)} gzip)`
  );
  lines.push("=".repeat(72));

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CLI Execution
// ---------------------------------------------------------------------------

/**
 * Parses the CLI flags, refusing what the caller got wrong: an unrecognized
 * option or a trailing `--dist` without a value would otherwise be silently
 * ignored and the command would measure something other than what the
 * caller asked it to.
 */
export function parseArgs(argv) {
  const flags = { json: false, dist: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") {
      flags.json = true;
    } else if (arg === "--dist") {
      if (i + 1 >= argv.length) {
        throw new Error("--dist requires a directory argument");
      }
      flags.dist = argv[++i];
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  return flags;
}

/**
 * The committer date of `commit` as a millisecond timestamp, or -Infinity
 * when it cannot be read: no build time is before it, so the staleness
 * warning stays silent rather than firing on a guess.
 */
function commitTimeMs(commit) {
  if (commit === "unversioned") return -Infinity;
  try {
    const ms = Number(
      execFileSync("git", ["show", "-s", "--format=%ct", commit], {
        cwd: PACKAGE_ROOT,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"],
      }).trim()
    );
    return Number.isFinite(ms) ? ms * 1000 : -Infinity;
  } catch {
    return -Infinity;
  }
}

/**
 * Whether a measured dist predates the commit its report is labelled with:
 * built before that commit, or stamped by a build of a different commit. The
 * one answer the report's warning and the budget pins both use, so a stale
 * dist can neither wear a fresh label nor become a pin.
 */
export function distStaleness(result) {
  const builtMs = Date.parse(result.builtAt);
  const timeStale =
    Number.isFinite(builtMs) && builtMs < commitTimeMs(result.commit);
  // The build's own stamp is the stronger half: a dist from a different
  // commit is mismatched even when its build time is newer than the
  // labelled commit — an older checkout keeps a gitignored dist.
  const provenanceMismatch =
    result.buildInfo !== undefined &&
    result.buildInfo.commit !== "unversioned" &&
    result.buildInfo.commit !== result.commit;
  return { timeStale, provenanceMismatch, stale: timeStale || provenanceMismatch };
}

/**
 * Whether this module is the entry the command named. Compared on real
 * paths too: Node canonicalizes `import.meta.url` through a symlink while
 * `process.argv[1]` stays lexical, and a lexical-only compare would let the
 * command exit silently, having produced no report at all.
 */
function invokedAsScript() {
  if (!process.argv[1]) return false;
  const named = resolve(process.argv[1]);
  const self = resolve(fileURLToPath(import.meta.url));
  if (named === self) return true;
  try {
    return realpathSync(named) === realpathSync(self);
  } catch {
    return false;
  }
}

if (invokedAsScript()) {
  // Exit by exitCode rather than process.exit: exit() can cut off a pipe
  // before the queued report bytes are written, leaving a truncated JSON.
  process.exitCode = 1;
  try {
    const flags = parseArgs(process.argv.slice(2));
    const distDir = flags.dist ? resolve(flags.dist) : resolve(PACKAGE_ROOT, "dist");
    const result = measureBundle({ distDir });
    // The report labels the bytes with the current revision; say so loudly
    // when the bytes predate it, so a stale dist cannot wear a fresh commit
    // unnoticed — in the text, in the JSON, and on stderr where automation
    // looks.
    const { timeStale, provenanceMismatch, stale } = distStaleness(result);
    result.stale = stale;
    if (provenanceMismatch) {
      console.error(
        `bundle-report warning: the dist was built from commit ${(result.buildInfo.commit || "").slice(0, 12)}, not the ${result.commit.slice(0, 12)} this report labels. Rebuild for a fresh attribution.`
      );
    } else if (timeStale) {
      console.error(
        `bundle-report warning: the dist was built at ${result.builtAt}, before commit ${result.commit.slice(0, 12)} — the report's commit labels older bytes. Rebuild for a fresh attribution.`
      );
    }
    console.log(formatReport(result, { json: flags.json }));
    process.exitCode = 0;
  } catch (err) {
    console.error(`bundle-report error: ${err.message}`);
  }
}
