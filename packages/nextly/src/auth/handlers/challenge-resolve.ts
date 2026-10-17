import { readOrGenerateRequestId } from "../../api/request-id";
import type { AuditLogWriter } from "../../domains/audit/audit-log-writer";
import { auditReason } from "../../domains/audit/audit-reasons";
import {
  limitStoreUnavailableReason,
  type LimitStore,
} from "../../domains/limits/limit-store";
import { NextlyError } from "../../errors/nextly-error";
import type { RateLimitStore } from "../../middleware/rate-limit";
import type { AuthUser } from "../../types/auth";
import {
  clearPendingCookie,
  presentedPendingToken,
  readPendingCookie,
  setPendingCookie,
} from "../cookies/pending-cookie";
import type { ChallengeRegistry } from "../pipeline/challenge";
import {
  challengeFlowKeys,
  type ChallengeFlow,
} from "../pipeline/challenge-keys";
import {
  mintPendingToken,
  verifyPendingToken,
  MUST_CHANGE_PASSWORD_CHALLENGE,
} from "../pipeline/pending-token";
import {
  SPENT_MARK_GRACE_MS,
  type SpentChallenges,
} from "../pipeline/spent-challenges";

import { limitStoreChallengeBudget } from "./challenge-budget";
import {
  jsonResponse,
  stallResponse,
  csrfRefusal,
  loginFailureResponse,
  recordLoginFailure,
} from "./handler-utils";
import {
  finishResumedSignIn,
  gateAccountForSession,
  type IssueSessionDeps,
} from "./issue-session";

export interface ChallengeResolveDeps extends IssueSessionDeps {
  challengeRegistry: ChallengeRegistry;
  /** Pending-auth token TTL (seconds) for re-issued tokens between attempts. */
  challengeTokenTTL: number;
  /** Max attempts before a challenge fails for good. */
  maxChallengeAttempts: number;
  /**
   * Counts one attempt against a challenge, server-side.
   *
   * The cap cannot be carried in the pending token: minting a replacement does
   * not invalidate the one that was presented, so a caller could resubmit the
   * original `attempts: 0` token after every wrong answer and guess until the
   * TTL expired. Counting against the CHALLENGE makes the cap hold whichever
   * token arrives.
   *
   * Injected so the rule is testable without a store, and defaulted to the
   * shared limiter's counter — a fixed window over a key is exactly what this
   * needs, and a second implementation of one is a second thing to get right.
   */
  countChallengeAttempt?: (
    challengeId: string,
    limit: number,
    windowMs: number
  ) => Promise<{ allowed: boolean }>;
  /**
   * How many attempts a key holds in its window, recording none; `undefined`
   * when the counter cannot tell without recording one.
   *
   * Asked only by `/auth/pending`, to report a flow whose budget is spent as
   * over. Never a probe that counts: recording an attempt to learn the count
   * would spend the budget it reads. Defaulted to the shared limiter's own
   * peek; a caller that injects `countChallengeAttempt` without this one gets
   * `undefined`, because the default would read a different counter.
   */
  peekChallengeAttempts?: (
    key: string,
    windowMs: number
  ) => Promise<number | undefined>;
  /**
   * An app's own store of the earlier `RateLimitStore` contract, when it
   * configured one: it keeps serving the attempt budget, as it serves the rest
   * of auth's limits.
   */
  authRateLimit?: { store?: RateLimitStore };
  /**
   * The limit store the site selected (`rateLimit.store`: memory, or the
   * database every instance shares), where the attempt budget is counted
   * when no store of the earlier contract is configured.
   */
  limitStore?: LimitStore;
  /**
   * The flows a correct answer has settled, kept in the database so a
   * challenge is answered once on every instance, whatever the limit store.
   * Core always supplies it. Absent, from deps assembled by hand, the marks
   * are kept in the rate-limit store as they used to be, so single use holds
   * across instances only where that store is shared.
   */
  spentChallenges?: SpentChallenges;
  allowedOrigins: string[];
  loginStallTimeMs: number;
  auditLog: AuditLogWriter;
  findUserById: (userId: string) => Promise<{
    id: string;
    email: string;
    name: string;
    image: string | null;
    isActive: boolean;
    mustChangePassword: boolean | null;
  } | null>;
}

