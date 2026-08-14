/**
 * Whether this process may serve, with respect to boot migrations.
 *
 * `isServicesRegistered()` is not that question and never was. The request-path
 * boot registers services and THEN runs migrations, so between those two steps
 * the container is fully registered while the schema is still unverified — and
 * `getCachedNextly()` builds and returns an instance on the registered flag
 * alone. A second surface can therefore serve during the first surface's
 * migration wait, whatever that wait eventually decides.
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

import type { NextlyError } from "../errors";

const globalForGate = globalThis as unknown as {
  __nextly_bootMigrationsPending?: Promise<void>;
  __nextly_bootMigrationsRefused?: NextlyError;
  __nextly_settle?: () => void;
  __nextly_fail?: (error: unknown) => void;
};

/**
 * Open the gate, if this boot will run migrations.
 *
 * Called from `registerServices()` BEFORE it publishes the container, because
 * that is the only boundary both boot paths cross. Opening it inside the
 * migration helper was too late: the request path publishes services and only
 * calls that helper afterwards, leaving a window in which `isServicesRegistered()`
 * is true, the gate is not yet open, and a concurrent `getNextly()` serves.
 *
 * Gated on the conditions under which `runProdMigrationsIfEnabled` will settle
 * it. Opening it more widely would hang every caller that registers services
 * without ever running boot migrations — the test harness and the CLI.
 */
export function openBootMigrationsGate(willRunMigrations: boolean): void {
  if (process.env.NODE_ENV !== "production") return;
  if (!willRunMigrations) return;
  if (globalForGate.__nextly_bootMigrationsPending) return;

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
  delete globalForGate.__nextly_bootMigrationsRefused;
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
 * For the migration helper itself, which is the code that settles the gate: it
 * must still honour an earlier refusal, but awaiting a gate it is responsible
 * for closing deadlocks the boot it was called to perform. Serving surfaces
 * want {@link awaitBootMigrations} instead.
 */
export function assertBootMigrationsNotRefused(): void {
  const refused = globalForGate.__nextly_bootMigrationsRefused;
  if (refused) throw refused;
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
