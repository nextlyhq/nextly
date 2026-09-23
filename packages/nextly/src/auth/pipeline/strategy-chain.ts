import { isStrategyName } from "../../domains/audit/audit-log-writer";
import { NextlyError } from "../../errors/nextly-error";
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
 * A thrown strategy error, carrying the strategy that threw it.
 *
 * The built-in password strategy THROWS its failures rather than returning
 * `fail` — the legacy wire shape — so the await rejects before the chain can
 * report who was running, and the login handler's failure row is built from
 * the bare error: the most common failed login (wrong password, lockout,
 * unverified, inactive) named no method, on the exact field added to answer
 * "which method was tried". The name rides the logContext the failure
 * projection already allowlists, so no new path carries it and the error's
 * code, status and public message are unchanged.
 */
function withStrategyAttribution(error: unknown, name: string): unknown {
  if (!NextlyError.is(error) || !isStrategyName(name)) return error;
  if (error.logContext !== undefined) {
    // Already attributed — a wrapped strategy error reaching a second chain,
    // or a strategy that named itself. First attribution wins: the innermost
    // strategy is the one that was running.
    if (isStrategyName(error.logContext.strategy)) return error;
    error.logContext.strategy = name;
    return error;
  }
  return new NextlyError({
    code: error.code,
    statusCode: error.statusCode,
    publicMessage: error.publicMessage,
    ...(error.publicData !== undefined ? { publicData: error.publicData } : {}),
    ...(error.messageKey !== undefined ? { messageKey: error.messageKey } : {}),
    ...(error.logMessage !== undefined ? { logMessage: error.logMessage } : {}),
    logContext: { strategy: name },
    ...(error.cause !== undefined ? { cause: error.cause } : {}),
  });
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
    let outcome: AuthOutcome;
    try {
      outcome = await strategy.authenticate(
        { ...input, strategyName: strategy.name },
        ctx
      );
    } catch (error) {
      throw withStrategyAttribution(error, strategy.name);
    }
    if (outcome.type !== "pass") {
      return { outcome, strategyName: strategy.name };
    }
  }
  return { outcome: { type: "pass" }, strategyName: null };
}