/**
 * Hand a wrong answer back with a fresh token carrying the next attempt count.
 *
 * Where the token goes depends on how it arrived. A cookie-mode client never
 * sees it — returning it in the body would put it somewhere script can reach —
 * so the re-issued token replaces the cookie instead. Without that the next
 * attempt would replay the old counter and the cap would never bite.
 */
function retryResponse(args: {
  token: string;
  challengeId: string;
  usedCookie: boolean;
  requestId: string;
  challengeTokenTTL: number;
  isProduction: boolean;
}): Response {
  const headers = new Headers({
    "Content-Type": "application/json",
    "x-request-id": args.requestId,
  });
  if (args.usedCookie) {
    headers.append(
      "Set-Cookie",
      setPendingCookie(args.token, args.challengeTokenTTL, args.isProduction)
    );
  }
  // The CANONICAL error envelope, so the retry token survives the trip.
  // This answers 401, and an admin fetcher throws on that before anything
  // reads the body — so a token returned at the top level was discarded and
  // the client went on replaying the token it already had, spending the
  // budget without ever advancing. `parseApiError` exposes `error.data`,
  // which is where a caller can actually reach it.
  return new Response(
    JSON.stringify({
      error: {
        code: "AUTH_INVALID_CREDENTIALS",
        message: "Invalid code.",
        requestId: args.requestId,
        data: {
          status: "challenge",
          challengeType: args.challengeId,
          // Cookie-mode clients never receive it in the body: the re-issued
          // token replaces the cookie in the header above, where script
          // cannot reach it.
          ...(args.usedCookie ? {} : { pendingToken: args.token }),
        },
      },
    }),
    { status: 401, headers }
  );
}

/**
 * Hand back the token that lets a must-change account replace its password.
 *
 * A challenge cleared by an account still holding an admin-set password does
 * not end in a session: it ends here, so the challenge path cannot be used to
 * skip the gate the login path enforces.
 */
async function passwordChangeRequired(
  deps: Pick<
    ChallengeResolveDeps,
    "secret" | "challengeTokenTTL" | "isProduction"
  >,
  args: {
    userId: string;
    strategy?: string;
    requestId: string;
    next?: string;
    usedCookie: boolean;
  }
): Promise<Response> {
  const pendingToken = await mintPendingToken(
    {
      userId: args.userId,
      challengeId: MUST_CHANGE_PASSWORD_CHALLENGE,
      attempts: 0,
      strategy: args.strategy,
      // Carried across. An external login signs its destination into the
      // pending token, and dropping it here sent the account to the dashboard
      // after setting a password instead of the page it asked for. Already
      // sanitized when it was first signed, so it is not re-derived from the
      // request.
      ...(args.next ? { next: args.next } : {}),
    },
    deps.secret,
    deps.challengeTokenTTL
  );
  // Cookie mode keeps its token in the cookie, exactly as the retry path
  // does: the body is somewhere script can reach, and a cookie-mode client
  // has no way to carry a body token across the reload this step survives.
  // Leaving the OLD token in the cookie instead resumed the challenge this
  // answer just settled — the set-password step was reachable once and then
  // stranded, spending the challenge budget on every revisit.
  if (args.usedCookie) {
    return jsonResponse(
      200,
      { status: "password_change_required" },
      {
        "x-request-id": args.requestId,
        "Set-Cookie": setPendingCookie(
          pendingToken,
          deps.challengeTokenTTL,
          deps.isProduction
        ),
      }
    );
  }
  return jsonResponse(
    200,
    { status: "password_change_required", pendingToken },
    { "x-request-id": args.requestId }
  );
}

/**
 * Spend one attempt from this account's budget for this challenge.
 *
 * A PRECONDITION, so it runs before the answer is examined. Counting only
 * wrong answers left the budget unspent by a correct one, and the pending
 * token is a JWT that minting a replacement does not revoke — so replaying the
 * original `attempts: 0` token kept guessing, and whichever guess happened to
 * be right was accepted however many had come before it. Charging every
 * attempt is what makes `maxChallengeAttempts` a cap rather than a display.
 *
 * The count is held server-side because the token's own number is attacker
 * supplied. That number is still carried forward, for a client showing
 * progress, but it is not what enforces anything.
 *
 * A store that cannot be reached, or does not answer in time, refuses the
 * answer with one to try again shortly, before anything is examined: an
 * attempt that could not be counted is never examined uncounted.
 */
