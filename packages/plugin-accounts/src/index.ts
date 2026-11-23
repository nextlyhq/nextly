/**
 * `@nextlyhq/plugin-accounts`: site accounts for Nextly.
 *
 * Everything here is `@experimental` until the plugin graduates.
 *
 * @module index
 */
export { accountsError, type AccountsErrorCode } from "./errors";
export type { InvitationData } from "./flows/invitations";
export type { SignedInAccount } from "./flows/sessions";
export type { CookieWrite } from "./http/cookies";
export { accounts } from "./plugin";
export type {
  AcceptedInvitation,
  AccountCookie,
  AccountCookieChange,
  AccountOutcome,
  AccountsServer,
  AccountVisitor,
  ConfirmAddressChangeInput,
  InvitationIssued,
  VerifyAddressInput,
} from "./server/contract";
export { accountsServer, accountsServices } from "./server/installed";
export {
  resolveAccountsSettings,
  type AccountsOptions,
  type AccountsSettings,
} from "./settings";
