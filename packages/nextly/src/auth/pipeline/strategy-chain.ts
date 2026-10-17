import { z } from "zod";

import { isStrategyName } from "../../domains/audit/audit-log-writer";
import { NextlyError } from "../../errors/nextly-error";
import type { PluginContext } from "../../plugins/plugin-context";
import { withoutRefreshCookie } from "../cookies/refresh-token-cookie";

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
 * invalid credentials). Each strategy is invoked with its own `strategyName`,
 * and receives the request without the refresh cookie.
 */
export async function runStrategyChain(
  strategies: AuthStrategy[],
  input: Omit<AuthInput, "strategyName">,
  ctx: PluginContext
): Promise<StrategyChainResult> {
  const request = await withoutRefreshCookie(input.request);
  for (const strategy of strategies) {
    let outcome: AuthOutcome;
    try {
      outcome = await strategy.authenticate(
        { ...input, request, strategyName: strategy.name },
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

/** A strategy's answer to the limiter, parsed: it comes from app code. */
const limitAnswer = z.discriminatedUnion("handles", [
  z.object({ handles: z.literal(false) }),
  z.object({ handles: z.literal(true), key: z.string().nullable() }),
]);

/**
 * Which strategy decides how a sign-in is limited, and the key it names, or
 * `"unanswerable"` when a strategy that cannot answer is reached first.
 *
 * The strategies are asked in the chain's own order, so the first that
 * handles a request decides, as the first non-`pass` outcome decides who
 * authenticates it. A strategy without `limitKey` could claim the request
 * itself, so once one is reached nothing after it is asked. An answer that
 * throws, rejects or is not an answer is taken as handling the request under
 * no key: the limiter then counts it against the budget shared by requests
 * naming no account, and it never escapes the limiter. A chain in which no
 * strategy handles the request names no key either.
 */
export async function limitKeyFor(
  strategies: readonly AuthStrategy[],
  input: { request: Request; body: Record<string, unknown> }
): Promise<
  { strategy: AuthStrategy | null; key: string | null } | "unanswerable"
> {
  // Headers and address only: the body arrives parsed, and the request's own
  // is left for the handler to read.
  const request = await withoutRefreshCookie(
    new Request(input.request.url, {
      method: input.request.method,
      headers: input.request.headers,
    })
  );
  for (const strategy of strategies) {
    if (!strategy.limitKey) return "unanswerable";
    let answer: unknown;
    try {
      answer = await strategy.limitKey({ request, body: input.body });
    } catch {
      return { strategy, key: null };
    }
    const parsed = limitAnswer.safeParse(answer);
    if (!parsed.success) return { strategy, key: null };
    if (!parsed.data.handles) continue;
    return { strategy, key: parsed.data.key };
  }
  return { strategy: null, key: null };
}
