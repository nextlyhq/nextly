/**
 * The gate exists because `isServicesRegistered()` answers a different
 * question. The request-path boot registers services and THEN waits for the
 * migrate lock, so throughout that wait the container is registered while the
 * schema is unverified — and another surface keying off the registered flag
 * would serve inside that window whatever the wait eventually decided.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../errors";
import {
  _resetBootMigrationsGateForTest,
  allowBootMigrations,
  awaitBootMigrations,
  openBootMigrationsGate,
  refuseBootMigrations,
} from "../boot-migrations-gate";

const refusal = (): NextlyError =>
  new NextlyError({
    code: "NEXTLY_BOOT_MIGRATIONS_NOT_RUN",
    publicMessage: "refused",
  });

/** Whether a promise is still pending, without waiting on it. */
async function isPending(p: Promise<unknown>): Promise<boolean> {
  const marker = Symbol("pending");
  const winner = await Promise.race([
    p.then(
      () => "settled",
      () => "settled"
    ),
    Promise.resolve(marker),
  ]);
  return winner === marker;
}

beforeEach(() => {
  _resetBootMigrationsGateForTest();
  // The gate only opens for a production boot with migrations configured, which
  // is exactly the state these cases are about. `stubEnv` rather than direct
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
   * The gate must not open for a boot that will never settle it. Registration
   * happens in the CLI and the test harness too, and a gate opened there would
   * hang every later consumer forever.
   */
  it("does not open when this boot will not run migrations", async () => {
    openBootMigrationsGate(false);
    await expect(awaitBootMigrations()).resolves.toBeUndefined();
  });

  it("does not open outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    openBootMigrationsGate(true);
    await expect(awaitBootMigrations()).resolves.toBeUndefined();
  });

  /**
   * The race itself. A consumer arriving mid-boot must WAIT, not decide — and
   * not fail either: throwing while pending would turn every normal cold-boot
   * request into a 503.
   */
  it("holds a consumer that arrives while migrations are still running", async () => {
    openBootMigrationsGate(true);

    const consumer = awaitBootMigrations();
    expect(await isPending(consumer)).toBe(true);

    allowBootMigrations();
    await expect(consumer).resolves.toBeUndefined();
  });

  it("rejects the waiting consumer when the boot refuses", async () => {
    openBootMigrationsGate(true);
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
    openBootMigrationsGate(true);
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
   * The positive control for the case above: an ALLOWED boot must not leave the
   * gate closed behind it, or every later request hangs. Without this, a gate
   * that simply never opened would satisfy the refusal tests.
   */
  it("stays open once a boot allowed it", async () => {
    openBootMigrationsGate(true);
    allowBootMigrations();

    await expect(awaitBootMigrations()).resolves.toBeUndefined();
    await expect(awaitBootMigrations()).resolves.toBeUndefined();
  });
});
