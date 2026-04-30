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
 * Run the system bootstrap seeders: permissions and (optionally) the
 * default super admin. After task 24 phase 3 this function NO LONGER
 * discovers or runs a user-provided `nextly.seed.ts` — that path is
 * now Payload-style: the project ships its own seed function under
 * `src/endpoints/seed/index.ts` and an auth-gated POST route at
 * `src/app/admin/api/seed/route.ts` invokes it. End users trigger
 * the seed via the admin UI, not via boot-time magic. See
 * tasks/nextly-dev-tasks/24-payload-alignment-and-fixes.md phase 3.
 *
 * @param adapter - Database adapter instance
 * @param options - Optional configuration
 * @returns Combined SeederResult
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

  log("\nRunning system bootstrap seeders...\n");

  let totalCreated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  const allErrorMessages: string[] = [];

  // Step 1: Seed permissions (always, idempotent).
  const permissionsResult = await seedPermissions(adapter, { silent });
  totalCreated += permissionsResult.created;
  totalSkipped += permissionsResult.skipped;
  totalErrors += permissionsResult.errors;
  if (permissionsResult.errorMessages) {
    allErrorMessages.push(...permissionsResult.errorMessages);
  }

  // Step 2: Seed super admin only when explicitly enabled. The setup
  // wizard creates the first admin via /admin/api/auth/setup; this
  // path is reserved for `migrate:fresh` and other resets.
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
    log("\nSuper admin seeding skipped (skipSuperAdmin: true)\n");
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
    log("\nSystem bootstrap seeders completed.\n");
  } else {
    errorLog("\nSome seeders failed. Please check the errors above.\n");
  }

  return combinedResult;
}
