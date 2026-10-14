import { accountById, deleteAccount } from "../storage/accounts";

import type { FlowDeps } from "./deps";
import { PURPOSES } from "./purposes";

export type NotMeResult =
  | { status: "removed" }
  | { status: "refused"; reason: "invalid" | "expired" | "spent" };

/** Ends the removal's transaction with this answer, rolling it back. */
class Refusal extends Error {
  constructor(readonly reason: "invalid" | "expired" | "spent") {
    super(reason);
  }
}

/**
 * "This wasn't me", from a verification email: the address's owner removes
 * an account someone made with their address and nobody verified. The link
 * is spent, every secret of the account voided and the account deleted, in
 * one transaction. An account verified since keeps going: its verification
 * voided this link.
 */
export async function removeUnverifiedAccount(
  deps: FlowDeps,
  input: { token: string }
): Promise<NotMeResult> {
  const { core } = deps;
  try {
    await deps.db.transaction(async tx => {
      const spent = await core.secrets.consumeToken(
        { purpose: PURPOSES.notMe, token: input.token },
        { tx }
      );
      if (!spent.ok) throw new Refusal(spent.reason);
      const account = await accountById(tx, spent.subject);
      if (account === null) throw new Refusal("invalid");
      if (account.verifiedAt !== null) throw new Refusal("spent");
      await core.secrets.voidFor({ subject: account.id }, { tx });
      await deleteAccount(tx, account.id);
    });
  } catch (error) {
    if (error instanceof Refusal)
      return { status: "refused", reason: error.reason };
    throw error;
  }

  return { status: "removed" };
}
