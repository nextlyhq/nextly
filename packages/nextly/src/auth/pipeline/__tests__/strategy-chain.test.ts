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

describe("runStrategyChain", () => {
  it("skips pass strategies and returns the first non-pass outcome", async () => {
    const out = await runStrategyChain(
      [pass("a"), ok("b"), ok("c")],
      input,
      {} as never
    );
    expect(out).toMatchObject({ type: "authenticated", user: { id: "b" } });
  });

  it("returns pass when all strategies pass", async () => {
    const out = await runStrategyChain(
      [pass("a"), pass("b")],
      input,
      {} as never
    );
    expect(out.type).toBe("pass");
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
