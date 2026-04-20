#!/usr/bin/env node
import "../src/scripts/load-env";
// Import directly from factory to avoid triggering drizzle.ts top-level code
import { createAdapterFromEnv } from "../src/database/factory.js";
import { seedAll } from "../src/database/seeders/index.js";

/**
 * Complete seed script that creates:
 * 1. All CRUD permissions for core resources
 *
 * The first admin account is created via the admin setup screen (/admin/setup)
 * on first run — no seed-based super admin is needed.
 *
 * Usage: pnpm db:seed:all
 */

async function main() {
  console.log("🌱 Starting complete database seeding...\n");

  try {
    console.log("📡 Connecting to database...");
    const adapter = await createAdapterFromEnv();
    console.log("✅ Database connected\n");

    const result = await seedAll(adapter, {
      silent: false,
      skipSuperAdmin: true,
    });

    if (result.success) {
      console.log("\n✅ Database seeding completed successfully!");
      console.log(
        "\n📝 Visit /admin/setup to create your first admin account.\n"
      );
      await adapter.disconnect();
      process.exit(0);
    } else {
      console.error("\n❌ Database seeding failed with errors.");
      if (result.errorMessages) {
        console.error("\nErrors:");
        result.errorMessages.forEach(msg => console.error(`  - ${msg}`));
      }
      await adapter.disconnect();
      process.exit(1);
    }
  } catch (error) {
    console.error("\n💥 Fatal error during seeding:");
    console.error(error);
    process.exit(1);
  }
}

main();
