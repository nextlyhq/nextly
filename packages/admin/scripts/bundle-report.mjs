#!/usr/bin/env node

/**
 * bundle-report.mjs — Measure what @nextlyhq/admin ships and what the first screen loads.
 *
 * Requirements (specs/admin-bundle/spec.md R-1):
 * - Names every shipped chunk with its minified and gzipped size.
 * - Distinguishes chunks that load before the first screen renders (the static
 *   pre-render graph of index.mjs) from those a route loads later (dynamic imports).
 * - Records the date and git commit it measured.
 * - Accounts for every chunk the build emits and derives classification from import graphs.
 *
 * Usage:
 *   node scripts/bundle-report.mjs
 *   node scripts/bundle-report.mjs --json
 *   node scripts/bundle-report.mjs --dist <dir>
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import ts from "typescript";

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
 * The relative specifier an import/export declaration names, or null.
 */
function declarationSpecifier(node) {
  if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) {
    return null;
  }
  if (!node.moduleSpecifier || !ts.isStringLiteralLike(node.moduleSpecifier)) {
    return null;
  }
  return node.moduleSpecifier.text;
}

/**
 * The relative specifier a dynamic `import("...")` call names, or null.
 */
function dynamicImportSpecifier(node) {
  if (
    !ts.isCallExpression(node) ||
    node.expression.kind !== ts.SyntaxKind.ImportKeyword
  ) {
    return null;
  }
  const [arg] = node.arguments;
  if (!arg || !ts.isStringLiteralLike(arg)) {
    return null;
  }
  return arg.text;
}

/**
 * Parse an emitted JS chunk to extract relative static and dynamic import specifiers.
 */
export function parseChunkImports(filePath, code) {
  const sourceFile = ts.createSourceFile(
    filePath,
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );

  const staticImports = [];
  const dynamicImports = [];

  function visit(node) {
    const declared = declarationSpecifier(node);
    if (declared !== null) {
      if (declared.startsWith(".")) staticImports.push(declared);
    } else {
      const dynamic = dynamicImportSpecifier(node);
      if (dynamic !== null && dynamic.startsWith(".")) {
        dynamicImports.push(dynamic);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
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
 * The category one chunk belongs to, by the report's definitions:
 * - cli: the CLI tools, not loaded by any browser.
 * - first-screen: in the entry's static pre-render closure.
 * - route-later: reachable from the entry, but only through dynamic imports.
 * - other-entry: reachable by neither edge — another entrypoint the build
 *   emits for a different consumer, not a lazy route.
 */
function categoryOf(rel, firstScreenSet, reachableSet) {
  if (rel.startsWith("cli.") || rel.includes("/cli.")) {
    return "cli";
  }
  if (firstScreenSet.has(rel)) {
    return "first-screen";
  }
  if (reachableSet.has(rel)) {
    return "route-later";
  }
  return "other-entry";
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

  const buckets = {
    "first-screen": [],
    "route-later": [],
    "other-entry": [],
    cli: [],
  };
  const chunks = [];

  for (const [rel, node] of graph.entries()) {
    const category = categoryOf(rel, firstScreenSet, reachableSet);
    buckets[category].push(node);
    chunks.push({
      file: rel,
      category,
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
  const cliTotal = sumBytes(buckets.cli);

  const browserChunks = [
    ...buckets["first-screen"],
    ...buckets["route-later"],
    ...buckets["other-entry"],
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
      cliTotal.count
  ) {
    throw new Error("Accounting error: total chunks count mismatch");
  }

  return {
    date,
    commit,
    builtAt: builtAtOf(files),
    distDir,
    entryChunk,
    chunks,
    categories: {
      firstScreen: { chunks: buckets["first-screen"], ...firstScreenTotal },
      routeLater: { chunks: buckets["route-later"], ...routeLaterTotal },
      otherEntry: { chunks: buckets["other-entry"], ...otherEntryTotal },
      cli: { chunks: buckets.cli, ...cliTotal },
    },
    totals: {
      firstScreen: firstScreenTotal,
      routeLater: routeLaterTotal,
      otherEntry: otherEntryTotal,
      browser: browserTotal,
      cli: cliTotal,
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

  if (result.categories.cli.count > 0) {
    pushChunkSection(lines, {
      heading: `⚙️  Non-browser chunks (${result.categories.cli.count} chunks — CLI tools):`,
      chunks: result.categories.cli.chunks,
      subtotalLabel: "Subtotal CLI:",
      total: result.totals.cli,
    });
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

function parseArgs(argv) {
  const flags = { json: false, dist: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") flags.json = true;
    else if (arg === "--dist" && i + 1 < argv.length) flags.dist = argv[++i];
  }
  return flags;
}

/**
 * The committer date of `commit` as a millisecond timestamp, or Infinity
 * when it cannot be read — the staleness warning then stays silent rather
 * than firing on a guess.
 */
function commitTimeMs(commit) {
  if (commit === "unversioned") return Infinity;
  try {
    const ms = Number(
      execFileSync("git", ["show", "-s", "--format=%ct", commit], {
        cwd: PACKAGE_ROOT,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"],
      }).trim()
    );
    return Number.isFinite(ms) ? ms * 1000 : Infinity;
  } catch {
    return Infinity;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    const flags = parseArgs(process.argv.slice(2));
    const distDir = flags.dist ? resolve(flags.dist) : resolve(PACKAGE_ROOT, "dist");
    const result = measureBundle({ distDir });
    // The report labels the bytes with the current revision; say so loudly
    // when the bytes predate it, so a stale dist cannot wear a fresh commit
    // unnoticed.
    const builtMs = Date.parse(result.builtAt);
    if (Number.isFinite(builtMs) && builtMs < commitTimeMs(result.commit)) {
      console.error(
        `bundle-report warning: the dist was built at ${result.builtAt}, before commit ${result.commit.slice(0, 12)} — the report's commit labels older bytes. Rebuild for a fresh attribution.`
      );
    }
    console.log(formatReport(result, { json: flags.json }));
    process.exit(0);
  } catch (err) {
    console.error(`bundle-report error: ${err.message}`);
    process.exit(1);
  }
}
