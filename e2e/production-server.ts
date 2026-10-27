/**
 * The production suite's server: where it runs and what it is started with,
 * shared by the suite's config and by a spec that starts a second server from
 * the same build (the component-map refusal, which must not take the main
 * server's admin down with it).
 *
 * @module production-server
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const NEXTLY_ROOT = path.resolve(HERE, "..");

/**
 * Its own port and its own database file, so this can run beside the dev suite
 * without either emptying the other's data underneath it.
 */
export const PORT = Number(process.env.E2E_PROD_PORT) || 3101;
export const BASE_URL = `http://localhost:${PORT}`;
export const E2E_DB_RELATIVE = "file:./data/e2e-prod.db";

/**
 * What readies the main server's database, run from the repository root with
 * `productionServerEnv`: empty it, seed it with the user the suite signs in as,
 * and install each plugin the playground configures. Why each step is needed
 * is told in `playwright.production.config.ts`, which runs them. Shared with
 * the visual check, which serves the same seeded build.
 */
export const PREPARE_COMMANDS = [
  "node e2e/scripts/reset-e2e-db.mjs",
  "pnpm --filter playground exec tsx scripts/seed.ts",
  "pnpm --filter playground exec nextly plugins install --all",
];

/** The production build of the playground, into `NEXT_DIST_DIR`. */
export const BUILD_COMMAND = "pnpm --filter playground exec next build";

/** The production server of that build, on `PORT`. */
export const START_COMMAND = "pnpm --filter playground exec next start";

/** The environment a production server of the playground is started with. */
export function productionServerEnv(port: number): Record<string, string> {
  return {
    PORT: String(port),
    DB_DIALECT: "sqlite",
    DATABASE_URL: E2E_DB_RELATIVE,
    // Its own build directory, for the same reason the dev suite has one: two
    // Next processes on one app fight over `.next`.
    NEXT_DIST_DIR: ".next-e2e-prod",
    // Production REQUIRES both of these and refuses to boot without them —
    // `env.ts` rejects a missing or under-32-character `NEXTLY_SECRET` and a
    // missing `NEXT_PUBLIC_APP_URL` only when NODE_ENV is production, which is
    // why `pnpm dev:app` never needed them. A fresh checkout also has no
    // `.env` (the dev script writes one; `next build` does not), so stating
    // them here is what makes this suite runnable from a clean clone.
    //
    // A literal test secret, not a generated one: a value that changed per run
    // would re-key everything derived from it and make a failure depend on
    // which run produced the database.
    NEXTLY_SECRET: "e2e-production-exit-demo-secret-not-a-real-deployment-key",
    NEXT_PUBLIC_APP_URL: `http://localhost:${port}`,
    // Production never rewrites generated files; stated so the build under
    // test is held to the committed component map, as a deployment is.
    NEXTLY_GENERATED_FILES_WRITE: "0",
    // NO harness routes. The dev suite enables them; this one must not, because
    // the demo's claim is about what a VISITOR is served, and a dev-only route
    // reachable in the build under test would falsify exactly that.
  };
}
