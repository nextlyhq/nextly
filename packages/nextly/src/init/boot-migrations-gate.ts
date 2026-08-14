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
};

/** Handle for the boot that owns the gate, returned by {@link beginBootMigrations}. */
export interface BootMigrationsGate {
  /** Migrations ran (or were not required): serving is allowed. */
  allow(): void;
  /** Migrations did not run: this process must not serve, now or later. */
  refuse(error: NextlyError): void;
}

/**
 * Open the gate for a boot that is about to run migrations.
 *
 * Called BEFORE `registerServices()` so the window this closes — registered but
 * unverified — never exists unguarded. Every consumer that arrives after this
 * point waits for `allow` or `refuse`.
 */
export function beginBootMigrations(): BootMigrationsGate {
  let settle: (() => void) | undefined;
  let fail: ((error: unknown) => void) | undefined;

  const pending = new Promise<void>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  // Consumers attach their own handlers when they await this. Attaching one
  // here keeps a refusal from surfacing as an unhandled rejection in the window
  // before the first consumer arrives — which would crash the process for the
  // wrong reason and hide the refusal behind it.
  void pending.catch(() => undefined);

  globalForGate.__nextly_bootMigrationsPending = pending;
  delete globalForGate.__nextly_bootMigrationsRefused;

  return {
    allow(): void {
      globalForGate.__nextly_bootMigrationsPending = undefined;
      settle?.();
    },
    refuse(error: NextlyError): void {
      // Recorded BEFORE rejecting, so a consumer that arrives after the promise
      // settles still finds the refusal rather than an empty gate.
      globalForGate.__nextly_bootMigrationsRefused = error;
      globalForGate.__nextly_bootMigrationsPending = undefined;
      fail?.(error);
    },
  };
}

/**
 * Wait until boot migrations have settled, then throw if they refused.
 *
 * Resolves immediately when no boot has opened the gate — development, or
 * `runMigrationsOnBoot` off — so this is safe to call from any serving surface
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
  delete globalForGate.__nextly_bootMigrationsRefused;
}
