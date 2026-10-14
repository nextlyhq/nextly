/**
 * What an instance's defaults do to a call made as a person. A call's own
 * options are what it asks for; an instance default the person's call
 * replaces must not refuse it.
 */
import { describe, expect, it, vi } from "vitest";

import { currentPrincipal } from "../../auth/principal-scope";
import { makePrincipal } from "../../plugins/principals/principal";
import { runAsCaller } from "../namespaces/helpers";

const person = makePrincipal("accounts:account", "acc_1", { verified: true });

describe("a person's call on an instance with defaults", () => {
  it("is not refused by an instance-wide trust bound it does not use", async () => {
    // Under `overrideAccess: false` a bound narrows nothing, so an instance
    // configured with one still serves a person.
    const operation = vi.fn(async () => currentPrincipal());
    await expect(
      runAsCaller(
        { overrideAccess: true, trusted: () => true },
        { principal: person },
        operation
      )
    ).resolves.toBe(person);
    expect(operation).toHaveBeenCalledWith(
      expect.objectContaining({ overrideAccess: false })
    );
  });

  it("is refused when the call itself sets a trust bound", async () => {
    // The control: the call's own bound is still refused.
    const operation = vi.fn(async () => null);
    await expect(
      runAsCaller({}, { principal: person, trusted: () => true }, operation)
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(operation).not.toHaveBeenCalled();
  });
});
