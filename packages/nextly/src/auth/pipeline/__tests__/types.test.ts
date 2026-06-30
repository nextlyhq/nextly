import { describe, it, expect } from "vitest";

import type { AuthUserId } from "../../../types/auth";
import type {
  AuthOutcome,
  AuthStrategy,
  Challenge,
  ChallengeDefinition,
  AuthHooks,
} from "../types";

const userId = "u1" as AuthUserId;

describe("auth pipeline contracts", () => {
  it("models every AuthOutcome variant", () => {
    const authenticated: AuthOutcome = {
      type: "authenticated",
      user: { id: userId, email: "a@b.c", name: "A", image: null },
    };
    const challenge: AuthOutcome = {
      type: "challenge",
      challenge: { id: "totp", userId: "u1" },
    };
    const fail: AuthOutcome = { type: "fail", reason: "nope" };
    const pass: AuthOutcome = { type: "pass" };

    expect([authenticated.type, challenge.type, fail.type, pass.type]).toEqual([
      "authenticated",
      "challenge",
      "fail",
      "pass",
    ]);
  });

  it("models a strategy that returns an outcome", async () => {
    const strategy: AuthStrategy = {
      name: "stub",
      authenticate: async () => ({ type: "pass" }),
    };
    expect(strategy.name).toBe("stub");
    expect((await strategy.authenticate({} as never, {} as never)).type).toBe(
      "pass"
    );
  });

  it("models a challenge definition + resolve", async () => {
    const def: ChallengeDefinition = {
      id: "totp",
      resolve: async ({ response }) =>
        response.code === "123456" ? { ok: true } : { ok: false },
    };
    expect(
      await def.resolve(
        { userId: "u1", response: { code: "123456" } },
        {} as never
      )
    ).toEqual({
      ok: true,
    });
  });

  it("models hooks including a challenge-returning afterAuthenticate", async () => {
    const hooks: AuthHooks = {
      afterAuthenticate: () => ({ challenge: { id: "totp", userId: "u1" } }),
      customizeClaims: claims => ({ ...claims, extra: 1 }),
    };
    const res = await hooks.afterAuthenticate!(
      { id: userId, email: "a@b.c" },
      {} as never
    );
    expect("challenge" in (res as object)).toBe(true);
    expect(
      await hooks.customizeClaims!(
        { sub: "u1" },
        { id: userId, email: "a@b.c" },
        {} as never
      )
    ).toMatchObject({
      extra: 1,
    });
  });
});

const _challenge: Challenge = { id: "x", userId: "u1" };
void _challenge;
