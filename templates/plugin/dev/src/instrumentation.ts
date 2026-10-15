// Warm up Nextly once per worker at startup (Node.js runtime only) so admin/API
// handlers never run before init and schema boot-apply runs once, not per request.
// Imported dynamically + guarded so nextly stays out of the Edge bundle. It sits
// in src/ beside app/, where Next.js looks for it when an app lives under src/.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { createRegister, getService } = await import("nextly");
  const { default: config } = await import("../nextly.config");
  await createRegister(config)();

  // Create the user admin.devAutoLogin signs in as (see seed-dev-user.ts).
  // After boot, because boot seeds every permission and the Super Admin role
  // created here takes all that exist.
  const { seedSuperAdmin } = await import("nextly/database/seeders");
  const { seedDevUser } = await import("./seed-dev-user");
  await seedDevUser(config.admin?.devAutoLogin, options =>
    seedSuperAdmin(getService("adapter"), options)
  );
}
