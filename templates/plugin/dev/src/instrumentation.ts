// Warm up Nextly once per worker at startup (Node.js runtime only) so admin/API
// handlers never run before init and schema boot-apply runs once, not per request.
// Imported dynamically + guarded so nextly stays out of the Edge bundle. It sits
// in src/ beside app/, where Next.js looks for it when an app lives under src/.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { createRegister, getService } = await import("nextly");
  const { default: config } = await import("../nextly.config");
  // Next.js writes its Cache Components setting into this file as it builds
  // it. Nextly, loaded from node_modules, cannot read that for itself. With
  // it off, Nextly warns at start; with it on, a cached read that finds no
  // "use cache" read function says so. The same holds for the build's newest
  // migration, which withNextly sets: a production start compares it with
  // the database's schema version and warns when the database is behind.
  await createRegister(config, {
    cacheComponents: process.env.__NEXT_CACHE_COMPONENTS,
    buildSchemaVersion: process.env.NEXTLY_BUILD_SCHEMA_VERSION,
  })();

  // Create the user admin.devAutoLogin signs in as (see seed-dev-user.ts).
  // After boot, because boot seeds every permission and the Super Admin role
  // created here takes all that exist.
  const { seedSuperAdmin } = await import("nextly/database/seeders");
  const { seedDevUser } = await import("./seed-dev-user");
  await seedDevUser(config.admin?.devAutoLogin, options =>
    seedSuperAdmin(getService("adapter"), options)
  );
}
