/**
 * `@nextlyhq/plugin-accounts`: site accounts for Nextly.
 *
 * Everything here is `@experimental` until the plugin graduates.
 *
 * @module index
 */
export { accountsError, type AccountsErrorCode } from "./errors";
export {
  resolveAccountsSettings,
  type AccountsOptions,
  type AccountsSettings,
} from "./settings";
