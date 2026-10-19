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
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
        const spec = node.moduleSpecifier.text;
        if (spec.startsWith(".")) staticImports.push(spec);
      }
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const [arg] = node.arguments;
      if (arg && ts.isStringLiteralLike(arg)) {
        const spec = arg.text;
        if (spec.startsWith(".")) dynamicImports.push(spec);
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

  // Compute transitive static closure of entryChunk (first-screen bundle)
  const firstScreenSet = new Set();
  if (graph.has(entryChunk)) {
    const queue = [entryChunk];
    while (queue.length > 0) {
      const current = queue.shift();
      if (firstScreenSet.has(current)) continue;
      firstScreenSet.add(current);
      const node = graph.get(current);
      if (node) {
        for (const target of node.staticImports) {
          if (!firstScreenSet.has(target)) queue.push(target);
        }
      }
    }
  }

  const chunks = [];
  const firstScreenChunks = [];
  const routeLaterChunks = [];
  const cliChunks = [];

  for (const [rel, node] of graph.entries()) {
    let category;
    if (rel.startsWith("cli.") || rel.includes("/cli.")) {
      category = "cli";
      cliChunks.push(node);
    } else if (firstScreenSet.has(rel)) {
      category = "first-screen";
      firstScreenChunks.push(node);
    } else {
      category = "route-later";
      routeLaterChunks.push(node);
    }

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
  firstScreenChunks.sort((a, b) => a.rel.localeCompare(b.rel));
  routeLaterChunks.sort((a, b) => a.rel.localeCompare(b.rel));
  cliChunks.sort((a, b) => a.rel.localeCompare(b.rel));
  chunks.sort((a, b) => a.file.localeCompare(b.file));

  const sumBytes = list => ({
    count: list.length,
    minifiedBytes: list.reduce((sum, c) => sum + c.minifiedBytes, 0),
    gzippedBytes: list.reduce((sum, c) => sum + c.gzippedBytes, 0),
  });

  const firstScreenTotal = sumBytes(firstScreenChunks);
  const routeLaterTotal = sumBytes(routeLaterChunks);
  const cliTotal = sumBytes(cliChunks);

  const browserChunks = [...firstScreenChunks, ...routeLaterChunks];
  const browserTotal = sumBytes(browserChunks);
  const totalEmitted = sumBytes(chunks);

  // Assert accounting invariant: total == firstScreen + routeLater + cli
  if (
    chunks.length !==
    firstScreenChunks.length + routeLaterChunks.length + cliChunks.length
  ) {
    throw new Error("Accounting error: total chunks count mismatch");
  }

  return {
    date,
    commit,
    distDir,
    entryChunk,
    chunks,
    categories: {
      firstScreen: { chunks: firstScreenChunks, ...firstScreenTotal },
      routeLater: { chunks: routeLaterChunks, ...routeLaterTotal },
      cli: { chunks: cliChunks, ...cliTotal },
    },
    totals: {
      firstScreen: firstScreenTotal,
      routeLater: routeLaterTotal,
      browser: browserTotal,
      cli: cliTotal,
      totalEmitted,
    },
  };
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
  lines.push(`Entry:   ${result.entryChunk}`);
  lines.push("=".repeat(72));

  lines.push("");
  lines.push(
    `📦 First-screen chunks (${result.categories.firstScreen.count} chunks — pre-render static closure of ${result.entryChunk}):`
  );
  lines.push("-".repeat(72));
  for (const chunk of result.categories.firstScreen.chunks) {
    const min = `${formatKB(chunk.minifiedBytes)} KB`.padStart(11);
    const gz = `${formatKB(chunk.gzippedBytes)} KB gzip`.padStart(16);
    lines.push(`  ${chunk.rel.padEnd(42)} ${min}  (${gz})`);
  }
  lines.push("-".repeat(72));
  const fsMin = `${formatKB(result.totals.firstScreen.minifiedBytes)} KB`;
  const fsGz = `${formatKB(result.totals.firstScreen.gzippedBytes)} KB`;
  lines.push(
    `  Subtotal First-Screen:`.padEnd(44) +
      `${fsMin.padStart(11)}  (${fsGz.padStart(11)} gzip)`
  );

  lines.push("");
  lines.push(
    `🔄 Route-later chunks (${result.categories.routeLater.count} chunks — on-demand / lazy routes):`
  );
  lines.push("-".repeat(72));
  for (const chunk of result.categories.routeLater.chunks) {
    const min = `${formatKB(chunk.minifiedBytes)} KB`.padStart(11);
    const gz = `${formatKB(chunk.gzippedBytes)} KB gzip`.padStart(16);
    lines.push(`  ${chunk.rel.padEnd(42)} ${min}  (${gz})`);
  }
  lines.push("-".repeat(72));
  const rlMin = `${formatKB(result.totals.routeLater.minifiedBytes)} KB`;
  const rlGz = `${formatKB(result.totals.routeLater.gzippedBytes)} KB`;
  lines.push(
    `  Subtotal Route-Later:`.padEnd(44) +
      `${rlMin.padStart(11)}  (${rlGz.padStart(11)} gzip)`
  );

  if (result.categories.cli.count > 0) {
    lines.push("");
    lines.push(
      `⚙️  Non-browser chunks (${result.categories.cli.count} chunks — CLI tools):`
    );
    lines.push("-".repeat(72));
    for (const chunk of result.categories.cli.chunks) {
      const min = `${formatKB(chunk.minifiedBytes)} KB`.padStart(11);
      const gz = `${formatKB(chunk.gzippedBytes)} KB gzip`.padStart(16);
      lines.push(`  ${chunk.rel.padEnd(42)} ${min}  (${gz})`);
    }
    lines.push("-".repeat(72));
    const cliMin = `${formatKB(result.totals.cli.minifiedBytes)} KB`;
    const cliGz = `${formatKB(result.totals.cli.gzippedBytes)} KB`;
    lines.push(
      `  Subtotal CLI:`.padEnd(44) +
        `${cliMin.padStart(11)}  (${cliGz.padStart(11)} gzip)`
    );
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

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    const flags = parseArgs(process.argv.slice(2));
    const distDir = flags.dist ? resolve(flags.dist) : resolve(PACKAGE_ROOT, "dist");
    const result = measureBundle({ distDir });
    console.log(formatReport(result, { json: flags.json }));
    process.exit(0);
  } catch (err) {
    console.error(`bundle-report error: ${err.message}`);
    process.exit(1);
  }
}
