/**
 * The gate exists because `isServicesRegistered()` answers a different
 * question: it says the container is built, not whether the schema it serves
 * was verified or whether a refusal forbids serving at all. Whether a boot
 * opens the gate is decided by `runProdMigrationsIfEnabled` (see
 * prod-migrations.test.ts); these cases cover the gate's own behaviour.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../errors";
import {
  _resetBootMigrationsGateForTest,
  allowBootMigrations,
  assertBootMigrationsSettled,
  awaitBootMigrations,
  openBootMigrationsGate,
  refuseBootMigrations,
} from "../boot-migrations-gate";

const refusal = (): NextlyError =>
  new NextlyError({
    code: "NEXTLY_BOOT_MIGRATIONS_NOT_RUN",
    publicMessage: "refused",
  });

/**
 * Whether a promise is still pending, without waiting on it.
 *
 * Raced against a MACROTASK, not `Promise.resolve`. A resolved microtask can
 * win against an already-settled promise, so the earlier version reported
 * "pending" for a gate that had never opened — the assertion below would then
 * pass whether or not `openBootMigrationsGate` did anything.
 */
async function isPending(p: Promise<unknown>): Promise<boolean> {
  const marker = Symbol("pending");
  const winner = await Promise.race([
    p.then(
      () => "settled",
      () => "settled"
    ),
    new Promise(resolve => setTimeout(() => resolve(marker), 0)),
  ]);
  return winner === marker;
}

beforeEach(() => {
  _resetBootMigrationsGateForTest();
  // The production boot these cases describe. `stubEnv` rather than direct
  // assignment so the restore cannot leak a value into a sibling suite.
  vi.stubEnv("NODE_ENV", "production");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the boot-migrations gate", () => {
  /**
   * Development, or `runMigrationsOnBoot` off. Every serving surface calls this
   * unconditionally, so a closed gate here would block the common case.
   */
  it("lets everything through when no boot opened it", async () => {
    await expect(awaitBootMigrations()).resolves.toBeUndefined();
  });

  /**
   * The race itself. A consumer arriving mid-boot must WAIT, not decide — and
   * not fail either: throwing while pending would turn every normal cold-boot
   * request into a 503.
   */
  it("holds a consumer that arrives while migrations are still running", async () => {
    openBootMigrationsGate();

    const consumer = awaitBootMigrations();
    expect(await isPending(consumer)).toBe(true);

    allowBootMigrations();
    await expect(consumer).resolves.toBeUndefined();
  });

  it("rejects the waiting consumer when the boot refuses", async () => {
    openBootMigrationsGate();
    const consumer = awaitBootMigrations();

    refuseBootMigrations(refusal());

    await expect(consumer).rejects.toMatchObject({
      code: "NEXTLY_BOOT_MIGRATIONS_NOT_RUN",
    });
  });

  /**
   * The sticky half. A consumer that arrives AFTER the refusal has settled has
   * no pending promise to wait on, so the refusal has to be recorded as state —
   * otherwise the second request through any surface finds an empty gate and
   * serves the schema the process refused.
   */
  it("keeps refusing consumers that arrive after it settled", async () => {
    openBootMigrationsGate();
    refuseBootMigrations(refusal());

    await expect(awaitBootMigrations()).rejects.toMatchObject({
      code: "NEXTLY_BOOT_MIGRATIONS_NOT_RUN",
    });
    // And again — the refusal is not consumed by being read.
    await expect(awaitBootMigrations()).rejects.toMatchObject({
      code: "NEXTLY_BOOT_MIGRATIONS_NOT_RUN",
    });
  });

  /**
   * A refusal is FINAL for the process, and a retry must not reopen its way
   * past one. The refusal path calls `shutdownServices()`, so the next request
   * re-registers — and re-registration is what opens the gate. Clearing the
   * refusal on open handed every retry a clean slate and let it migrate as
   * though nothing had been decided.
   */
  it("survives the gate being reopened by a re-registration", async () => {
    openBootMigrationsGate();
    refuseBootMigrations(refusal());

    // What a retry does: `registerServices` runs again and opens the gate.
    openBootMigrationsGate();

    await expect(awaitBootMigrations()).rejects.toMatchObject({
      code: "NEXTLY_BOOT_MIGRATIONS_NOT_RUN",
    });
  });

  /**
   * The synchronous consumer, which cannot wait. `getNextly()` in the Direct API
   * is exported from the package root and a Server Component can call
   * `nextly.find()` on it, so its only choices while the gate is pending are to
   * throw or to query a schema nobody has verified.
   */
  it("refuses a synchronous consumer while migrations are still running", () => {
    openBootMigrationsGate();

    expect(() => assertBootMigrationsSettled()).toThrow(
      expect.objectContaining({ code: "NEXTLY_BOOT_MIGRATIONS_PENDING" })
    );
  });

  it("refuses a synchronous consumer after a refusal", () => {
    openBootMigrationsGate();
    refuseBootMigrations(refusal());

    expect(() => assertBootMigrationsSettled()).toThrow(
      expect.objectContaining({ code: "NEXTLY_BOOT_MIGRATIONS_NOT_RUN" })
    );
  });

  /**
   * The control for both. Without it they are satisfied by a function that
   * throws unconditionally — which would break every Direct API call in
   * development and in any app that does not run boot migrations.
   */
  it("lets a synchronous consumer through once the gate has settled", () => {
    openBootMigrationsGate();
    allowBootMigrations();

    expect(() => assertBootMigrationsSettled()).not.toThrow();
  });

  /**
   * The positive control for the case above: an ALLOWED boot must not leave the
   * gate closed behind it, or every later request hangs. Without this, a gate
   * that simply never opened would satisfy the refusal tests.
   */
  it("stays open once a boot allowed it", async () => {
    openBootMigrationsGate();
    allowBootMigrations();

    await expect(awaitBootMigrations()).resolves.toBeUndefined();
    await expect(awaitBootMigrations()).resolves.toBeUndefined();
  });
});
