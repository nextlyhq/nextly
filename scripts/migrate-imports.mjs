#!/usr/bin/env node

/**
 * Import Migration Script
 *
 * This script automatically updates package imports across the codebase
 * from old naming conventions to the new @nextly/* naming scheme.
 *
 * Usage:
 *   node scripts/migrate-imports.mjs
 *   OR
 *   pnpm migrate:imports
 *
 * What it does:
 * - Scans all TypeScript/JavaScript files in packages/ and apps/
 * - Finds import/require statements with old package names
 * - Replaces them with new package names
 * - Reports number of files and replacements made
 */

import { readFileSync, writeFileSync } from "node:fs";
import { glob } from "glob";

// Define package name mappings (old → new)
const RENAMES = {
  "@repo/db": "nextly",
  "@repo/ui": "@nextly/ui",
  "@repo/adminapp": "@nextly/admin",
  "@repo/admin": "@nextly/admin",
  "@repo/typescript-config": "@nextly/tsconfig",
  "@repo/tsconfig": "@nextly/tsconfig",
  "@repo/eslint-config": "@nextly/eslint-config",
  "@repo/prettier-config": "@nextly/prettier-config",
};

/**
 * Main migration function
 */
async function migrateImports() {
  console.log("🔍 Searching for files to migrate...\n");

  // Find all TypeScript/JavaScript files
  const files = await glob("**/*.{ts,tsx,js,jsx,mjs,cjs}", {
    ignore: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/build/**",
      "**/.cache/**",
    ],
    cwd: process.cwd(),
    absolute: true,
  });

  console.log(`📁 Found ${files.length} files to scan\n`);

  let totalFiles = 0;
  let totalReplacements = 0;
  const changedFiles = [];

  for (const file of files) {
    let content = readFileSync(file, "utf-8");
    let changed = false;
    let fileReplacements = 0;

    // Replace all old imports with new ones
    for (const [oldName, newName] of Object.entries(RENAMES)) {
      // Escape special characters for regex
      const escapedOld = oldName.replace(/\//g, "\\/");

      // Match: import ... from 'package' or "package"
      const importRegex = new RegExp(
        `from ['"]${escapedOld}['"]`,
        "g"
      );
      const importMatches = (content.match(importRegex) || []).length;
      if (importMatches > 0) {
        content = content.replace(importRegex, `from '${newName}'`);
        changed = true;
        fileReplacements += importMatches;
      }

      // Match: import('package')
      const dynamicImportRegex = new RegExp(
        `import\\(['"]${escapedOld}['"]\\)`,
        "g"
      );
      const dynamicMatches = (content.match(dynamicImportRegex) || []).length;
      if (dynamicMatches > 0) {
        content = content.replace(dynamicImportRegex, `import('${newName}')`);
        changed = true;
        fileReplacements += dynamicMatches;
      }

      // Match: require('package')
      const requireRegex = new RegExp(
        `require\\(['"]${escapedOld}['"]\\)`,
        "g"
      );
      const requireMatches = (content.match(requireRegex) || []).length;
      if (requireMatches > 0) {
        content = content.replace(requireRegex, `require('${newName}')`);
        changed = true;
        fileReplacements += requireMatches;
      }
    }

    if (changed) {
      writeFileSync(file, content, "utf-8");
      totalFiles++;
      totalReplacements += fileReplacements;
      changedFiles.push({ file, replacements: fileReplacements });
      console.log(`✓ Updated ${file.replace(process.cwd(), ".")} (${fileReplacements} replacements)`);
    }
  }

  // Print summary
  console.log("\n" + "=".repeat(60));
  console.log("✅ Migration complete!");
  console.log("=".repeat(60));
  console.log(`   Files scanned: ${files.length}`);
  console.log(`   Files updated: ${totalFiles}`);
  console.log(`   Total replacements: ${totalReplacements}`);

  if (totalFiles === 0) {
    console.log("\n💡 No files needed updates - codebase is already using the new package names!");
  } else {
    console.log("\n📝 Changed files:");
    for (const { file, replacements } of changedFiles) {
      console.log(`   - ${file.replace(process.cwd(), ".")} (${replacements})`);
    }
  }

  console.log("\n🔎 Verification:");
  console.log('   Run: grep -r "@repo/" packages/ apps/ | grep -v node_modules');
  console.log("   Expected: No results (all imports migrated)\n");
}

// Run migration
migrateImports().catch((error) => {
  console.error("❌ Migration failed:", error);
  process.exit(1);
});
