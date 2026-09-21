import type { PluginContext } from "../../plugins/plugin-context";

import type { AuthInput, AuthOutcome, AuthStrategy } from "./types";

/** What the chain decided, and which strategy decided it. */
export interface StrategyChainResult {
  outcome: AuthOutcome;
  /**
   * The strategy that returned a non-`pass` outcome, or null when every
   * strategy passed and therefore nothing decided. The audit trail records it,
   * so a login can be read as "by which method" rather than only "succeeded".
   */
  strategyName: string | null;
}

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
): Promise<StrategyChainResult> {
  for (const strategy of strategies) {
    const outcome = await strategy.authenticate(
      { ...input, strategyName: strategy.name },
      ctx
    );
    if (outcome.type !== "pass") {
      return { outcome, strategyName: strategy.name };
    }
  }
  return { outcome: { type: "pass" }, strategyName: null };
}
