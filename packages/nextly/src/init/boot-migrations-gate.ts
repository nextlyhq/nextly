/**
 * Whether this process may serve, with respect to boot migrations.
 *
 * `isServicesRegistered()` is not that question. It says the container is
 * built; this says whether the schema that container serves was verified, and
 * — the part no flag can answer — whether a refusal earlier in this process
 * forbids serving at all. Migrations run inside `registerServices`, before the
 * container is published, so the gate is pending only while that run is in
 * flight, and a refusal it records stays for every later boot attempt.
 *
 * This gate is the missing question, asked in one place. Consumers AWAIT it
 * rather than test it: a request arriving mid-boot should wait for the boot it
 * is racing, exactly as it does today, and only then learn whether serving is
 * allowed. Throwing while pending would turn every normal cold-boot request
 * into a 503.
 *
 * On `globalThis` for the reason the rest of the boot state is: Next.js and
 * Turbopack can evaluate this module in more than one server graph, and a
 * refusal recorded in one copy has to be visible from the other.
 *
 * @module init/boot-migrations-gate
 */

import { NextlyError } from "../errors";

const globalForGate = globalThis as unknown as {
  __nextly_bootMigrationsPending?: Promise<void>;
  __nextly_bootMigrationsRefused?: NextlyError;
  __nextly_settle?: () => void;
  __nextly_fail?: (error: unknown) => void;
};

/**
 * Open the gate: this boot is about to run migrations.
 *
 * Called by `runProdMigrationsIfEnabled` itself, once it has decided to run and
 * immediately before it does, so the function that opens the gate is the one
 * that settles it on every path out — success, a tolerated failure, or a
 * refusal — and the decision to run is read in one place only.
 *
 * The helper runs inside `registerServices`, before the container is marked
 * registered, so no surface sees the container as registered while the schema
 * is still unverified.
 */
export function openBootMigrationsGate(): void {
  if (globalForGate.__nextly_bootMigrationsPending) return;
  // A refusal is FINAL for the process, so a retry cannot reopen its way past
  // one. The refusal path calls `shutdownServices()`, which makes the next
  // request re-register — and re-registration runs the helper again, so
  // clearing the refusal here would hand every retry a clean slate and let it
  // proceed to migrate as though nothing had been decided.
  if (globalForGate.__nextly_bootMigrationsRefused) return;

  let settle: (() => void) | undefined;
  let fail: ((error: unknown) => void) | undefined;
  const pending = new Promise<void>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  // Consumers attach their own handlers when they await this. Attaching one
  // here keeps a refusal from surfacing as an unhandled rejection in the window
  // before the first consumer arrives, which would crash the process for the
  // wrong reason and hide the refusal behind it.
  void pending.catch(() => undefined);

  globalForGate.__nextly_bootMigrationsPending = pending;
  globalForGate.__nextly_settle = settle;
  globalForGate.__nextly_fail = fail;
}

/** Migrations ran, were not required, or failed recoverably: serving is allowed. */
export function allowBootMigrations(): void {
  const settle = globalForGate.__nextly_settle;
  globalForGate.__nextly_bootMigrationsPending = undefined;
  globalForGate.__nextly_settle = undefined;
  globalForGate.__nextly_fail = undefined;
  settle?.();
}

/** Migrations did not run: this process must not serve, now or on any retry. */
export function refuseBootMigrations(error: NextlyError): void {
  const fail = globalForGate.__nextly_fail;
  // Recorded BEFORE rejecting, so a consumer arriving after the promise settles
  // still finds the refusal rather than an empty gate.
  globalForGate.__nextly_bootMigrationsRefused = error;
  globalForGate.__nextly_bootMigrationsPending = undefined;
  globalForGate.__nextly_settle = undefined;
  globalForGate.__nextly_fail = undefined;
  fail?.(error);
}

/**
 * Throw if a previous boot already refused, WITHOUT waiting on a pending gate.
 *
 * For `registerServices`, before it connects anything, and for the migration
 * helper, which is the code that settles the gate: both must honour an earlier
 * refusal, and awaiting a gate the helper is responsible for closing would
 * deadlock the boot it was called to perform. Serving surfaces want
 * {@link awaitBootMigrations} instead.
 */
export function assertBootMigrationsNotRefused(): void {
  const refused = globalForGate.__nextly_bootMigrationsRefused;
  if (refused) throw refused;
}

/**
 * Throw unless boot migrations have SETTLED and allowed serving.
 *
 * For synchronous consumers, which cannot wait. The Direct API's
 * `requireNextly()` is one: it is exported from the package root and a Server
 * Component can call `nextly.find()` on it, and `isServicesRegistered()` alone
 * does not say whether this process's boot migrations allowed it to serve.
 *
 * Refusing while merely PENDING is the deliberate part. An async consumer waits
 * for the answer; a synchronous one cannot, so its only choices are to throw or
 * to query a schema nobody has verified. Throwing is recoverable — the caller
 * retries and the gate has settled — and the alternative is silently reading a
 * database this build may not match.
 */
export function assertBootMigrationsSettled(): void {
  const refused = globalForGate.__nextly_bootMigrationsRefused;
  if (refused) throw refused;

  if (globalForGate.__nextly_bootMigrationsPending) {
    throw new NextlyError({
      code: "NEXTLY_BOOT_MIGRATIONS_PENDING",
      publicMessage:
        "Boot migrations are still running, so the schema this build expects " +
        "is not yet confirmed. Retry shortly; this resolves once migrations " +
        "finish.",
    });
  }
}

/**
 * Wait until boot migrations have settled, then throw if they refused.
 *
 * Resolves immediately when no boot opened the gate — development, or
 * `runMigrationsOnBoot` off — so every serving surface can call it
 * unconditionally.
 */
export async function awaitBootMigrations(): Promise<void> {
  const refused = globalForGate.__nextly_bootMigrationsRefused;
  if (refused) throw refused;

  const pending = globalForGate.__nextly_bootMigrationsPending;
  if (pending) await pending;
}

/** Test seam: drop all gate state. Never called by product code. */
export function _resetBootMigrationsGateForTest(): void {
  globalForGate.__nextly_bootMigrationsPending = undefined;
  globalForGate.__nextly_settle = undefined;
  globalForGate.__nextly_fail = undefined;
  delete globalForGate.__nextly_bootMigrationsRefused;
}
