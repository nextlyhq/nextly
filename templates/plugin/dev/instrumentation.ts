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
  // exist, so re-running on every dev boot is safe. Strictly `next dev` only:
  // credentials must never be seeded in a production build, and test runners
  // (NODE_ENV=test) manage their own fixtures.
  if (process.env.NODE_ENV === "development") {
    const { getService } = await import("nextly");
    const { seedPermissions, seedSuperAdmin } = await import(
      "nextly/database/seeders"
    );
    const adapter = getService("adapter");
    const seedDevUser = () =>
      seedSuperAdmin(adapter, {
        email: "dev@nextly.local",
        password: "DevPassword123!",
        name: "Dev User",
        silent: true,
      });

    await seedPermissions(adapter, { silent: true });
    await seedDevUser();

    // createRegister() fires the runtime's own permission seeding in the
    // background (post-init tasks are not awaited), and its new-permission
    // assignment silently no-ops while the Super Admin role does not exist.
    // Permissions it creates can therefore miss both the role-creation
    // snapshot above and that assignment. The runtime's assignment call runs
    // after all of its inserts, so either it sees the role created above and
    // assigns everything itself, or every insert it made is already visible
    // to this second run — which takes the role-exists path, re-lists all
    // permissions, and tops up any that are missing. In both orderings the
    // role ends up with the complete permission set.
    await seedDevUser();
  }
}
