/**
 * The gate exists because `isServicesRegistered()` answers a different
 * question. The request-path boot registers services and THEN waits for the
 * migrate lock, so throughout that wait the container is registered while the
 * schema is unverified — and another surface keying off the registered flag
 * would serve inside that window whatever the wait eventually decided.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { NextlyError } from "../../errors";
import {
  _resetBootMigrationsGateForTest,
  awaitBootMigrations,
  beginBootMigrations,
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
    const gate = beginBootMigrations();

    const consumer = awaitBootMigrations();
    expect(await isPending(consumer)).toBe(true);

    gate.allow();
    await expect(consumer).resolves.toBeUndefined();
  });

  it("rejects the waiting consumer when the boot refuses", async () => {
    const gate = beginBootMigrations();
    const consumer = awaitBootMigrations();

    gate.refuse(refusal());

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
    const gate = beginBootMigrations();
    gate.refuse(refusal());

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
    const gate = beginBootMigrations();
    gate.allow();

    await expect(awaitBootMigrations()).resolves.toBeUndefined();
    await expect(awaitBootMigrations()).resolves.toBeUndefined();
  });
});