async function spendChallengeAttempt(
  deps: AttemptCounterDeps,
  pending: PendingFlow
): Promise<void> {
  let verdict: { allowed: boolean };
  try {
    verdict = await attemptCounter(deps, pending)(
      challengeFlowKeys(deps.secret, pending).budget,
      deps.maxChallengeAttempts,
      deps.challengeTokenTTL * 1000
    );
  } catch (error) {
    // The store's own answer that it could not count, and any failure that
    // is not an application error, are both an uncounted attempt.
    const storeDown =
      limitStoreUnavailableReason(error) !== undefined ||
      !NextlyError.is(error);
    throw storeDown ? budgetUnavailable(error) : error;
  }
  if (!verdict.allowed) {
    // Its own reason, and not a terminal one: a spent budget may be the
    // loser's view of a correct answer still on its way to setting the
    // cookie for the next step, so this refusal leaves the cookie alone.
    // `/auth/pending` reports a spent budget as over, which is what
    // releases the login page.
    throw NextlyError.invalidCredentials({
      logContext: { reason: auditReason("challenge-budget-spent") },
    });
  }
}

/** The refusal owed when the budget's store could not answer. */
function budgetUnavailable(error: unknown): NextlyError {
  return NextlyError.serviceUnavailable({
    publicMessage: "Please try again shortly.",
    logMessage:
      "A two-factor answer was refused: its attempt budget could not be counted.",
    cause: error instanceof Error ? error : undefined,
  });
}

/** What counting against a challenge flow's budget needs. */
type AttemptCounterDeps = Pick<
  ChallengeResolveDeps,
  | "secret"
  | "challengeTokenTTL"
  | "maxChallengeAttempts"
  | "countChallengeAttempt"
  | "peekChallengeAttempts"
  | "authRateLimit"
  | "limitStore"
>;

/** The claims that identify one interrupted login, and when it ends. */
interface PendingFlow extends ChallengeFlow {
  /** When the flow stops being answerable, in seconds since the epoch. */
  flowExpiresAt?: number;
}

/**
 * How long `pending` has left to live, in ms: how long its budget is kept.
 * At least a second, so a flow answered at its very end is still counted.
 */
function flowRemainingMs(pending: PendingFlow, fallbackMs: number): number {
  if (pending.flowExpiresAt === undefined) return fallbackMs;
  return Math.max(1000, pending.flowExpiresAt * 1000 - Date.now());
}

/**
 * The counter a challenge flow's budget is kept in.
 *
 * An app's own store of the earlier `RateLimitStore` contract keeps serving
 * it, as it serves core's other limits. Otherwise the limit store the site
 * selected: memory, or the database, which every instance shares. Never the
 * module-level default limiter when a store is configured: that is this
 * process's memory whatever the install configured, and on several instances
 * the cap was multiplied by their number.
 */
function attemptCounter(
  deps: AttemptCounterDeps,
  pending: PendingFlow
): NonNullable<ChallengeResolveDeps["countChallengeAttempt"]> {
  if (deps.countChallengeAttempt) return deps.countChallengeAttempt;
  const legacy = deps.authRateLimit?.store;
  const selected = deps.limitStore;
  if (legacy === undefined && selected !== undefined) {
    const budget = limitStoreChallengeBudget(selected);
    return (key, limit, windowMs) =>
      budget.spend(key, limit, flowRemainingMs(pending, windowMs));
  }
  return async (key: string, limit: number, windowMs: number) => {
    const { authRateLimiter } = await import("../middleware/rate-limiter");
    return authRateLimiter(legacy).check(key, limit, windowMs);
  };
}

