/**
 * verify-exports.ts
 *
 * Snapshots all named exports from the @revnixhq/nextly package and verifies
 * none disappear during refactoring.
 *
 * Usage:
 *   npx tsx scripts/verify-exports.ts          # snapshot or verify
 *   npx tsx scripts/verify-exports.ts --update  # force-update the snapshot
 *
 * On first run (no snapshot file): creates the baseline snapshot.
 * On subsequent runs: compares current exports against the snapshot and exits
 * with code 1 if any exports are missing.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = resolve(__dirname, "..");
const packageJsonPath = resolve(packageRoot, "package.json");
const snapshotPath = resolve(
  packageRoot,
  "../../plans/refactoring/baselines/plan-23-export-snapshot.json"
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ExportSnapshot = Record<string, string[]>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readPackageExports(): Record<
  string,
  { types?: string; import?: string }
> {
  const raw = readFileSync(packageJsonPath, "utf-8");
  const pkg = JSON.parse(raw);
  if (!pkg.exports || typeof pkg.exports !== "object") {
    console.error("ERROR: No 'exports' field found in package.json");
    process.exit(1);
  }
  return pkg.exports;
}

async function collectExports(
  entryPoints: Record<string, { types?: string; import?: string }>
): Promise<ExportSnapshot> {
  const snapshot: ExportSnapshot = {};

  for (const [entryName, paths] of Object.entries(entryPoints)) {
    const importPath = paths.import;
    if (!importPath) {
      console.warn(
        `  WARN: entry "${entryName}" has no "import" path, skipping`
      );
      continue;
    }

    const absolutePath = resolve(packageRoot, importPath);

    if (!existsSync(absolutePath)) {
      console.warn(
        `  WARN: dist file not found for "${entryName}" (${absolutePath}), skipping`
      );
      continue;
    }

    try {
      const moduleUrl = pathToFileURL(absolutePath).href;
      const mod = await import(moduleUrl);
      const exportNames = Object.keys(mod)
        .filter(key => key !== "default")
        .sort();

      // Also include "default" if the module has one, so we track it
      if ("default" in mod) {
        exportNames.unshift("default");
      }

      snapshot[entryName] = exportNames;
      console.log(`  OK: "${entryName}" — ${exportNames.length} export(s)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `  WARN: failed to import "${entryName}" (${absolutePath}): ${message}`
      );
    }
  }

  return snapshot;
}

function compareSnapshots(
  baseline: ExportSnapshot,
  current: ExportSnapshot
): {
  missing: Record<string, string[]>;
  added: Record<string, string[]>;
  removedEntryPoints: string[];
} {
  const missing: Record<string, string[]> = {};
  const added: Record<string, string[]> = {};
  const removedEntryPoints: string[] = [];

  // Check every baseline entry point
  for (const [entryName, baselineExports] of Object.entries(baseline)) {
    if (!(entryName in current)) {
      removedEntryPoints.push(entryName);
      continue;
    }

    const currentExports = new Set(current[entryName]);
    const missingExports = baselineExports.filter(e => !currentExports.has(e));
    if (missingExports.length > 0) {
      missing[entryName] = missingExports;
    }
  }

  // Check for new exports (informational, not a failure)
  for (const [entryName, currentExports] of Object.entries(current)) {
    if (!(entryName in baseline)) {
      added[entryName] = currentExports;
      continue;
    }

    const baselineSet = new Set(baseline[entryName]);
    const addedExports = currentExports.filter(e => !baselineSet.has(e));
    if (addedExports.length > 0) {
      added[entryName] = addedExports;
    }
  }

  return { missing, added, removedEntryPoints };
}

function printDiff(diff: {
  missing: Record<string, string[]>;
  added: Record<string, string[]>;
  removedEntryPoints: string[];
}): void {
  if (diff.removedEntryPoints.length > 0) {
    console.error("\n--- REMOVED ENTRY POINTS ---");
    for (const ep of diff.removedEntryPoints) {
      console.error(`  - ${ep}`);
    }
  }

  if (Object.keys(diff.missing).length > 0) {
    console.error("\n--- MISSING EXPORTS ---");
    for (const [entryName, exports] of Object.entries(diff.missing)) {
      console.error(`  ${entryName}:`);
      for (const exp of exports) {
        console.error(`    - ${exp}`);
      }
    }
  }

  if (Object.keys(diff.added).length > 0) {
    console.log("\n--- NEW EXPORTS (informational) ---");
    for (const [entryName, exports] of Object.entries(diff.added)) {
      console.log(`  ${entryName}:`);
      for (const exp of exports) {
        console.log(`    + ${exp}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const forceUpdate = process.argv.includes("--update");

  console.log("verify-exports: Reading package.json exports...\n");
  const entryPoints = readPackageExports();
  const entryPointCount = Object.keys(entryPoints).length;
  console.log(
    `Found ${entryPointCount} entry point(s) in package.json exports.\n`
  );

  console.log("Importing entry points from dist/...\n");
  const current = await collectExports(entryPoints);
  const importedCount = Object.keys(current).length;

  if (importedCount === 0) {
    console.error(
      "\nERROR: Could not import any entry points. Is the package built? Run 'pnpm build' first."
    );
    process.exit(1);
  }

  console.log(
    `\nSuccessfully imported ${importedCount}/${entryPointCount} entry point(s).`
  );

  // First run or forced update: save snapshot
  if (!existsSync(snapshotPath) || forceUpdate) {
    const snapshotDir = dirname(snapshotPath);
    if (!existsSync(snapshotDir)) {
      mkdirSync(snapshotDir, { recursive: true });
    }

    writeFileSync(
      snapshotPath,
      JSON.stringify(current, null, 2) + "\n",
      "utf-8"
    );
    const action = forceUpdate ? "Updated" : "Created";
    console.log(`\n${action} export snapshot at:\n  ${snapshotPath}`);
    console.log("\nDone. Future runs will compare against this snapshot.");
    return;
  }

  // Subsequent runs: compare
  console.log("\nComparing against saved snapshot...\n");

  let baseline: ExportSnapshot;
  try {
    baseline = JSON.parse(readFileSync(snapshotPath, "utf-8"));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`ERROR: Failed to read snapshot file: ${message}`);
    process.exit(1);
  }

  const diff = compareSnapshots(baseline, current);
  const hasMissing =
    Object.keys(diff.missing).length > 0 || diff.removedEntryPoints.length > 0;

  if (hasMissing) {
    console.error(
      "FAIL: Exports have been removed since the baseline snapshot."
    );
    printDiff(diff);
    console.error(
      "\nIf these removals are intentional, run with --update to refresh the snapshot:"
    );
    console.error("  npx tsx scripts/verify-exports.ts --update\n");
    process.exit(1);
  }

  // Print informational additions
  if (Object.keys(diff.added).length > 0) {
    printDiff(diff);
  }

  console.log("PASS: All baseline exports are still present.");
}

main().catch(err => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
