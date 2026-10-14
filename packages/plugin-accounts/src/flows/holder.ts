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
 * ended or its account is deactivated.
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

  return account === null || account.deactivatedAt !== null
    ? null
    : { session, account };
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
