import { accountById, type AccountRow } from "../storage/accounts";
import { liveSession, type SessionRow } from "../storage/sessions";

import type { FlowDeps } from "./deps";
import {
  attemptPassword,
  type AttemptRefusal,
  type PasswordAttempt,
} from "./password-attempt";

/**
 * The holder a request's session names, for a change only the holder may
 * make: the live session and its account, or null when the session has
 * ended or its account is deactivated. The session is read again after the
 * account, so a change that ended it and moved the version between the two
 * reads is seen: the account is never paired with a session that the
 * version it carries has already ended.
 */
export async function sessionHolder(
  deps: Pick<FlowDeps, "db" | "core" | "now">,
  sessionToken: string
): Promise<{ session: SessionRow; account: AccountRow } | null> {
  const session = await liveSession(
    deps.db,
    deps.core.opaque.hash(sessionToken),
    deps.now()
  );
  if (session === null) return null;
  const account = await accountById(deps.db, session.accountId);
  if (account === null || account.deactivatedAt !== null) return null;
  const still = await liveSession(deps.db, session.tokenHash, deps.now());

  return still === null ? null : { session: still, account };
}

/**
 * The holder of a request's session, with their current password attempted
 * as a sign-in attempt is, for a change only they may make: signed out when
 * the session has ended, or the attempt's refusal.
 */
export async function provenHolder(
  deps: FlowDeps,
  input: {
    sessionToken: string;
    password: string;
    client: string | null;
    knownTokens?: readonly string[];
  }
): Promise<
  | {
      status: "proven";
      session: SessionRow;
      account: AccountRow;
      attempt: Extract<PasswordAttempt, { status: "proven" }>;
      now: Date;
    }
  | { status: "signed-out" }
  | AttemptRefusal
> {
  const holder = await sessionHolder(deps, input.sessionToken);
  if (holder === null) return { status: "signed-out" };
  const now = deps.now();
  const attempt = await attemptPassword(deps, {
    account: holder.account,
    addressKey: holder.account.addressNormalised,
    password: input.password,
    client: input.client,
    knownTokens: input.knownTokens ?? [],
    now,
  });
  if (attempt.status === "refused") return attempt.refusal;

  return { status: "proven", ...holder, attempt, now };
}
