import type { PluginContext } from "@nextlyhq/plugin-sdk";

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
  options: Partial<AccountsOptions> = {}
): {
  deps: FlowDeps;
  core: FakeAccountsCore;
  mail: FakeAccountsMail;
  warnings: string[];
} {
  const core = fakeAccountsCore();
  const mail = new FakeAccountsMail();
  const warnings: string[] = [];
  const deps: FlowDeps = {
    db: core.watch(ctx.db),
    dialect: ctx.dialect,
    core,
    settings: resolveAccountsSettings({ origin: TEST_ORIGIN, ...options }),
    mail,
    logger: { warn: message => void warnings.push(message) },
    now: () => new Date(core.clock.now()),
  };

  return { deps, core, mail, warnings };
}
