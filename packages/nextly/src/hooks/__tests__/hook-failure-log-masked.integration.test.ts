/**
 * A hook that fails after its write committed is logged with no full email address outside
 * development and test, on every configured dialect, while an app's own console output is left
 * exactly as the app wrote it.
 *
 * The failure is reported rather than raised (the row is durable), so its log line is the only
 * trace an operator has, and a hook's error commonly quotes the address it was handling: a
 * notification it could not send, a contact it could not sync. The instance boots under the test
 * environment and the write runs under `production`, because masking is decided per line as it
 * is written.
 *
 * Masking is Nextly's, applied where Nextly writes. Nothing patches the global console, so a
 * line the app writes itself reaches it untouched; that is checked here too, against the same
 * booted instance.
 *
 * @module hooks/__tests__/hook-failure-log-masked.integration.test
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { defineCollection, text } from "../../config";
import { registerHook, unregisterHook } from "../../hooks";
import type { HookHandler } from "../../hooks/types";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";

const SLUG = "hook_mask_articles";
const ADDRESS = "john@example.com";

let current: TestNextly | undefined;

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({ slug: SLUG, fields: [text({ name: "title" })] }),
    ],
  });
  return current;
}

function createEntry(t: TestNextly): Promise<{ success: boolean }> {
  const handler = t.getService("collectionsHandler") as unknown as {
    createEntry: (
      params: Record<string, unknown>,
      data: Record<string, unknown>
    ) => Promise<{ success: boolean }>;
  };
  return handler.createEntry(
    { collectionName: SLUG, overrideAccess: true },
    { title: "durable" }
  );
}

/** Every call made to the spy, errors spelled out, as one searchable string. */
function written(spy: { mock: { calls: unknown[][] } }): string {
  return JSON.stringify(spy.mock.calls, (_key, value: unknown) =>
    value instanceof Error
      ? { message: value.message, cause: value.cause, stack: value.stack }
      : value
  );
}

/**
 * Boot, register an after-create hook that throws an error quoting the address, create an
 * entry under `nodeEnv`, and return everything written to `console.error`.
 */
async function hookFailureOutput(
  dialect: TestDialect,
  nodeEnv: string
): Promise<string> {
  const t = await boot(dialect);
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const boom: HookHandler = () => {
    throw new Error(`Could not notify ${ADDRESS}: mailbox unavailable`);
  };
  registerHook("afterCreate", SLUG, boom);
  try {
    vi.stubEnv("NODE_ENV", nodeEnv);
    const created = await createEntry(t);
    // The write stands, so the log line is the only report of the failure.
    expect(created.success).toBe(true);
  } finally {
    unregisterHook("afterCreate", SLUG, boom);
  }
  return written(errors);
}

describe.each(getConfiguredTestDialects())(
  "a post-commit hook failure, logged — %s",
  dialect => {
    it("masks the address in production", async () => {
      const output = await hookFailureOutput(dialect, "production");
      // The control: the failure was logged, naming the hook and its diagnostic.
      expect(output).toContain("afterCreate");
      expect(output).toContain("mailbox unavailable");
      expect(output).not.toContain(ADDRESS);
      expect(output).toContain("j***@example.com");
    });

    it("keeps the address whole in development", async () => {
      expect(await hookFailureOutput(dialect, "development")).toContain(
        ADDRESS
      );
    });

    it("leaves the app's own console output as the app wrote it", async () => {
      await boot(dialect);
      const logs = vi.spyOn(console, "log").mockImplementation(() => {});
      vi.stubEnv("NODE_ENV", "production");
      console.log(`order shipped to ${ADDRESS}`);
      expect(logs).toHaveBeenCalledWith(`order shipped to ${ADDRESS}`);
    });
  }
);