/**
 * How many attempts `key` holds, recording none; `undefined` when that cannot
 * be known.
 *
 * Read from the counter the budget is kept in, so a counter injected without
 * its own peek answers `undefined` rather than the default store's count of a
 * window it never wrote. A failure to read is also `undefined`: the answer is
 * advisory, and every caller keeps the flow resumable when it is not known.
 */
async function peekAttempts(
  deps: AttemptCounterDeps,
  key: string
): Promise<number | undefined> {
  const windowMs = deps.challengeTokenTTL * 1000;
  try {
    if (deps.peekChallengeAttempts) {
      return await deps.peekChallengeAttempts(key, windowMs);
    }
    if (deps.countChallengeAttempt) return undefined;
    const legacy = deps.authRateLimit?.store;
    if (legacy === undefined && deps.limitStore !== undefined) {
      return await limitStoreChallengeBudget(deps.limitStore).spent(key);
    }
    const { authRateLimiter } = await import("../middleware/rate-limiter");
    return await authRateLimiter(legacy).peek(key, windowMs);
  } catch {
    return undefined;
  }
}

/** What reaching the marks needs, whether core supplied them or not. */
type SpentChallengesDeps = Pick<
  ChallengeResolveDeps,
  | "spentChallenges"
  | "authRateLimit"
  | "challengeTokenTTL"
  | "maxChallengeAttempts"
>;

/**
 * Whether the earlier release's mark is kept as well: in the rate-limit
 * store, under the key that release used.
 *
 * Where an app's own store of the earlier contract is configured, instances
 * still on the earlier release read and write that mark there during a
 * rolling upgrade, so this release takes and reads it too, and each refuses a
 * flow the other settled. Deps assembled without the database's marks keep it
 * as their only mark, as they did.
 */
function keepsEarlierMark(deps: SpentChallengesDeps): boolean {
  return (
    deps.authRateLimit?.store !== undefined ||
    deps.spentChallenges === undefined
  );
}

/**
 * The key the earlier release counts a flow's budget under; its settled mark
 * is this with `:settled`. It names the account, as it always did in an
 * app's own store.
 */
function earlierFlowKey(pending: PendingFlow): string {
  return `${pending.userId}:${pending.challengeId}:${pending.flow ?? "0"}`;
}

/** The limiter over the store the earlier mark lives in. */
async function earlierLimiter(deps: SpentChallengesDeps) {
  const { authRateLimiter } = await import("../middleware/rate-limiter");
  return authRateLimiter(deps.authRateLimit?.store);
}

/**
 * Whether the earlier mark says the flow is settled, or its budget is full,
 * as the earlier release leaves it once a flow settles. False where the store
 * cannot tell without recording; such a flow is refused when its budget is
 * spent instead, which settling fills.
 */
async function earlierMarkTaken(
  deps: SpentChallengesDeps,
  pending: PendingFlow
): Promise<boolean> {
  if (!keepsEarlierMark(deps)) return false;
  const limiter = await earlierLimiter(deps);
  const key = earlierFlowKey(pending);
  const windowMs = deps.challengeTokenTTL * 1000;
  const [mark, budget] = await Promise.all([
    limiter.peek(`${key}:settled`, windowMs),
    limiter.peek(key, windowMs),
  ]);
  return (mark ?? 0) >= 1 || (budget ?? 0) >= deps.maxChallengeAttempts;
}

/**
 * Take the earlier mark, as the earlier release did: true for the first
 * caller, false once taken. Then fill the flow's budgets, its earlier one and
 * this release's, so either release refuses a later answer before examining
 * it, even where its store cannot be read without recording.
 */
async function takeEarlierMark(
  deps: SpentChallengesDeps & AttemptCounterDeps,
  pending: PendingFlow
): Promise<boolean> {
  if (!keepsEarlierMark(deps)) return true;
  const limiter = await earlierLimiter(deps);
  const key = earlierFlowKey(pending);
  const windowMs = deps.challengeTokenTTL * 1000;
  if (!(await limiter.check(`${key}:settled`, 1, windowMs)).allowed) {
    return false;
  }
  const count = attemptCounter(deps, pending);
  const budget = challengeFlowKeys(deps.secret, pending).budget;
  // Bounded by the budget: each call records one attempt, so each budget is
  // full after at most `maxChallengeAttempts` of them. Best effort: the mark
  // is what refuses, and a store that fails here has already taken it.
  try {
    for (let i = 0; i < deps.maxChallengeAttempts; i++) {
      const earlier = await limiter.check(
        key,
        deps.maxChallengeAttempts,
        windowMs
      );
      const current = await count(budget, deps.maxChallengeAttempts, windowMs);
      if (!earlier.allowed && !current.allowed) break;
    }
  } catch {
    // The flow is settled whatever the budgets say.
  }
  return true;
}

