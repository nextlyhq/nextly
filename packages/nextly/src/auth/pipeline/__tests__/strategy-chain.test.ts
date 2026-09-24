import { describe, it, expect } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";

import type { AuthUserId } from "../../../types/auth";
import { runStrategyChain } from "../strategy-chain";
import type { AuthInput, AuthStrategy } from "../types";

const pass = (name: string): AuthStrategy => ({
  name,
  authenticate: async () => ({ type: "pass" }),
});
const ok = (name: string): AuthStrategy => ({
  name,
  authenticate: async () => ({
    type: "authenticated",
    user: { id: name as AuthUserId, email: `${name}@x.c` },
  }),
});

const input: Omit<AuthInput, "strategyName"> = {
  request: new Request("http://x"),
  body: {},
};

const fails = (name: string): AuthStrategy => ({
  name,
  authenticate: async () => ({ type: "fail", reason: `${name} said no` }),
});

describe("runStrategyChain", () => {
  it("skips pass strategies and returns the first non-pass outcome", async () => {
    const { outcome } = await runStrategyChain(
      [pass("a"), ok("b"), ok("c")],
      input,
      {} as never
    );
    expect(outcome).toMatchObject({ type: "authenticated", user: { id: "b" } });
  });

  it("returns pass when all strategies pass", async () => {
    const { outcome } = await runStrategyChain(
      [pass("a"), pass("b")],
      input,
      {} as never
    );
    expect(outcome.type).toBe("pass");
  });

  it("names the strategy that decided, so the trail can record it", async () => {
    const { strategyName } = await runStrategyChain(
      [pass("a"), ok("b"), ok("c")],
      input,
      {} as never
    );
    expect(strategyName).toBe("b");
  });

  it("names the strategy that failed, not merely the one that succeeded", async () => {
    const { outcome, strategyName } = await runStrategyChain(
      [pass("a"), fails("b")],
      input,
      {} as never
    );
    expect(outcome.type).toBe("fail");
    expect(strategyName).toBe("b");
  });

  it("names nobody when every strategy passed", async () => {
    // Nothing decided, so there is no strategy to attribute the attempt to.
    const { strategyName } = await runStrategyChain(
      [pass("a"), pass("b")],
      input,
      {} as never
    );
    expect(strategyName).toBeNull();
  });

  it("passes each strategy its own strategyName", async () => {
    const seen: string[] = [];
    const recorder = (name: string): AuthStrategy => ({
      name,
      authenticate: async i => {
        seen.push(i.strategyName);
        return { type: "pass" };
      },
    });
    await runStrategyChain([recorder("x"), recorder("y")], input, {} as never);
    expect(seen).toEqual(["x", "y"]);
  });
});

describe("a strategy that THROWS its failure", () => {
  it("attributes the rethrown error to the strategy that threw it", async () => {
    // The built-in password strategy throws its failures rather than
    // returning `fail`, so the rejection reached the login handler naming no
    // method — the most common failed login, unattributed, on the field that
    // exists to answer "which method was tried".
    const throwing: AuthStrategy = {
      name: "password",
      authenticate: () => {
        throw NextlyError.invalidCredentials({
          logContext: { reason: "password-mismatch" },
        });
      },
    };
    await expect(
      runStrategyChain([throwing], {} as never, {} as never)
    ).rejects.toSatisfy((err: unknown) => {
      if (!NextlyError.is(err)) return false;
      return (err.logContext as { strategy?: string }).strategy === "password";
    });
  });

  it("keeps the error's code and context intact while adding the strategy", async () => {
    const throwing: AuthStrategy = {
      name: "password",
      authenticate: () => {
        throw NextlyError.invalidCredentials({
          logContext: { reason: "password-mismatch" },
        });
      },
    };
    await expect(
      runStrategyChain([throwing], {} as never, {} as never)
    ).rejects.toSatisfy((err: unknown) => {
      if (!NextlyError.is(err)) return false;
      const ctx = err.logContext as {
        reason?: string;
        strategy?: string;
      };
      return (
        err.code === "AUTH_INVALID_CREDENTIALS" &&
        ctx.reason === "password-mismatch" &&
        ctx.strategy === "password"
      );
    });
  });

  it("attributes an error with no context by rebuilding it with one", async () => {
    const throwing: AuthStrategy = {
      name: "password",
      authenticate: () => {
        throw NextlyError.invalidCredentials();
      },
    };
    await expect(
      runStrategyChain([throwing], {} as never, {} as never)
    ).rejects.toSatisfy((err: unknown) => {
      if (!NextlyError.is(err)) return false;
      return (
        err.code === "AUTH_INVALID_CREDENTIALS" &&
        (err.logContext as { strategy?: string }).strategy === "password"
      );
    });
  });

  it("does not attribute an error the strategy already attributed", async () => {
    // First attribution wins: the innermost strategy is the one that was
    // running, and a wrapped error reaching a second chain keeps its own.
    const throwing: AuthStrategy = {
      name: "password",
      authenticate: () => {
        throw NextlyError.invalidCredentials({
          logContext: { strategy: "otp" },
        });
      },
    };
    await expect(
      runStrategyChain([throwing], {} as never, {} as never)
    ).rejects.toSatisfy((err: unknown) => {
      if (!NextlyError.is(err)) return false;
      return (err.logContext as { strategy?: string }).strategy === "otp";
    });
  });

  it("passes a non-NextlyError through untouched", async () => {
    // A plugin strategy throwing an ordinary Error is reported as untyped by
    // the failure projection already; the chain wraps nothing it cannot
    // attribute without changing what the projection sees.
    const throwing: AuthStrategy = {
      name: "password",
      authenticate: () => {
        throw new Error("plugin code threw");
      },
    };
    await expect(
      runStrategyChain([throwing], {} as never, {} as never)
    ).rejects.toThrow("plugin code threw");
  });
});
