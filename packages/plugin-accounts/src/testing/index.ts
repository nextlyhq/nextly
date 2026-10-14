/**
 * `@nextlyhq/plugin-accounts/testing`: stand-ins for the helpers core lends
 * the accounts plugin, for tests. Never loaded by the plugin itself.
 *
 * Everything here is `@experimental` until the plugin graduates.
 *
 * @module testing
 */
import type { AccountsCore } from "../core/ports";
import { buildAccounts } from "../plugin";
import type { AccountsOptions } from "../settings";

export {
  fakeAccountsCore,
  type FakeAccountsCore,
  type FakeAccountsCoreOptions,
} from "./fake-core";
export { FakeLimiter } from "./fake-limiter";
export { FakeAccountsMail } from "./fake-mail";
export { FakeOpaqueSecrets } from "./fake-opaque";
export { FakePasswordHelper, FakePasswordTooLongError } from "./fake-passwords";
export { FakeOneTimeSecrets, type MintedSecret } from "./fake-secrets";
export { FakeClock, FakeCoreMisuse } from "./fake-transactions";

/**
 * The plugin built on stand-ins for core's helpers, for a site's tests that
 * run before core lends the real ones.
 *
 * @experimental
 */
export function accountsWithCore(
  options: AccountsOptions,
  core: AccountsCore
): ReturnType<typeof buildAccounts> {
  return buildAccounts(options, () => core);
}
