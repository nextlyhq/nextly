import { describe, it, expect } from "vitest";

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
