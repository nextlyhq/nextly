// Warm up Nextly once per worker at startup (Node.js runtime only) so admin/API
// handlers never run before init and schema boot-apply runs once, not per request.
// Imported dynamically + guarded so nextly stays out of the Edge bundle.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { createRegister } = await import("nextly");
  const { default: config } = await import("./nextly.config");
  await createRegister(config)();

  // Seed the dev auto-login user (matching admin.devAutoLogin in
  // dev/nextly.config.ts) so the first /admin visit lands on the dashboard
  // instead of the /admin/setup wizard. Both seeders skip rows that already
  // exist, so re-running on every dev boot is safe. Guarded to non-production
  // like devAutoLogin itself; this playground is never deployed.
  if (process.env.NODE_ENV !== "production") {
    const { getService } = await import("nextly");
    const { seedPermissions, seedSuperAdmin } = await import(
      "nextly/database/seeders"
    );
    const adapter = getService("adapter");
    await seedPermissions(adapter, { silent: true });
    await seedSuperAdmin(adapter, {
      email: "dev@nextly.local",
      password: "DevPassword123!",
      name: "Dev User",
      silent: true,
    });
  }
}
