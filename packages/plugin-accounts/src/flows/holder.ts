import { accountById, type AccountRow } from "../storage/accounts";
import { liveSession, type SessionRow } from "../storage/sessions";

import type { FlowDeps } from "./deps";

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
