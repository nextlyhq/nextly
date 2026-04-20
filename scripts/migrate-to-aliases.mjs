#!/usr/bin/env node

/**
 * Path Alias Migration Script
 *
 * This script converts deep relative imports (../../) to path aliases.
 *
 * Usage:
 *   node scripts/migrate-to-aliases.mjs           # Run migration
 *   node scripts/migrate-to-aliases.mjs --dry-run # Preview changes without modifying files
 *   OR
 *   pnpm migrate:aliases
 *   pnpm migrate:aliases --dry-run
 *
 * What it does:
 * - Scans TypeScript/TSX files in packages/nextly/src and packages/admin/src
 * - Finds imports with 2+ levels of ../ (e.g., ../../components/Button)
 * - Converts them to path aliases:
 *   - Core (nextly): ../../services/auth → @nextly/services/auth
 *   - Admin: ../../../components/Button → @admin/components/Button
 * - Reports number of files and replacements made
 *
 * Rules:
 * - Only converts imports with 2+ levels of ../
 * - Preserves single-level relative imports (./utils, ../sibling)
 * - Only converts to known top-level directories in src/
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { glob } from "glob";
import path from "path";

// Parse command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run") || args.includes("-n");

// Known top-level directories for each package
// Only imports targeting these directories will be converted
const CORE_DIRECTORIES = [
  "actions",
  "api",
  "database",
  "lib",
  "schemas",
  "scripts",
  "services",
  "types",
];

const ADMIN_DIRECTORIES = [
  "components",
  "constants",
  "context",
  "hooks",
  "layout",
  "lib",
  "pages",
  "schemas",
  "services",
  "styles",
  "types",
  "utils",
];

/**
 * Count the number of ../ segments at the start of a path
 */
function countParentRefs(importPath) {
  let count = 0;
  let remaining = importPath;

  while (remaining.startsWith("../")) {
    count++;
    remaining = remaining.slice(3);
  }

  return { count, remaining };
}

/**
 * Extract the target directory from the remaining path after ../
 * e.g., "components/Button" → "components"
 */
function getTargetDirectory(remainingPath) {
  const parts = remainingPath.split("/");
  return parts[0];
}

/**
 * Process a single file for path alias migration
 */