/**
 * Whether a correct answer already settled the flow: its mark in the
 * database, or the earlier mark wherever that is kept. The one question the
 * resolve path and `/auth/pending` both ask.
 */
async function flowSettled(
  deps: Pick<ChallengeResolveDeps, "secret"> & SpentChallengesDeps,
  pending: PendingFlow
): Promise<boolean> {
  if (deps.spentChallenges) {
    const { mark } = challengeFlowKeys(deps.secret, pending);
    if (await deps.spentChallenges.isSpent(mark)) return true;
  }
  return earlierMarkTaken(deps, pending);
}

/**
 * Whether a flow is over before any answer it presents is examined: its
 * attempt budget is spent, or a correct answer already settled it. Unknown
 * reads as not over: the answer only advises the login page, and the resolve
 * path asks again before it examines anything.
 */
export async function challengeFlowOver(
  deps: AttemptCounterDeps & SpentChallengesDeps,
  pending: PendingFlow
): Promise<boolean> {
  const keys = challengeFlowKeys(deps.secret, pending);
  const count = await peekAttempts(deps, keys.budget);
  if (count !== undefined && count >= deps.maxChallengeAttempts) return true;
  try {
    return await flowSettled(deps, pending);
  } catch {
    return false;
  }
}

/**
 * Refuse a flow a correct answer has already settled, before its budget is
 * spent or its answer examined.
 *
 * The mark is in the database, so a token answered on one instance is
 * refused here on any other, and a replay never reaches the resolver, which
 * is plugin code that may act on what it is given.
 */
async function refuseIfFlowSettled(
  deps: Pick<ChallengeResolveDeps, "secret"> & SpentChallengesDeps,
  pending: PendingFlow
): Promise<void> {
  if (await flowSettled(deps, pending)) {
    throw NextlyError.invalidCredentials({
      logContext: { reason: auditReason("challenge-flow-settled") },
    });
  }
}

/**
 * Settle a flow whose challenge was answered correctly, so its pending token
 * cannot be spent again.
 *
 * The token is a JWT that stays valid until it expires: without this, the
 * same token and answer would mint a second session. The mark is one row in
 * the database, written in a transaction of its own and committed before any
 * session is issued. Its key is unique, so of two answers that are both
 * correct at the same moment, on any instances, exactly one writes it and
 * continues; the other is refused here. Where the earlier mark is kept, it is
 * taken too, and an answer that loses either is refused.
 */
async function settleChallengeFlow(
  deps: Pick<ChallengeResolveDeps, "secret" | "maxChallengeAttempts"> &
    SpentChallengesDeps &
    AttemptCounterDeps,
  pending: PendingFlow & { attempts: number }
): Promise<void> {
  // The flow's lifetime again, now that the resolver has run: an answer let
  // through just before the end may only reach this after it, and a flow
  // past its end never settles, whatever its answer.
  refuseIfFlowExhausted(pending, deps);
  const settled = () =>
    NextlyError.invalidCredentials({
      logContext: { reason: auditReason("challenge-flow-settled") },
    });
  if (deps.spentChallenges) {
    const { mark } = challengeFlowKeys(deps.secret, pending);
    // A grace past the token's end: an answer let through before the end
    // may reach its mark after it, and must still meet this one.
    const keepUntil = (pending.flowExpiresAt ?? 0) * 1000 + SPENT_MARK_GRACE_MS;
    if (!(await deps.spentChallenges.spend(mark, keepUntil))) throw settled();
  }
  if (!(await takeEarlierMark(deps, pending))) throw settled();
}

