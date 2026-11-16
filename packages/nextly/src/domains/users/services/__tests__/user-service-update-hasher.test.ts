/**
 * The users service judges a new password by the reach of the hasher it
 * hashes with, and hashes nothing a refused password would set.
 */
import { describe, expect, it, vi } from "vitest";

import { hashPassword, verifyPassword } from "../../../../auth/password";
import { silentLogger } from "../../../collections/__tests__/collection-test-helpers";
import { UserService } from "../user-service";

describe("UserService.changePassword and the R-5 rule", () => {
  it("refuses a new password the rule refuses, and hashes nothing", async () => {
    const hash = vi.fn(async () => "new-hash");
    const changeOwnPasswordHash = vi.fn().mockResolvedValue(true);
    const accountService = {
      getUserPasswordHashById: vi
        .fn()
        .mockResolvedValue(await hashPassword("Current-Password-9", 4)),
      changeOwnPasswordHash,
    };
    const service = new UserService(
      {} as never,
      { updateUser: vi.fn() } as never,
      accountService as never,
      { hash, verify: verifyPassword, reach: "unbounded" },
      silentLogger as never
    );

    await expect(
      service.changePassword("user-1", "Current-Password-9", "password")
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    // The refused password is never hashed (the digester hashes one decoy of
    // its own, once, to learn the hasher's format) and nothing is written.
    expect(hash).not.toHaveBeenCalledWith("password");
    expect(changeOwnPasswordHash).not.toHaveBeenCalled();
  });
});
