/**
 * Create the account `admin.devAutoLogin` signs in as.
 *
 * Auto-login signs in a user that already exists and never creates one, so
 * without this the first /admin visit lands on the setup wizard. The seeder is
 * passed in by instrumentation.ts, which keeps this file free of imports and
 * lets it run on its own.
 */

/** The account `admin.devAutoLogin` names, as nextly.config.ts declares it. */
export type DevAutoLogin = false | { email: string; password?: string };

/** Creates a super-admin, skipping one that already exists. */
export type SeedSuperAdmin = (options: {
  email: string;
  password: string;
  name: string;
  silent: boolean;
}) => Promise<{ success: boolean; errorMessages?: string[] }>;

export async function seedDevUser(
  login: DevAutoLogin | undefined,
  seed: SeedSuperAdmin
): Promise<void> {
  // `next dev` only: no credentials in a production build, and tests bring
  // their own fixtures.
  if (process.env.NODE_ENV !== "development" || !login) return;

  // Auto-login needs no password, but creating the account does.
  if (!login.password) {
    console.warn(
      `[dev] admin.devAutoLogin names ${login.email} without a password, so that user is not created.`
    );
    return;
  }

  const result = await seed({
    email: login.email,
    password: login.password,
    name: "Dev User",
    silent: true,
  });
  if (!result.success) {
    // Otherwise the only sign is the setup wizard, with nothing saying why.
    console.warn(
      `[dev] Could not create the auto-login user ${login.email}: ${
        result.errorMessages?.join("; ") ?? "unknown error"
      }`
    );
  }
}
