import { existsSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";

import { seedPermissions, type SeederResult } from "./permissions";
import { seedSuperAdmin } from "./super-admin";

/**
 * Type for adapters that support getDrizzle() method
 */
type AdapterWithDrizzle = {
  getDrizzle(): unknown;
  dialect: string;
};

export type { SeederResult };
export { seedPermissions, seedSuperAdmin };

/**
 * Combined seeder that runs all available seeders
 *
 * @param adapter - Database adapter instance
 * @param options - Optional configuration
 * @returns Promise<SeederResult> - Combined results from all seeders
 */
export async function seedAll(
  adapter: DrizzleAdapter | AdapterWithDrizzle,
  options?: {
    silent?: boolean;
    /** Super admin email (default: admin@example.com) */
    superAdminEmail?: string;
    /** Super admin password (default: Admin@123456) */
    superAdminPassword?: string;
    /** Super admin name (default: Super Admin) */
    superAdminName?: string;
    /** Skip super admin seeding (default: false) */
    skipSuperAdmin?: boolean;
  }
): Promise<SeederResult> {
  const {
    silent = false,
    superAdminEmail,
    superAdminPassword,
    superAdminName,
    skipSuperAdmin = false,
  } = options || {};

  const log = silent ? () => {} : console.log;
  const errorLog = silent ? () => {} : console.error;

  log("\nRunning all seeders...\n");

  let totalCreated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  const allErrorMessages: string[] = [];

  // Step 1: Seed permissions
  const permissionsResult = await seedPermissions(adapter, { silent });
  totalCreated += permissionsResult.created;
  totalSkipped += permissionsResult.skipped;
  totalErrors += permissionsResult.errors;
  if (permissionsResult.errorMessages) {
    allErrorMessages.push(...permissionsResult.errorMessages);
  }

  // Step 2: Seed super admin (only if permissions succeeded and not skipped)
  if (!skipSuperAdmin) {
    if (permissionsResult.success) {
      const superAdminResult = await seedSuperAdmin(adapter, {
        email: superAdminEmail,
        password: superAdminPassword,
        name: superAdminName,
        silent,
      });
      totalCreated += superAdminResult.created;
      totalSkipped += superAdminResult.skipped;
      totalErrors += superAdminResult.errors;
      if (superAdminResult.errorMessages) {
        allErrorMessages.push(...superAdminResult.errorMessages);
      }
    } else {
      errorLog(
        "\nSkipping super admin seeding due to permission seeding failures.\n"
      );
    }
  } else {
    log("\n⏭Super admin seeding skipped (skipSuperAdmin: true)\n");
  }

  // Step 3: Run user seed file (nextly.seed.ts) if present
  try {
    await runUserSeedFile(log, errorLog);
  } catch (error) {
    totalErrors += 1;
    const msg = error instanceof Error ? error.message : String(error);
    allErrorMessages.push(`User seed: ${msg}`);
    errorLog(`\nUser seed file failed: ${msg}\n`);
  }

  // Combine results
  const combinedResult: SeederResult = {
    success: totalErrors === 0,
    created: totalCreated,
    skipped: totalSkipped,
    errors: totalErrors,
    total: totalCreated + totalSkipped + totalErrors,
    errorMessages: allErrorMessages.length > 0 ? allErrorMessages : undefined,
  };

  if (combinedResult.success) {
    log("\nAll seeders completed successfully!\n");
  } else {
    errorLog("\nSome seeders failed. Please check the errors above.\n");
  }

  return combinedResult;
}

/**
 * Discover and run a user-provided seed file (nextly.seed.ts or nextly.seed.js).
 *
 * The seed file must export a default function (sync or async).
 * It is discovered from process.cwd().
 *
 * TypeScript files are transpiled on-the-fly via esbuild before execution.
 */
async function runUserSeedFile(
  log: (...args: unknown[]) => void,
  errorLog: (...args: unknown[]) => void
): Promise<void> {
  const cwd = process.cwd();
  const candidates = ["nextly.seed.ts", "nextly.seed.js", "nextly.seed.mjs"];

  let seedPath: string | undefined;
  for (const name of candidates) {
    const p = join(cwd, name);
    if (existsSync(p)) {
      seedPath = p;
      break;
    }
  }

  if (!seedPath) return; // No user seed file — nothing to do

  log("\nRunning user seed file...");

  let importPath = seedPath;

  // TypeScript files need transpilation before import
  if (seedPath.endsWith(".ts")) {
    try {
      const { readFileSync, writeFileSync, unlinkSync } = await import("fs");
      const { createRequire } = await import("module");
      // Resolve esbuild from @revnixhq/nextly's node_modules (not the project root)
      const req = createRequire(import.meta.url);
      const esbuild = req("esbuild") as typeof import("esbuild");
      const source = readFileSync(seedPath, "utf-8");
      const result = await esbuild.transform(source, {
        loader: "ts",
        format: "esm",
        target: "node18",
      });
      // Write transpiled JS next to the TS file (cleaned up after)
      importPath = seedPath.replace(/\.ts$/, ".seed-compiled.mjs");
      writeFileSync(importPath, result.code, "utf-8");

      try {
        const mod = await import(pathToFileURL(importPath).href);
        const seedFn = mod.default ?? mod.seed;
        if (typeof seedFn === "function") {
          await seedFn();
          log("User seed file completed.\n");
        } else {
          errorLog(
            `User seed file found at ${seedPath} but does not export a default function.\n`
          );
        }
      } finally {
        // Clean up compiled file
        try {
          unlinkSync(importPath);
        } catch {}
      }
    } catch (error) {
      errorLog(`Failed to transpile/run user seed file: ${seedPath}`);
      throw error;
    }
  } else {
    // JS/MJS files can be imported directly
    try {
      const mod = await import(pathToFileURL(importPath).href);
      const seedFn = mod.default ?? mod.seed;
      if (typeof seedFn === "function") {
        await seedFn();
        log("User seed file completed.\n");
      } else {
        errorLog(
          `User seed file found at ${seedPath} but does not export a default function.\n`
        );
      }
    } catch (error) {
      errorLog(`Failed to run user seed file: ${seedPath}`);
      throw error;
    }
  }
}
