import type { PluginContext } from "../../plugins/plugin-context";

import type { AuthInput, AuthOutcome, AuthStrategy } from "./types";

/**
 * @experimental Run auth strategies in declared order; the first to return a
 * non-`pass` outcome wins (WordPress `authenticate`-chain semantics, typed).
 * Returns `pass` when every strategy passes (the handler then treats that as
 * invalid credentials). Each strategy is invoked with its own `strategyName`.
 */
export async function runStrategyChain(
  strategies: AuthStrategy[],
  input: Omit<AuthInput, "strategyName">,
  ctx: PluginContext
): Promise<AuthOutcome> {
  for (const strategy of strategies) {
    const outcome = await strategy.authenticate(
      { ...input, strategyName: strategy.name },
      ctx
    );
    if (outcome.type !== "pass") return outcome;
  }
  return { type: "pass" };
}
