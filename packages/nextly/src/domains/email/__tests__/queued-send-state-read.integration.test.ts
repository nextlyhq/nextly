/**
 * Once a queued email is stored, `queue` resolves: it may already be sent,
 * and a caller told the queue failed would queue it again under a new id,
 * and so a new key.
 *
 * Shown where the first attempt cannot start and where its state cannot be
 * read afterwards, each with a logger that throws. Both are made to fail
 * here, alone in this file, since a module mock replaces them for everything
 * the file imports.
 *
 * @module domains/email/__tests__/queued-send-state-read.integration.test
 */

process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it, vi } from "vitest";

/** Which of the two steps after storing fails in this test. */
const failing = { stateRead: false, firstAttempt: false };

vi.mock("../queued-send", async importActual => {
  const actual = await importActual<typeof import("../queued-send")>();
  return {
    ...actual,
    queuedEmailState: vi.fn(
      async (...args: Parameters<typeof actual.queuedEmailState>) => {
        if (failing.stateRead) {
          throw new Error("the database is briefly unavailable");
        }
        return actual.queuedEmailState(...args);
      }
    ),
  };
});

vi.mock("../../jobs/jobs-runner", async importActual => {
  const actual = await importActual<typeof import("../../jobs/jobs-runner")>();
  return {
    ...actual,
    runJobNow: vi.fn(async (...args: Parameters<typeof actual.runJobNow>) => {
      if (failing.firstAttempt) throw new Error("the runner is unavailable");
      return actual.runJobNow(...args);
    }),
  };
});

import { definePlugin } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { Logger } from "../../../shared/types";
import { defineEmailProvider } from "../provider-definition";
import type { EmailProviderAdapter } from "../types";

const calls: Array<Parameters<EmailProviderAdapter["send"]>[0]> = [];
let current: TestNextly | undefined;

/** Throws on every warning once armed, after the boot has finished. */
const broken = { armed: false };
const logger: Logger = {
  debug() {},
  info() {},
  warn() {
    if (broken.armed) throw new Error("the logger is broken");
  },
  error() {},
};

afterEach(async () => {
  broken.armed = false;
  failing.stateRead = false;
  failing.firstAttempt = false;
  await current?.destroy();
  current = undefined;
  calls.length = 0;
});

const capturing = defineEmailProvider<Record<string, never>>({
  type: "capturing-state-read",
  label: "Capturing",
  configFields: [],
  parseConfig: () => ({}),
  createAdapter: () => ({
    send: async options => {
      calls.push(options);
      return { success: true, messageId: "captured" };
    },
  }),
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  const t = await createTestNextly({
    dialect,
    logger,
    plugins: [
      definePlugin({
        name: "mailer",
        version: "1.0.0",
        nextly: ">=0.0.0",
        contributes: { emailProviders: [capturing] },
      } as never),
    ],
  });
  current = t;
  await t.nextly.emailProviders.create({
    data: {
      name: "Capturing",
      type: "capturing-state-read",
      fromEmail: "provider@example.com",
      configuration: {},
      isDefault: true,
    },
  });
  broken.armed = true;
  return t;
}

const message = { to: "a@example.com", subject: "Hi", html: "<p>x</p>" };

describe.each(getConfiguredTestDialects())(
  "a queued email once it is stored (%s)",
  dialect => {
    it("is reported waiting, not refused, when its state cannot be read after its attempt", async () => {
      const t = await boot(dialect);
      failing.stateRead = true;

      const result = await t.nextly.email.queue(message);

      expect(result).toEqual({ id: expect.any(String), state: "waiting" });
      expect(calls).toHaveLength(1);
    });

    it("is reported waiting, not refused, when its first attempt cannot start", async () => {
      const t = await boot(dialect);
      failing.firstAttempt = true;

      const result = await t.nextly.email.queue(message);

      expect(result).toEqual({ id: expect.any(String), state: "waiting" });
      expect(calls).toEqual([]);
    });
  }
);
