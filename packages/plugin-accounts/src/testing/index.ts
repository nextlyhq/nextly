/**
 * `@nextlyhq/plugin-accounts/testing`: stand-ins for the helpers core lends
 * the accounts plugin, for tests. Never loaded by the plugin itself.
 *
 * Everything here is `@experimental` until the plugin graduates.
 *
 * @module testing
 */
import { buildAccounts } from "../plugin";
import type { AccountsOptions } from "../settings";

import type { FakeAccountsCore } from "./fake-core";

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
  core: FakeAccountsCore
): ReturnType<typeof buildAccounts> {
  // The stand-ins hold the plugin to core's transaction rules only on a
  // database they watch, so the started plugin is handed that view.
  return buildAccounts(
    options,
    () => core,
    ctx => core.watch(ctx.db)
  );
}
