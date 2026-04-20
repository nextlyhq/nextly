import fs from "fs";
import path from "path";

function getDirectorySize(dir, filter = null) {
  let total = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true, recursive: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        const fullPath = path.join(entry.parentPath || entry.path || dir, entry.name);
        if (!filter || fullPath.endsWith(filter)) {
          try {
            const stat = fs.statSync(fullPath);
            total += stat.size;
          } catch {}
        }
      }
    }
  } catch (err) {
    console.error(`Error reading ${dir}:`, err.message);
  }
  return total;
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) {
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  }
  return (bytes / 1024).toFixed(2) + " KB";
}

const packages = [
  // Full packages - actual implementations
  { name: "nextly", path: "packages/nextly/dist", expected: { min: 400, max: 900, unit: "KB" }, type: "full" },
  { name: "@nextly/admin", path: "packages/admin/dist", expected: { min: 200, max: 800, unit: "KB" }, type: "full" },
  // Scaffold packages - placeholders, will grow with implementation
  { name: "@nextly/client", path: "packages/client/dist", expected: { min: 0.5, max: 50, unit: "KB" }, type: "scaffold" },
  { name: "@nextly/ui", path: "packages/ui/dist", expected: { min: 0.5, max: 100, unit: "KB" }, type: "scaffold" },
  { name: "@nextly/adapter-postgres", path: "packages/adapter-postgres/dist", expected: { min: 0.5, max: 50, unit: "KB" }, type: "scaffold" },
  { name: "@nextly/adapter-mysql", path: "packages/adapter-mysql/dist", expected: { min: 0.5, max: 50, unit: "KB" }, type: "scaffold" },
  { name: "@nextly/adapter-sqlite", path: "packages/adapter-sqlite/dist", expected: { min: 0.5, max: 50, unit: "KB" }, type: "scaffold" },
];

console.log("=".repeat(80));
console.log("Bundle Size Check - Subtask 5.1.6");
console.log("=".repeat(80));
console.log("");

console.log("Package Bundle Sizes (Total includes source maps and type declarations):");
console.log("-".repeat(80));

let allPass = true;

for (const pkg of packages) {
  const total = getDirectorySize(pkg.path);
  const esm = getDirectorySize(pkg.path, ".mjs");
  const cjs = getDirectorySize(pkg.path, ".cjs");
  const dts = getDirectorySize(pkg.path, ".d.ts") + getDirectorySize(pkg.path, ".d.cts");
  const css = getDirectorySize(pkg.path, ".css");
  const maps = getDirectorySize(pkg.path, ".map");

  // Calculate actual bundle size (ESM only, no maps, no dts)
  const bundleSize = esm;
  const bundleSizeKB = bundleSize / 1024;

  // Check if within expected range
  const { min, max } = pkg.expected;
  const inRange = bundleSizeKB >= min && bundleSizeKB <= max;

  // Scaffolds are expected to be small, that's fine
  const isScaffold = pkg.type === "scaffold";
  const isWithinBounds = isScaffold ? bundleSizeKB < max : (bundleSizeKB >= min && bundleSizeKB <= max);

  const status = isWithinBounds ? "✅" : "⚠️";
  if (!isWithinBounds) allPass = false;

  const typeLabel = isScaffold ? "(scaffold)" : "(full)";
  console.log(`\n${status} ${pkg.name} ${typeLabel}:`);
  console.log(`   Total dist:     ${formatSize(total)}`);
  console.log(`   ESM bundle:     ${formatSize(esm)}`);
  console.log(`   CJS bundle:     ${formatSize(cjs)}`);
  console.log(`   Type defs:      ${formatSize(dts)}`);
  if (css > 0) console.log(`   CSS:            ${formatSize(css)}`);
  console.log(`   Source maps:    ${formatSize(maps)}`);
}

console.log("\n" + "=".repeat(80));
console.log("Summary:");
console.log("-".repeat(80));

// Get just ESM sizes for comparison
const sizes = packages.map(pkg => ({
  name: pkg.name,
  esm: getDirectorySize(pkg.path, ".mjs") / 1024
}));

console.log("\nESM Bundle Sizes (what users actually import):");
for (const { name, esm } of sizes) {
  console.log(`   ${name.padEnd(25)} ${esm.toFixed(2)} KB`);
}

console.log("\n" + "=".repeat(80));
console.log(`Overall: ${allPass ? "✅ PASS" : "⚠️ REVIEW NEEDED"}`);
console.log("=".repeat(80));
