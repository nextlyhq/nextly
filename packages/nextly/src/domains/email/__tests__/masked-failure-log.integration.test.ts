/**
 * A failed send whose provider error quotes the recipient, through a booted
 * Nextly on every configured dialect, logs no full address outside
 * development and test.
 *
 * SMTP servers and email APIs commonly name the rejected address in their
 * error ("550 5.1.1 <john@example.com>: user unknown"). Here the provider is a
 * plugin's, stored as the default through the Direct API, and the send goes
 * through `nextly.email.send` as an app's would. What is searched is
 * everything the send wrote: to the logger the app gave Nextly and to the
 * console.
 *
 * The instance boots under the test environment and the send runs under
 * `production`, because masking is decided per line as it is written.
 *
 * @module domains/email/__tests__/masked-failure-log.integration.test
 */

// Read through the env proxy when the delivery is recorded and the provider
// stored: set before either is imported. A throwaway value, made for this file.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it, vi } from "vitest";

import { definePlugin } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { Logger } from "../../../services/shared";
import { defineEmailProvider } from "../provider-definition";

const RECIPIENT = "john@example.com";

const bouncing = definePlugin({
  name: "bouncing-mailer",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    emailProviders: [
      defineEmailProvider({
        type: "bouncing-mailer",
        label: "Bouncing Mailer",
        configFields: [],
        parseConfig: () => ({}),
        createAdapter: () => ({
          send: () =>
            Promise.reject(
              new Error("Delivery refused", {
                cause: new Error(`550 5.1.1 <${RECIPIENT}>: user unknown`),
              })
            ),
        }),
      }),
    ],
  },
});

let current: TestNextly | undefined;

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await current?.destroy();
  current = undefined;
});

/** Every call made to the given functions, as one searchable string. */
function captured(
  fns: ReadonlyArray<{ mock: { calls: unknown[][] } }>
): string {
  return JSON.stringify(
    fns.flatMap(fn => fn.mock.calls),
    (_key, value: unknown) =>
      value instanceof Error
        ? { message: value.message, cause: value.cause, stack: value.stack }
        : value
  );
}

/**
 * Boot with the bouncing provider as the default, send to the recipient under
 * `nodeEnv`, and return everything the send wrote to the app's logger and to
 * the console.
 */
async function failedSendOutput(
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
    plugins: [bouncing],
    logger: logger satisfies Logger,
  });
  await current.nextly.emailProviders.create({
    data: {
      name: "Bouncing",
      type: "bouncing-mailer",
      fromEmail: "orders@shop.example",
      configuration: {},
      isDefault: true,
    },
  });

  // Only what the send writes is searched, not the boot.
  for (const fn of Object.values(logger)) fn.mockClear();
  const consoleWrites = (
    ["debug", "info", "warn", "error", "log"] as const
  ).map(method => vi.spyOn(console, method).mockImplementation(() => {}));
  vi.stubEnv("NODE_ENV", nodeEnv);

  const result = await current.nextly.email.send({
    to: RECIPIENT,
    subject: "Your order",
    html: "<p>Thanks</p>",
  });
  expect(result.success).toBe(false);

  return captured([...Object.values(logger), ...consoleWrites]);
}

describe.each(getConfiguredTestDialects())(
  "a failed send that quotes the recipient — %s",
  dialect => {
    it("logs the failure with the address masked in production", async () => {
      const written = await failedSendOutput(dialect, "production");
      // The control: the failure was logged, and its diagnostic survived.
      expect(written).toContain("email.failed");
      expect(written).toContain("user unknown");
      expect(written).not.toContain(RECIPIENT);
      expect(written).toContain("j***@example.com");
    });

    it("logs the address whole in development", async () => {
      expect(await failedSendOutput(dialect, "development")).toContain(
        RECIPIENT
      );
    });
  }
);