function processFile(filePath, aliasPrefix, knownDirectories) {
  let content = readFileSync(filePath, "utf-8");
  let changed = false;
  let replacements = 0;
  const changes = [];

  // Match import/export statements with relative paths
  // Patterns: from '../../...', from "../../...", import('../../...')
  const importRegex = /(?:from\s+|import\s*\()(['"])(\.\.\/.+?)\1/g;

  content = content.replace(importRegex, (match, quote, importPath) => {
    const { count, remaining } = countParentRefs(importPath);

    // Only convert if 2+ levels of ../
    if (count < 2) {
      return match;
    }

    // Get the target directory
    const targetDir = getTargetDirectory(remaining);

    // Only convert if targeting a known directory
    if (!knownDirectories.includes(targetDir)) {
      return match;
    }

    // Build the new alias path
    const newPath = `${aliasPrefix}/${remaining}`;
    const newMatch = match.replace(importPath, newPath);

    changes.push({
      from: importPath,
      to: newPath,
    });

    changed = true;
    replacements++;
    return newMatch;
  });

  return { content, changed, replacements, changes };
}

/**
 * Process the core package (packages/nextly)
 */
async function migrateCore() {
  console.log("\n📦 Processing Core Package (nextly)...\n");

  const files = await glob("packages/nextly/src/**/*.ts", {
    ignore: ["**/node_modules/**", "**/dist/**"],
    cwd: process.cwd(),
  });

  let totalFiles = 0;
  let totalReplacements = 0;
  const changedFiles = [];

  for (const file of files) {
    const filePath = path.join(process.cwd(), file);
    const { content, changed, replacements, changes } = processFile(
      filePath,
      "@nextly",
      CORE_DIRECTORIES
    );

    if (changed) {
      if (!DRY_RUN) {
        writeFileSync(filePath, content, "utf-8");
      }
      totalFiles++;
      totalReplacements += replacements;
      changedFiles.push({ file, replacements, changes });

      const prefix = DRY_RUN ? "Would update" : "✓ Updated";
      console.log(`${prefix} ${file} (${replacements} replacements)`);

      if (DRY_RUN) {
        for (const change of changes) {
          console.log(`    ${change.from} → ${change.to}`);
        }
      }
    }
  }

  console.log(`\nCore: ${totalFiles} files ${DRY_RUN ? "would be" : ""} updated (${totalReplacements} replacements)`);
  return { totalFiles, totalReplacements, changedFiles };
}

/**
 * Process the admin package (packages/admin)
 */
async function migrateAdmin() {
  console.log("\n📦 Processing Admin Package (@nextly/admin)...\n");

  const files = await glob("packages/admin/src/**/*.{ts,tsx}", {
    ignore: ["**/node_modules/**", "**/dist/**"],
    cwd: process.cwd(),
  });

  let totalFiles = 0;
  let totalReplacements = 0;
  const changedFiles = [];

  for (const file of files) {
    const filePath = path.join(process.cwd(), file);
    const { content, changed, replacements, changes } = processFile(
      filePath,
      "@admin",
      ADMIN_DIRECTORIES
    );

    if (changed) {
      if (!DRY_RUN) {
        writeFileSync(filePath, content, "utf-8");
      }
      totalFiles++;
      totalReplacements += replacements;
      changedFiles.push({ file, replacements, changes });

      const prefix = DRY_RUN ? "Would update" : "✓ Updated";
      console.log(`${prefix} ${file} (${replacements} replacements)`);

      if (DRY_RUN) {
        for (const change of changes) {
          console.log(`    ${change.from} → ${change.to}`);
        }
      }
    }
  }

  console.log(`\nAdmin: ${totalFiles} files ${DRY_RUN ? "would be" : ""} updated (${totalReplacements} replacements)`);
  return { totalFiles, totalReplacements, changedFiles };
}

/**
 * Main entry point
 */
async function main() {
  console.log("=".repeat(60));
  console.log("🔄 Path Alias Migration Script");
  console.log("=".repeat(60));

  if (DRY_RUN) {
    console.log("\n⚠️  DRY RUN MODE - No files will be modified\n");
  }

  // Verify we're in the right directory
  if (!existsSync("packages/nextly") || !existsSync("packages/admin")) {
    console.error("❌ Error: Must run from monorepo root (packages/nextly and packages/admin not found)");
    process.exit(1);
  }

  const coreResult = await migrateCore();
  const adminResult = await migrateAdmin();

  // Print summary
  console.log("\n" + "=".repeat(60));
  if (DRY_RUN) {
    console.log("📋 DRY RUN SUMMARY - No files were modified");
  } else {
    console.log("✅ Migration Complete!");
  }
  console.log("=".repeat(60));

  const totalFiles = coreResult.totalFiles + adminResult.totalFiles;
  const totalReplacements = coreResult.totalReplacements + adminResult.totalReplacements;

  console.log(`   Files ${DRY_RUN ? "to update" : "updated"}: ${totalFiles}`);
  console.log(`   Total replacements: ${totalReplacements}`);
  console.log(`   - Core (nextly): ${coreResult.totalFiles} files, ${coreResult.totalReplacements} replacements`);
  console.log(`   - Admin: ${adminResult.totalFiles} files, ${adminResult.totalReplacements} replacements`);

  if (DRY_RUN && totalFiles > 0) {
    console.log("\n💡 To apply changes, run without --dry-run:");
    console.log("   pnpm migrate:aliases");
  }

  if (!DRY_RUN && totalFiles > 0) {
    console.log("\n🔎 Verification:");
    console.log('   Run: pnpm build && pnpm check-types');
    console.log("   Expected: Build and type-check should pass\n");
  }

  if (totalFiles === 0) {
    console.log("\n💡 No deep relative imports found - codebase may already be using aliases!");
  }
}

// Run migration
main().catch((error) => {
  console.error("❌ Migration failed:", error);
  process.exit(1);
});
