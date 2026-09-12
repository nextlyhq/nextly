import { describe, expect, it } from "vitest";

import { NextlyError } from "../../errors/nextly-error";

import { listRoleSlugsForUserOrRefuse } from "./permissions";

/**
 * `listRoleSlugsForUserOrRefuse` answers with the roles, or refuses in the
 * shape its callers can read.
 *
 * Two places depend on it — the plugin facade and an API key's own roles — and
 * both mock it in their own suites, which proves what THEY do with a refusal
 * and nothing about whether the refusal has the shape they assume. This is the
 * one place the real function is exercised, so those mocks stand in for a
 * contract that was checked rather than one that was assumed.
 *
 * Nothing is mocked here, deliberately. The wrapper calls the strict lookup by
 * its module-internal name, so replacing that export does not intercept the
 * call — an earlier version of this file did exactly that and passed the real
 * lookup straight through while appearing to control it. Both directions are
 * driven through real code instead: a lookup that cannot reach a database
 * genuinely fails, and an empty user id genuinely returns before it tries.
 */
describe("a role lookup that could not run refuses", () => {
  it("answers without refusing when there is nothing to look up", async () => {
    // The control. Every assertion below is satisfied by a function that
    // throws under all circumstances, which would refuse every caller in the
    // install rather than only the ones whose lookup failed. An empty id names
    // nobody and returns before any query, so this reaches the success path
    // without a database.
    await expect(listRoleSlugsForUserOrRefuse("")).resolves.toEqual([]);
  });

  it("refuses in the typed envelope rather than with the driver's error", async () => {
    // No adapter is registered in this suite, so the lookup underneath fails
    // for real. Everything downstream of this function answers in the typed
    // envelope and branches on `code`; a raw failure reaching a route handler
    // carries neither.
    const thrown = await listRoleSlugsForUserOrRefuse("u1").catch(
      (error: unknown) => error
    );

    expect(NextlyError.is(thrown)).toBe(true);
    expect((thrown as NextlyError).code).toBe("INTERNAL_ERROR");
  });

  it("keeps the cause, so an operator has something to diagnose", async () => {
    // The control on the wrapping. A wrapper that threw a fresh error and
    // discarded the original satisfies the case above and leaves the reason
    // the lookup failed nowhere at all. The message is the real one the
    // failure produced, not a fixture's.
    const thrown = await listRoleSlugsForUserOrRefuse("u1").catch(
      (error: unknown) => error
    );

    expect((thrown as { cause?: Error }).cause).toBeInstanceOf(Error);
    expect((thrown as { cause?: Error }).cause?.message).not.toBe("");
  });

  it("says which lookup failed and for whom", async () => {
    // A refusal an operator cannot place is a refusal they cannot act on, and
    // the public message is deliberately generic.
    const thrown = await listRoleSlugsForUserOrRefuse("u1").catch(
      (error: unknown) => error
    );

    expect((thrown as NextlyError).logContext).toMatchObject({
      reason: "roles-unreadable",
      userId: "u1",
    });
  });
});
