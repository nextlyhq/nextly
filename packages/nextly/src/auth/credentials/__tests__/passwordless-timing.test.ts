/**
 * A password attempt must cost the same whether the address is unknown, has a
 * password, or signs in through an identity provider.
 *
 * The first two were equalised by the decoy hash. The third was not:
 * `verifyPassword` returns on the spot when the stored hash is empty, and an
 * account created through an external provider is stored with none — so a
 * passwordless address answered faster than an unregistered one and the
 * timing said which of a company's addresses are SSO-only. That is the
 * account whose password was never the thing protecting it.
 *
 * Asserted through the ARGUMENT rather than the clock: what makes the cost
 * constant is that bcrypt runs once against a real cost-12 hash on every
 * path, and a wall-clock assertion on a CI runner measures the runner.
 */
import { describe, expect, it, vi } from "vitest";

// Hoisted, because vi.mock's factory runs before module-level consts exist.
const { verifyPassword } = vi.hoisted(() => ({
  verifyPassword: vi.fn(async () => false),
}));
vi.mock("../../password/index", async importOriginal => ({
  // The real hash test: what counts as a stored hash is part of what is
  // under test here.
  ...(await importOriginal<typeof import("../../password/index")>()),
  verifyPassword,
}));

import { verifyCredentials } from "../verify-credentials";

const deps = {
  incrementFailedAttempts: vi.fn(async () => {}),
  lockAccount: vi.fn(async () => {}),
  resetFailedAttempts: vi.fn(async () => {}),
  maxLoginAttempts: 5,
  lockoutDurationSeconds: 900,
  requireEmailVerification: false,
};

type Found = Awaited<
  ReturnType<Parameters<typeof verifyCredentials>[1]["findUserByEmail"]>
>;

const account = (passwordHash: string | null): Found => ({
  id: "u1",
  email: "a@example.test",
  name: "A",
  image: null,
  passwordHash,
  emailVerified: new Date(),
  isActive: true,
  mustChangePassword: false,
  failedLoginAttempts: 0,
  lockedUntil: null,
  deactivatedAt: null,
  passwordUpdatedAt: null,
  sessionEpoch: 0,
});

async function attempt(found: Found): Promise<string> {
  verifyPassword.mockClear();
  await expect(
    verifyCredentials(
      { email: "a@example.test", password: "hunter2" },
      { ...deps, findUserByEmail: async () => found }
    )
  ).rejects.toThrow();
  expect(verifyPassword).toHaveBeenCalledTimes(1);
  return (verifyPassword.mock.calls[0] as unknown as [string, string])[1];
}

describe("the cost of a failed password attempt", () => {
  it("compares against a real hash for an unknown address", async () => {
    // The case that was already equalised — kept as the reference the other
    // two are measured against.
    await expect(attempt(null)).resolves.toMatch(/^\$2[aby]\$12\$/);
  });

  it("compares against a real hash for a PASSWORDLESS account", async () => {
    // The defect. An empty stored hash short-circuits `verifyPassword`, so
    // this path has to be handed the decoy like the miss path is.
    await expect(attempt(account(null))).resolves.toMatch(/^\$2[aby]\$12\$/);
  });

  it("compares against the stored hash for an ordinary account", async () => {
    // The control that keeps the fix honest: substituting the decoy
    // everywhere would equalise the timing and break signing in.
    const stored = "$2b$12$" + "s".repeat(53);
    await expect(attempt(account(stored))).resolves.toBe(stored);
  });

  it("compares against a real hash for an account whose stored value is not a hash", async () => {
    // A password stored as given, as a long one containing a colon was. It
    // is never compared, and its refusal costs what any other does.
    const plain = "correct-horse:battery-staple-and-more-words";
    await expect(attempt(account(plain))).resolves.toMatch(/^\$2[aby]\$12\$/);
  });

  it("refuses an account whose stored value is the password itself", async () => {
    // The login a text comparison would admit: the attempt is exactly what
    // is stored. Refused even when the comparison it is given answers yes.
    const plain = "correct-horse:battery-staple-and-more-words";
    verifyPassword.mockResolvedValueOnce(true);
    await expect(
      verifyCredentials(
        { email: "a@example.test", password: plain },
        { ...deps, findUserByEmail: async () => account(plain) }
      )
    ).rejects.toThrow();
  });

  it("refuses a passwordless account even if the decoy MATCHED", async () => {
    // The decoy is a comparison, not an authorisation. Were its plaintext
    // ever to leak, a true answer from it must still not sign anyone in to
    // an account that has no password.
    verifyPassword.mockResolvedValueOnce(true);
    await expect(
      verifyCredentials(
        { email: "a@example.test", password: "hunter2" },
        { ...deps, findUserByEmail: async () => account(null) }
      )
    ).rejects.toThrow();
  });
});