/**
 * Whether a refusal ended its flow for good, so a cookie-mode flow's pending
 * cookie goes with it.
 *
 * The token still verifies until its TTL expires, so a cookie left behind
 * kept `/auth/pending` reporting a challenge nothing can finish, the login
 * page hiding its other sign-in options behind it. A flow is over when:
 *
 *  - this request settled it and was refused afterwards — by the session
 *    gate, or by a password set since the sign-in — or failed outright: the
 *    flow's mark is written, so no retry can succeed;
 *  - the token's own count or lifetime says so (`terminalChallengeFailure`).
 *
 * Anything else keeps the cookie: a wrong answer replaces it with its retry
 * token, and a transient failure must not throw away an attempt the person
 * still has. A spent budget keeps it too. Its refusal cannot know whether a
 * correct answer holding the last attempt is still on its way to setting the
 * cookie for the next step, and a clear sent now could land after that
 * cookie and erase it. `/auth/pending` answers 204 for a spent budget
 * instead, so the login page shows its other sign-in options without the
 * clear.
 */
function flowOverForGood(err: unknown, settledHere: boolean): boolean {
  if (settledHere) return true;
  return NextlyError.is(err) && terminalChallengeFailure(err);
}

/**
 * Answer a wrong challenge response: one more attempt, or a final refusal.
 *
 * The attempt counter lives in the token rather than in a row, so advancing it
 * means minting a new one — and the strategy has to be carried across, or a
 * second attempt would record the session as coming from the password path
 * whatever actually signed the person in.
 */
async function wrongAnswer(
  deps: Pick<
    ChallengeResolveDeps,
    "secret" | "challengeTokenTTL" | "maxChallengeAttempts" | "isProduction"
  >,
  args: {
    pending: {
      userId: string;
      challengeId: string;
      attempts: number;
      strategy?: string;
      next?: string;
      flow?: string;
      flowExpiresAt?: number;
      passwordUpdatedAt?: number | null;
      sessionEpoch?: number;
    };
    usedCookie: boolean;
    requestId: string;
  }
): Promise<Response> {
  // The budget was already spent by `spendChallengeAttempt` before the answer
  // was examined; this only decides whether to offer another round.
  const nextAttempts = args.pending.attempts + 1;
  if (nextAttempts >= deps.maxChallengeAttempts) {
    throw NextlyError.invalidCredentials({
      logContext: { reason: auditReason("challenge-failed-final") },
    });
  }
  // `next` travels with the retry, as `strategy` does. The re-minted token
  // REPLACES the HttpOnly cookie, so anything dropped here is gone for good:
  // an external login that asked to land somewhere specific lost that
  // destination on the first wrong answer, and the eventual correct one
  // issued a session to the dashboard instead. Only the attempt count changes
  // between rounds — the flow id included, because the retry belongs to the
  // login the first token paused, and its budget with it.
  const reissued = await mintPendingToken(
    {
      userId: args.pending.userId,
      challengeId: args.pending.challengeId,
      attempts: nextAttempts,
      strategy: args.pending.strategy,
      ...(args.pending.next ? { next: args.pending.next } : {}),
      ...(args.pending.flow ? { flow: args.pending.flow } : {}),
      // The ORIGINAL expiry, not a renewed one: the token's TTL refreshes so
      // the holder can keep answering, while the flow's lifetime — the bound
      // the attempt budget is enforced within — stays where the pause set it.
      ...(args.pending.flowExpiresAt !== undefined
        ? { flowExpiresAt: args.pending.flowExpiresAt }
        : {}),
      // The password version the paused sign-in proved, carried unchanged so
      // the session the answer mints is still judged against it.
      ...(args.pending.passwordUpdatedAt !== undefined
        ? { passwordUpdatedAt: args.pending.passwordUpdatedAt }
        : {}),
      ...(args.pending.sessionEpoch !== undefined
        ? { sessionEpoch: args.pending.sessionEpoch }
        : {}),
    },
    deps.secret,
    deps.challengeTokenTTL
  );
  return retryResponse({
    token: reissued,
    challengeId: args.pending.challengeId,
    usedCookie: args.usedCookie,
    requestId: args.requestId,
    challengeTokenTTL: deps.challengeTokenTTL,
    isProduction: deps.isProduction,
  });
}

