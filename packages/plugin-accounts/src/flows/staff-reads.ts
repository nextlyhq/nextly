import type {
  StaffAccountDetail,
  StaffAccountSummary,
} from "../admin-contract";
import { accountById, type AccountRow } from "../storage/accounts";
import {
  accountsPage,
  liveSessionCount,
  type AccountsPageQuery,
} from "../storage/staff-reads";

import type { FlowDeps } from "./deps";

/** One page of the list, and whether another follows. */
export interface StaffAccountsPage {
  items: StaffAccountSummary[];
  page: number;
  perPage: number;
  hasNext: boolean;
}

export async function listAccountsForStaff(
  deps: Pick<FlowDeps, "db">,
  query: AccountsPageQuery
): Promise<StaffAccountsPage> {
  const { rows, hasNext } = await accountsPage(deps.db, query);

  return {
    items: rows.map(staffSummary),
    page: query.page,
    perPage: query.perPage,
    hasNext,
  };
}

/** The account's page, or null when there is no such account. */
export async function accountForStaff(
  deps: Pick<FlowDeps, "db" | "now">,
  id: string
): Promise<StaffAccountDetail | null> {
  const account = await accountById(deps.db, id);
  if (account === null) return null;

  return {
    ...staffSummary(account),
    verifiedAt: isoOrNull(account.verifiedAt),
    verifiedBy: account.verifiedBy,
    deactivatedAt: isoOrNull(account.deactivatedAt),
    resetRequiredAt: isoOrNull(account.resetRequiredAt),
    passwordChangedAt: isoOrNull(account.passwordChangedAt),
    liveSessions: await liveSessionCount(deps.db, account.id, deps.now()),
  };
}

function staffSummary(account: AccountRow): StaffAccountSummary {
  return {
    id: account.id,
    address: account.address,
    name: account.name,
    verified: account.verifiedAt !== null,
    active: account.deactivatedAt === null,
    resetRequired: account.resetRequiredAt !== null,
    createdAt: account.createdAt.toISOString(),
    lastSignedInAt: isoOrNull(account.lastSignedInAt),
  };
}

function isoOrNull(at: Date | null): string | null {
  return at === null ? null : at.toISOString();
}
