import type { PluginDatabase } from "@nextlyhq/plugin-sdk";

import { coreOnContext } from "../core/adapter";
import type { AccountsCore, LimitRule } from "../core/ports";

import { FakeLimiter } from "./fake-limiter";
import { FakeOpaqueSecrets } from "./fake-opaque";
import { FakePasswordHelper } from "./fake-passwords";
import { FakeOneTimeSecrets } from "./fake-secrets";
import { FakeClock, FakeTransactions } from "./fake-transactions";

export interface FakeAccountsCoreOptions {
  /** The limit rules the plugin declares, by name. */
  rules?: Readonly<Record<string, LimitRule>>;
  /** Whether the limiter's store is shared, and whether the site declared one instance. */
  store?: { shared: boolean; singleInstance: boolean };
  /** When the fake clock starts. */
  start?: Date;
}

export interface FakeAccountsCore extends AccountsCore {
  readonly clock: FakeClock;
  readonly passwords: FakePasswordHelper;
  readonly secrets: FakeOneTimeSecrets;
  readonly opaque: FakeOpaqueSecrets;
  readonly limits: FakeLimiter;
  /** The helpers where core hangs them on the plugin context. */
  readonly context: object;
  /**
   * The database, with its transactions watched, so the fakes hold the
   * plugin to core's transaction rules. Hand the plugin this, not the
   * database itself.
   */
  watch<D extends Pick<PluginDatabase, "transaction">>(db: D): D;
}

/**
 * Stand-ins for the helpers core lends the accounts plugin, sharing one
 * clock: core's bounds and answers, kept in memory, for tests that run
 * without the core that will lend the real ones.
 *
 * @experimental
 */
export function fakeAccountsCore(
  options: FakeAccountsCoreOptions = {}
): FakeAccountsCore {
  const clock = new FakeClock(options.start);
  const transactions = new FakeTransactions();
  const core = {
    passwords: new FakePasswordHelper(),
    secrets: new FakeOneTimeSecrets(clock, transactions),
    opaque: new FakeOpaqueSecrets(),
    limits: new FakeLimiter(
      clock,
      transactions,
      options.rules ?? {},
      options.store
    ),
  };

  return {
    ...core,
    clock,
    context: coreOnContext(core),
    watch: db => transactions.watch(db),
  };
}
