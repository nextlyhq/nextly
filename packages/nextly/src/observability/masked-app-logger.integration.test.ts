/**
 * A logger an app gives Nextly receives no full email address from the
 * services outside development and test, on every configured dialect.
 *
 * Every service is handed the logger the app supplied, so masking only the
 * email services, or only the fallback console logger, would leave every
 * other service's lines whole. The user service names the address it was
 * asked to sign in when the sign-in fails, which makes it the line to watch:
 * driven through a booted instance with the app's own logger, what reaches
 * that logger is what is checked.
 *
 * The instance boots under the test environment and the sign-in runs under
 * `production`, because masking is decided per line as it is written.
 *
 * @module observability/masked-app-logger.integration.test
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../plugins/test-nextly";
import type { Logger } from "../services/shared";

const ADDRESS = "john@example.com";

let current: TestNextly | undefined;

afterEach(async () => {
  vi.unstubAllEnvs();
  await current?.destroy();
  current = undefined;
});

/**
 * Boot with the app's own logger, fail a sign-in for the address under
 * `nodeEnv`, and return everything the sign-in wrote to that logger.
 */
async function failedSignInOutput(
  dialect: TestDialect,
  nodeEnv: string
): Promise<string> {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  current = await createTestNextly({
    dialect,
    logger: logger satisfies Logger,
  });

  // Only what the sign-in writes is searched, not the boot.
  for (const fn of Object.values(logger)) fn.mockClear();
  vi.stubEnv("NODE_ENV", nodeEnv);

  await expect(
    current.getService("userService").authenticate(ADDRESS, "not-the-password")
  ).rejects.toThrow();

  // The control: the sign-in reached the app's logger at all.
  expect(logger.warn).toHaveBeenCalled();
  return JSON.stringify(Object.values(logger).flatMap(fn => fn.mock.calls));
}

describe.each(getConfiguredTestDialects())(
  "the app's own logger, from a failed sign-in — %s",
  dialect => {
    it("receives the address masked in production", async () => {
      const written = await failedSignInOutput(dialect, "production");
      expect(written).not.toContain(ADDRESS);
      expect(written).toContain("j***@example.com");
    });

    it("receives the address whole in development", async () => {
      expect(await failedSignInOutput(dialect, "development")).toContain(
        ADDRESS
      );
    });
  }
);