/**
 * POST /auth/challenge/resolve — complete a multi-step auth challenge (D71).
 *
 * Validates the single-purpose pending-auth token, enforces the attempt cap,
 * dispatches to the challenge definition's `resolve`, and — on success — loads
 * the candidate user and issues the real session via the shared
 * {@link issueSession} path (so the session is identical to a direct login).
 * On a wrong response it re-issues a pending token with an incremented attempt
 * counter until the cap is hit. CSRF + stall + audit mirror the login handler.
 */
export async function handleChallengeResolve(
  request: Request,
  deps: ChallengeResolveDeps
): Promise<Response> {
  const startTime = Date.now();
  const requestId = readOrGenerateRequestId(request);
  // Declared outside the try so the catch can read it: whether the pending
  // token arrived by cookie decides what a terminal failure owes the browser.
  let usedCookie = false;
  // Likewise the method the paused login was using: the account gate and the
  // final refusal raise errors that know nothing about it, and the failure row
  // still has to say which method the attempt belonged to.
  let strategy: string | undefined;
  // Whether this request settled the flow: a refusal raised after the settle
  // ends the flow for good, since its mark refuses every later answer.
  let settledHere = false;

  try {
    const body = (await request.json()) as Record<string, unknown>;

    const refusal = csrfRefusal(request, body, deps, requestId);
    if (refusal) {
      await stallResponse(startTime, deps.loginStallTimeMs);
      return refusal;
    }

    // Body or cookie. An external login redirected the browser here, so its
    // pending token lives in an HttpOnly cookie rather than in a variable the
    // page could have kept — see auth/cookies/pending-cookie.
    const cookieToken = readPendingCookie(request);
    usedCookie = typeof body.pendingToken !== "string" && cookieToken !== null;
    const pendingTokenInput = presentedPendingToken(body, request);
    const challengeResponse = (body.response ?? {}) as Record<string, unknown>;

    let pending;
    try {
      pending = await verifyPendingToken(pendingTokenInput, deps.secret);
    } catch {
      throw NextlyError.invalidCredentials({
        logContext: { reason: auditReason("pending-token-invalid") },
      });
    }

    strategy = pending.strategy;
    refuseIfFlowExhausted(pending, deps);

    // The resolver is plugin code with side effects of its own (a one-time
    // code it consumes, an audit it writes), so it must not run for an
    // account that can no longer sign in: the mint would refuse it after
    // the resolver had already spent something. Before the attempt is
    // spent too — a refusal must leave no mutable rate-limit side effect
    // behind, or an account reactivated while the token still lives finds
    // its budget already burned by refusals it never answered.
    await gateAccountForSession(deps, pending.userId, pending.strategy);

    // A flow already answered goes no further, on whichever instance it was
    // answered: before its budget is spent or its answer reaches the
    // resolver.
    await refuseIfFlowSettled(deps, pending);

    // BEFORE the answer is examined. Spending the budget only on a wrong
    // answer left a correct one free, and a replayed token could therefore
    // keep guessing until one landed.
    await spendChallengeAttempt(deps, pending);

    const result = await deps.challengeRegistry.resolve(
      pending.challengeId,
      { userId: pending.userId, response: challengeResponse },
      deps.pluginCtx
    );

    if (!result.ok) {
      await stallResponse(startTime, deps.loginStallTimeMs);
      // Awaited HERE, inside the try: the last permitted wrong answer is a
      // rejection, and a promise returned un-awaited from a try block settles
      // after the catch below is gone. That refusal would then skip its
      // `login-failed` row and the pending cookie it has to clear.
      const retry = await wrongAnswer(deps, {
        pending,
        usedCookie,
        requestId,
      });
      // Every wrong answer is a failed sign-in attempt, not only the last.
      // Recording only the final refusal left a second factor being guessed
      // with no trace until the budget ran out.
      await recordLoginFailure(
        deps,
        request,
        NextlyError.invalidCredentials({
          logContext: { reason: auditReason("challenge-wrong-answer") },
        }),
        requestId,
        strategy
      );
      return retry;
    }

    // Challenge resolved → load the candidate user and issue the real session.
    // This early check stays: `issueSession` runs the full account-state gate
    // as well, but refusing here keeps this path's response timing and its
    // own audit reason, which the generic gate does not carry.
    const u = await deps.findUserById(pending.userId);
    if (!u || !u.isActive) {
      throw NextlyError.invalidCredentials({
        logContext: { reason: auditReason("challenge-user-missing") },
      });
    }

    // Settled before either continuation below: the pending token is a JWT
    // that stays valid until it expires, so without this a correct answer
    // could be replayed to mint a second session, or a second set-password
    // step, from the same flow.
    await settleChallengeFlow(deps, pending);
    settledHere = true;

    // Forced first-sign-in password change (ASVS 6.4.1) applies here too: a
    // must-change account that clears a post-auth challenge (e.g. 2FA) must
    // still replace its admin-set password before any session is issued, or the
    // challenge path would bypass the gate the login path enforces.
    if (u.mustChangePassword) {
      await stallResponse(startTime, deps.loginStallTimeMs);
      return await passwordChangeRequired(deps, {
        userId: u.id,
        strategy: pending.strategy,
        requestId,
        next: pending.next,
        usedCookie,
      });
    }

    const user: AuthUser = {
      id: u.id as AuthUser["id"],
      email: u.email,
      name: u.name,
      image: u.image,
    };
    return await finishResumedSignIn(
      user,
      deps,
      request,
      requestId,
      pending,
      startTime
    );
  } catch (err) {
    await stallResponse(startTime, deps.loginStallTimeMs);
    await recordLoginFailure(deps, request, err, requestId, strategy);
    const response = loginFailureResponse(err, requestId);
    if (usedCookie && flowOverForGood(err, settledHere)) {
      response.headers.append("Set-Cookie", clearPendingCookie());
    }
    return response;
  }
}

