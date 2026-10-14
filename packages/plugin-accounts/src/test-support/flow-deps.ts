import type { PluginContext } from "@nextlyhq/plugin-sdk";

import { accountsLimitRules } from "../core/limit-rules";
import type { FlowDeps } from "../flows/deps";
import { resolveAccountsSettings, type AccountsOptions } from "../settings";
import { fakeAccountsCore, type FakeAccountsCore } from "../testing/fake-core";
import { FakeAccountsMail } from "../testing/fake-mail";

import { TEST_ORIGIN } from "./boot";

/**
 * A flow's deps for an integration test: the plugin's real database, watched
 * by a fake core that shares the flow's clock, fake mail, and the warnings
 * logged.
 */
export function flowDeps(
  ctx: PluginContext,
  options: Partial<AccountsOptions> = {},
  existing?: FakeAccountsCore
): {
  deps: FlowDeps;
  core: FakeAccountsCore;
  mail: FakeAccountsMail;
  warnings: string[];
  /** How many password checks ran, and how many refusals waited a check's time instead. */
  pacing: { checks: number; waits: number };
  /** Every event the flows emitted, in order. */
  emitted: Array<{ name: string; payload: unknown }>;
} {
  const settings = resolveAccountsSettings({ origin: TEST_ORIGIN, ...options });
  const core =
    existing ?? fakeAccountsCore({ rules: accountsLimitRules(settings) });
  const mail = new FakeAccountsMail();
  const warnings: string[] = [];
  const pacing = { checks: 0, waits: 0 };
  const emitted: Array<{ name: string; payload: unknown }> = [];
  const deps: FlowDeps = {
    db: core.watch(ctx.db),
    dialect: ctx.dialect,
    core,
    settings,
    mail,
    events: { emit: (name, payload) => void emitted.push({ name, payload }) },
    pacer: {
      verify: (password, hash) => {
        pacing.checks += 1;
        return core.passwords.verify(password, hash);
      },
      waitAsLongAsACheck: () => {
        pacing.waits += 1;
        return Promise.resolve();
      },
    },
    logger: { warn: message => void warnings.push(message) },
    now: () => new Date(core.clock.now()),
  };

  return { deps, core, mail, warnings, pacing, emitted };
}
