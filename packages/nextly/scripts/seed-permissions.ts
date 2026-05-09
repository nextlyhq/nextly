#!/usr/bin/env node
import "../src/scripts/load-env";
// Environment variables are loaded from apps/playground/.env or root .env by load-env
// Import directly from factory to avoid triggering drizzle.ts top-level code
import { createAdapterFromEnv } from "../src/database/factory.js";
import { seedPermissions } from "../src/database/seeders/index.js";

/**
 * Seed script to create all CRUD permissions for core resources
 * Usage: pnpm db:seed
 *
 * Schema constraints (from CreatePermissionSchema):
 * - name: string (1-100 chars) - Required
 * - action: string (1-50 chars) - Required - Only CRUD operations
 * - resource: string (1-50 chars) - Required - Must match database table names
 * - description: string (max 255 chars) - Optional/Nullable
 *
 * IMPORTANT:
 * - Resources MUST match actual database table names
 * - Actions MUST be only: create, read, update, delete
 */

async function main() {
  console.log("🌱 Starting permission seeding...\n");

  try {
    console.log("📡 Connecting to database...");
    const adapter = await createAdapterFromEnv();
    console.log("✅ Database connected\n");

    const result = await seedPermissions(adapter, { silent: false });

    await adapter.disconnect();

    if (result.success) {
      console.log("\n✅ Permission seeding completed successfully!");
      process.exit(0);
    } else {
      console.error("\n❌ Permission seeding failed with errors.");
      if (result.errorMessages) {
        console.error("\nErrors:");
        result.errorMessages.forEach(msg => console.error(`  - ${msg}`));
      }
      process.exit(1);
    }
  } catch (error) {
    console.error("\n💥 Fatal error during seeding:");
    console.error(error);
    process.exit(1);
  }
}

main();
