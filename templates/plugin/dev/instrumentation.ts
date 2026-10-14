// Warm up Nextly once per worker at startup (Node.js runtime only) so admin/API
// handlers never run before init and schema boot-apply runs once, not per request.
// Imported dynamically + guarded so nextly stays out of the Edge bundle.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { createRegister } = await import("nextly");
  const { default: config } = await import("./nextly.config");
  await createRegister(config)();

  // admin.devAutoLogin in nextly.config.ts signs in a user that already exists
  // and never creates one, so without this the first /admin visit lands on the
  // setup wizard. Boot has seeded every permission by the time createRegister
  // resolves, so the Super Admin role this creates holds all of them. Skipped
  // when the user exists, so every dev boot can run it. `next dev` only: no
  // credentials in a production build, and tests seed their own fixtures.
  if (process.env.NODE_ENV === "development") {
    const { getService } = await import("nextly");
    const { seedSuperAdmin } = await import("nextly/database/seeders");
    await seedSuperAdmin(getService("adapter"), {
      email: "dev@nextly.local",
      password: "DevPassword123!",
      name: "Dev User",
      silent: true,
    });
  }
}
