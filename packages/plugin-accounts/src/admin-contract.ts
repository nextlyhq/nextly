/**
 * What the server and the admin screens agree on: the plugin's names, where
 * its admin pages and staff routes are, what staff may do, and the shapes
 * the staff routes answer with. It imports nothing, so the admin's client
 * bundle reads it without bringing any server code along.
 *
 * @module admin-contract
 */

/** The package's name, under which Nextly records the plugin and serves its routes. */
export const PLUGIN_NAME = "@nextlyhq/plugin-accounts";

/**
 * The plugin's admin slug, which core derives from its name with
 * `pluginAdminSlug`; a unit test holds the two together.
 */
export const ADMIN_SLUG = "nextlyhq-plugin-accounts";

/** The type of {@link ADMIN_PAGES}. */
type AdminPages = {
  readonly list: {
    readonly path: "accounts";
    readonly component: `${typeof PLUGIN_NAME}/admin#AccountsListPage`;
  };
  readonly account: {
    readonly path: "account";
    readonly component: `${typeof PLUGIN_NAME}/admin#AccountPage`;
  };
};

/** The admin's pages: each one's path under the plugin, and the component it renders. */
export const ADMIN_PAGES: AdminPages = {
  list: {
    path: "accounts",
    component: `${PLUGIN_NAME}/admin#AccountsListPage`,
  },
  account: {
    path: "account",
    component: `${PLUGIN_NAME}/admin#AccountPage`,
  },
};

/** Where an admin page is, for a link: the account's page names it by `id`. */
export function adminPageHref(
  page: keyof typeof ADMIN_PAGES,
  accountId?: string
): string {
  const path = `/admin/plugins/${ADMIN_SLUG}/${ADMIN_PAGES[page].path}`;
  return accountId === undefined
    ? path
    : `${path}?id=${encodeURIComponent(accountId)}`;
}

/** Where the staff routes are, under the plugin's own route namespace. */
export const STAFF_API_PATH = "/staff/accounts";

/**
 * What staff may do to an account, and nothing more: they never see or set
 * a password and never sign in as the account, so helping its holder always
 * goes through the holder's email.
 */
export const STAFF_ACTIONS = [
  "deactivate",
  "reactivate",
  "end-sessions",
  "resend-verification",
  "send-reset",
  "delete",
] as const;

export type StaffAction = (typeof STAFF_ACTIONS)[number];

/** Why an action does not apply to the account as it stands. */
export type StaffRefusal =
  | "already-deactivated"
  | "already-active"
  | "already-verified"
  | "deactivated";

/** The states staff filter the list of accounts by. */
export const ACCOUNT_STATES = [
  "verified",
  "unverified",
  "active",
  "deactivated",
  "reset-required",
] as const;

export type AccountState = (typeof ACCOUNT_STATES)[number];

/**
 * An account as staff see it in the list. Never a password, a hash or a
 * token: the server builds it field by field from the row.
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

/** What the list route answers: one page, and whether pages follow or precede it. */
export interface StaffAccountsListBody {
  items: StaffAccountSummary[];
  meta: { page: number; limit: number; hasNext: boolean; hasPrev: boolean };
}

/** What an account's route answers: the account, and whether its reader may act on it. */
export interface StaffAccountBody {
  account: StaffAccountDetail;
  canManage: boolean;
}
