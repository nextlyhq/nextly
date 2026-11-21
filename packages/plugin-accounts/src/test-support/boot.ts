import type { PluginContext } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";

import { accounts } from "../plugin";
import type { AccountsOptions } from "../settings";
import { accountsWithCore } from "../testing";
import type { FakeAccountsCore } from "../testing/fake-core";

/** The origin every integration test configures the plugin with. */
export const TEST_ORIGIN = "https://shop.example.com";

/**
 * Boots Nextly on `dialect` with the accounts plugin, for an integration
 * test, and hands back the plugin's own context. The plugin starts as a
 * site's does, with the site's `settings` beside the test origin, built on
 * `core` when one is given, beside the site's own `collections` when some
 * are given. Destroy `nextly` after each test.
 */
export async function bootAccounts(
  dialect: TestDialect,
  options: {
    core?: FakeAccountsCore;
    /** The site's options beside the test origin. */
    settings?: Omit<AccountsOptions, "origin">;
    /** The site's own collections, booted beside the plugin. */
    collections?: NonNullable<
      Parameters<typeof createTestNextly>[0]
    >["collections"];
  } = {}
): Promise<{ ctx: PluginContext; nextly: TestNextly }> {
  const settings: AccountsOptions = {
    ...options.settings,
    origin: TEST_ORIGIN,
  };
  const plugin =
    options.core === undefined
      ? accounts(settings)
      : accountsWithCore(settings, options.core);
  let captured: PluginContext | undefined;
  const nextly = await createTestNextly({
    dialect,
    ...(options.collections === undefined
      ? {}
      : { collections: options.collections }),
    plugins: [
      {
        ...plugin,
        init: async (ctx: PluginContext) => {
          await plugin.init?.(ctx);
          captured = ctx;
        },
      },
    ],
  });
  if (!captured) {
    await nextly.destroy();
    throw new Error("the plugin's init did not run");
  }

  return { ctx: captured, nextly };
}
