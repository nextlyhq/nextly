import type { PluginContext } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";

import { accounts } from "../plugin";

/** The origin every integration test configures the plugin with. */
export const TEST_ORIGIN = "https://shop.example.com";

/**
 * Boots Nextly on `dialect` with the accounts plugin, for an integration
 * test, and hands back the plugin's own context. Destroy `nextly` after each
 * test.
 */
export async function bootAccounts(
  dialect: TestDialect
): Promise<{ ctx: PluginContext; nextly: TestNextly }> {
  const plugin = accounts({ origin: TEST_ORIGIN });
  let captured: PluginContext | undefined;
  const nextly = await createTestNextly({
    dialect,
    plugins: [
      { ...plugin, init: (ctx: PluginContext) => void (captured = ctx) },
    ],
  });
  if (!captured) {
    await nextly.destroy();
    throw new Error("the plugin's init did not run");
  }

  return { ctx: captured, nextly };
}
