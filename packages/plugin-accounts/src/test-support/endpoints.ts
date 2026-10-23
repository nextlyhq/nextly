import type { TestDialect, TestNextly } from "@nextlyhq/plugin-sdk/testing";
import type { PluginContext } from "nextly";

import { accountsLimitRules } from "../core/limit-rules";
import type { FlowDeps } from "../flows/deps";
import { resolveAccountsSettings } from "../settings";
import type { FakeAccountsCore, FakeAccountsMail } from "../testing";
import { fakeAccountsCore } from "../testing";

import { bootAccounts, TEST_ORIGIN } from "./boot";
import { TestBrowser } from "./browser";
import { flowDeps } from "./flow-deps";

/** What {@link bootEndpoints} resolves to: the booted plugin and the means to drive it. */
type BootedEndpoints = {
  browser: (client?: string) => Promise<TestBrowser>;
  deps: FlowDeps;
  core: FakeAccountsCore;
  mail: FakeAccountsMail;
  warnings: string[];
  pacing: {
    checks: number;
    waits: number;
  };
  emitted: Array<{
    name: string;
    payload: unknown;
  }>;
  ctx: PluginContext;
  nextly: TestNextly;
};

/**
 * Boots Nextly on `dialect` with the accounts plugin for a test that calls
 * the endpoints directly: the flows' deps, their fake mail, and a browser on
 * the site that already holds its CSRF token. The fake clock starts at real
 * time, as the running plugin reads it. Destroy `nextly` after each test.
 */
export async function bootEndpoints(
  dialect: TestDialect
): Promise<BootedEndpoints> {
  const core = fakeAccountsCore({
    start: new Date(),
    rules: accountsLimitRules(resolveAccountsSettings({ origin: TEST_ORIGIN })),
  });
  const booted = await bootAccounts(dialect, { core });
  const made = flowDeps(booted.ctx, {}, core);
  const browser = async (client?: string) => {
    const opened = new TestBrowser(made.deps, client);
    await opened.start();
    return opened;
  };

  return { ctx: booted.ctx, nextly: booted.nextly, ...made, browser };
}
