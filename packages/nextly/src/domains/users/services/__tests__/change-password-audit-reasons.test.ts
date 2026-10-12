/**
 * `UserService.changePassword` refusals carry reasons the audit trail keeps.
 *
 * A reason outside the audit vocabulary is dropped from the trail with no
 * diagnostic, so a refusal named in free text is recorded without its cause.
 */
import { describe, expect, it, vi } from "vitest";

import { isAuditReason } from "../../../audit/audit-reasons";
import { NextlyError } from "../../../../errors";
import { UserService } from "../user-service";

/** Only the members `changePassword` touches; the rest are never reached. */
function serviceFor(opts: { passwordMatches: boolean; written: boolean }) {
  const accountService = {
    getUserPasswordHashById: vi.fn().mockResolvedValue("stored-hash"),
    changeOwnPasswordHash: vi.fn().mockResolvedValue(opts.written),
  };
  const passwordHasher = {
    verify: vi.fn().mockResolvedValue(opts.passwordMatches),
    hash: vi.fn().mockResolvedValue("new-hash"),
  };
  return new UserService(
    {} as never,
    {} as never,
    accountService as never,
    passwordHasher as never,
    { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never
  );
}

async function refusalReason(service: UserService): Promise<unknown> {
  const refusal = await service
    .changePassword("u-1", "current", "N3w-Str0ng-P@ss!")
    .then(
      () => null,
      (err: unknown) => err
    );
  expect(NextlyError.is(refusal)).toBe(true);
  return (refusal as NextlyError).logContext?.reason;
}

describe("UserService.changePassword refusal reasons", () => {
  it("names a wrong current password as the auth service does", async () => {
    const reason = await refusalReason(
      serviceFor({ passwordMatches: false, written: false })
    );

    expect(reason).toBe("current-password-mismatch");
    expect(isAuditReason(reason)).toBe(true);
  });

  it("names a deactivated account's refused write as inactive", async () => {
    const reason = await refusalReason(
      serviceFor({ passwordMatches: true, written: false })
    );

    expect(reason).toBe("inactive");
    expect(isAuditReason(reason)).toBe(true);
  });
});
