import { eq } from "@nextlyhq/plugin-sdk/db";

import { pendingAddressChanges } from "../schema/tables";

import type { AccountsDb } from "./accounts";

/** Cancels the account's pending address change, if it has one. Answers whether it had. */
export async function cancelPendingAddressChange(
  db: AccountsDb,
  accountId: string
): Promise<boolean> {
  const columns = db.table(pendingAddressChanges);

  return (
    (await db
      .delete(pendingAddressChanges)
      .where(eq(columns.accountId, accountId))) > 0
  );
}
