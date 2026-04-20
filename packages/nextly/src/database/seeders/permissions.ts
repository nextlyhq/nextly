/**
 * Re-export the existing seeder logic from scripts
 * This module provides a programmatic API for the seed script
 */

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";

import { CreatePermissionSchema } from "@nextly/schemas/rbac";
import { ServiceContainer } from "@nextly/services/index";

/**
 * Type for adapters that support getDrizzle() method
 */
type AdapterWithDrizzle = {
  getDrizzle(schema?: Record<string, unknown>): unknown;
  dialect: string;
};

export interface SeederResult {
  success: boolean;
  created: number;
  skipped: number;
  errors: number;
  total: number;
  errorMessages?: string[];
}

/**
 * Database table names as resources
 * These should match actual database table names
 */
const RESOURCES = ["users", "roles", "permissions"] as const;

/**
 * Standard CRUD actions only
 */
const ACTIONS = ["create", "read", "update", "delete"] as const;

/**
 * Seed CRUD permissions for core resources
 * This is the programmatic version of scripts/seed-permissions.ts
 *
 * @param adapter - Database adapter instance
 * @param options - Optional configuration
 * @returns Promise<SeederResult>
 *
 * @example
 * ```typescript
 * const result = await seedPermissions(adapter, { silent: true });
 * if (result.success) {
 *   console.log(`Created ${result.created} permissions`);
 * }
 * ```
 */
export async function seedPermissions(
  adapter: DrizzleAdapter | AdapterWithDrizzle,
  options?: {
    resources?: readonly string[];
    actions?: readonly string[];
    silent?: boolean;
  }
): Promise<SeederResult> {
  const {
    resources = RESOURCES,
    actions = ACTIONS,
    silent = false,
  } = options || {};

  const log = silent ? () => {} : console.log;
  const errorLog = silent ? () => {} : console.error;

  log("🌱 Starting permission seeding...\n");

  // Verify adapter has getDrizzle() support
  if (typeof (adapter as AdapterWithDrizzle).getDrizzle !== "function") {
    throw new Error(
      `Seeding not supported for adapter. Adapter must have getDrizzle() method.`
    );
  }

  const container = new ServiceContainer(adapter as DrizzleAdapter);
  const permissionService = container.permissions;

  let created = 0;
  let skipped = 0;
  let errors = 0;
  const errorMessages: string[] = [];

  for (const resource of resources) {
    log(`📦 Processing resource: ${resource}`);

    for (const action of actions) {
      const name = `${action.charAt(0).toUpperCase() + action.slice(1)} ${resource.charAt(0).toUpperCase() + resource.slice(1)}`;
      const slug = `${action}-${resource}`;
      const description = `Permission to ${action} ${resource}`;

      try {
        // Validate against schema before calling the service
        const validation = CreatePermissionSchema.safeParse({
          name,
          slug,
          action,
          resource,
          description,
        });

        if (!validation.success) {
          const errorMsg = `Schema validation failed for ${resource}:${action}: ${validation.error.issues.map(i => i.message).join(", ")}`;
          errorLog(`  ❌ ${errorMsg}`);
          errorMessages.push(errorMsg);
          errors++;
          continue;
        }

        const result = await permissionService.ensurePermission(
          action,
          resource,
          name,
          slug,
          description
        );

        if (result.success && result.statusCode === 201) {
          log(`  ✅ Created: ${resource}:${action}`);
          created++;
        } else if (result.statusCode === 200 || result.statusCode === 409) {
          // 200 = already exists (from ensurePermission), 409 = conflict
          log(`  ⏭️  Skipped (exists): ${resource}:${action}`);
          skipped++;
        } else if (!result.success) {
          // Only treat as error if the operation actually failed
          const warnMsg = `Warning for ${resource}:${action}: ${result.message}`;
          log(`  ⚠️  ${warnMsg}`);
          errorMessages.push(warnMsg);
          errors++;
        } else {
          // Success but unexpected status code - just skip it
          log(`  ⏭️  Skipped (${result.statusCode}): ${resource}:${action}`);
          skipped++;
        }
      } catch (error) {
        const errorMsg = `Error creating ${resource}:${action}: ${error instanceof Error ? error.message : String(error)}`;
        errorLog(`  ❌ ${errorMsg}`);
        errorMessages.push(errorMsg);
        errors++;
      }
    }

    log(""); // Empty line between resources
  }

  log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  log("📊 Seeding Summary:");
  log(`  ✅ Created: ${created}`);
  log(`  ⏭️  Skipped: ${skipped}`);
  log(`  ❌ Errors: ${errors}`);
  log(`  📝 Total: ${created + skipped + errors}`);
  log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const success = errors === 0;
  if (success) {
    log("✨ Permission seeding completed successfully!");
  } else {
    errorLog(
      "⚠️  Some permissions failed to seed. Please check the errors above."
    );
  }

  return {
    success,
    created,
    skipped,
    errors,
    total: created + skipped + errors,
    errorMessages: errorMessages.length > 0 ? errorMessages : undefined,
  };
}
