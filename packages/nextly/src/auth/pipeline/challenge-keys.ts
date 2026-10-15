/**
 * The keys one interrupted sign-in's challenge is kept under: the mark that
 * makes its answer single-use, and its budget of attempts.
 *
 * Both name an account, so neither is stored as given. Each is an HMAC of the
 * flow, keyed by a value derived from the install's secret for this use
 * alone, and labelled by what it is for, so the mark and the budget of one
 * flow share no value, and neither matches anything else derived from the
 * secret.
 *
 * @module auth/pipeline/challenge-keys
 */
import { createHmac, hkdfSync } from "node:crypto";

/** What this use of the install's secret is called, so its derived key is its own. */
const KEY_INFO = "nextly two-factor challenge keys";

/** The claims that identify one interrupted sign-in. */
export interface ChallengeFlow {
  userId: string;
  challengeId: string;
  flow?: string;
}

/** The keys a flow's challenge is kept under. */
export interface ChallengeFlowKeys {
  /** The spent mark's id: 64 hex characters. */
  mark: string;
  /** The attempt budget's key in the rate-limit store. */
  budget: string;
}

/**
 * The flow as one string: keyed by account, challenge and flow.
 *
 * `challengeId` names the challenge definition ("totp"), so the account keeps
 * every account's flows apart, and the flow id keeps each sign-in apart, so a
 * completed one never draws on the next one's budget. A token from before the
 * flow id existed shares one budget, as every token did then.
 */
function flowName(flow: ChallengeFlow): string {
  return `${flow.userId}\u001f${flow.challengeId}\u001f${flow.flow ?? "0"}`;
}

/**
 * The mark and budget keys of `flow`, under the install's `secret`.
 *
 * An empty secret, which only a development install has, still keys them: by
 * a value derived from nothing, the same on every instance of that install.
 */
export function challengeFlowKeys(
  secret: string,
  flow: ChallengeFlow
): ChallengeFlowKeys {
  const key = Buffer.from(hkdfSync("sha256", secret, "", KEY_INFO, 32));
  const keyed = (purpose: string) =>
    createHmac("sha256", key).update(`${purpose}\u001f${flowName(flow)}`);
  return {
    mark: keyed("mark").digest("hex"),
    budget: `two-factor:${keyed("budget").digest("base64url")}`,
  };
}
