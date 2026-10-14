/**
 * `@nextlyhq/plugin-accounts/testing`: stand-ins for the helpers core lends
 * the accounts plugin, for tests. Never loaded by the plugin itself.
 *
 * Everything here is `@experimental` until the plugin graduates.
 *
 * @module testing
 */
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