/**
 * Whether an error is a challenge token's own FINAL refusal — its count or
 * lifetime exhausted, or its last permitted wrong answer spent.
 *
 * Not a flow ALREADY SETTLED by a correct answer, and not a spent budget:
 * either can be the loser of two simultaneous answers, and the winner may be
 * setting the cookie for the next step (a forced password change).
 *
 * A narrow test on the audit reason, because that is the identity the throw
 * sites already share and nothing else in this handler's catch should take a
 * cookie from the browser.
 */
function terminalChallengeFailure(err: NextlyError): boolean {
  const reason = err.logContext?.reason;
  return (
    reason === auditReason("challenge-attempts-exhausted") ||
    reason === auditReason("challenge-failed-final")
  );
}

/**
 * The ways a flow is over before its answer is even examined.
 *
 * All refuse identically, because all mean the same thing: no attempt this
 * token presents is spendable. The COUNTER on the token caps replays of a
 * low-attempt mint, the flow's signed LIFETIME caps the window-hopping a
 * renewed token would otherwise allow — each wrong answer re-issues a token
 * with a fresh TTL while the server-side budget ages entries out, so without
 * the fixed end, replaying an old low-attempt token near each window's edge
 * kept one flow guessing far past the configured cap — and a token carrying
 * NO lifetime at all is refused outright: every mint this build makes signs
 * one, so absence means a token nothing here could have produced, and
 * treating it as unlimited would make the absence a bypass rather than an
 * anomaly.
 */
function refuseIfFlowExhausted(
  pending: { attempts: number; flowExpiresAt?: number },
  deps: Pick<ChallengeResolveDeps, "maxChallengeAttempts">
): void {
  if (pending.attempts >= deps.maxChallengeAttempts) {
    throw NextlyError.invalidCredentials({
      logContext: { reason: auditReason("challenge-attempts-exhausted") },
    });
  }
  if (pending.flowExpiresAt === undefined) {
    throw NextlyError.invalidCredentials({
      logContext: { reason: auditReason("pending-token-invalid") },
    });
  }
  if (
    pending.flowExpiresAt !== undefined &&
    Date.now() / 1000 >= pending.flowExpiresAt
  ) {
    throw NextlyError.invalidCredentials({
      logContext: { reason: auditReason("challenge-attempts-exhausted") },
    });
  }
}
