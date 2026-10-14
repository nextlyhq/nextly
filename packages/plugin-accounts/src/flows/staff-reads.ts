import { accountById, type AccountRow } from "../storage/accounts";
import {
  accountsPage,
  liveSessionCount,
  type AccountsPageQuery,
} from "../storage/staff-reads";

import type { FlowDeps } from "./deps";

/**
 * An account as staff see it in the list. Built field by field from the
 * row, never by copying it, so no column added to the table later (and no
 * password hash) reaches staff without being named here.
 */
export interface StaffAccountSummary {
  id: string;
  address: string;
  /** Plain text the visitor typed: shown as text, never as markup. */
  name: string;
  verified: boolean;
  active: boolean;
  resetRequired: boolean;
  createdAt: string;
  lastSignedInAt: string | null;
}

/** An account as staff see it on its own page. */
export interface StaffAccountDetail extends StaffAccountSummary {
  verifiedAt: string | null;
  /** How the address was proven: "link", "code" or "reset". */
  verifiedBy: string | null;
  deactivatedAt: string | null;
  resetRequiredAt: string | null;
  passwordChangedAt: string | null;
  /** How many of its sessions are live now. */
  liveSessions: number;
}

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
