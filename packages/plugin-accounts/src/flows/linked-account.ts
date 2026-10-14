import { accountById, type AccountRow } from "../storage/accounts";

import type { FlowDeps } from "./deps";

/**
 * The account a link from an email names, read without spending the link,
 * or why the link is refused: one never made, past its time, or spent.
 */
export async function linkedAccount(
  deps: Pick<FlowDeps, "db" | "core">,
  purpose: string,
  token: string
): Promise<
  | { status: "found"; account: AccountRow }
  | { status: "refused"; reason: "invalid" | "expired" | "spent" }
> {
  const peeked = await deps.core.secrets.peekToken({ purpose, token });
  if (!peeked.ok) return { status: "refused", reason: peeked.reason };
  const account = await accountById(deps.db, peeked.subject);

  return account === null
    ? { status: "refused", reason: "invalid" }
    : { status: "found", account };
}
