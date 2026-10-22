/**
 * A queued email that is stored and attempted is reported, not refused, when
 * where it stands cannot be read afterwards.
 *
 * Once the email is stored it may already be sent, and a caller told the
 * queue failed would queue it again under a new id, and so a new key. The
 * read is made to fail here, alone in its file, since the mock replaces it
 * for everything the file imports.
 *
 * @module domains/email/__tests__/queued-send-state-read.integration.test
 */

process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../queued-send", async importActual => {
  const actual = await importActual<typeof import("../queued-send")>();
  return {
    ...actual,
    queuedEmailState: vi.fn(async () => {
      throw new Error("the database is briefly unavailable");
    }),
  };
});

import { definePlugin } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { defineEmailProvider } from "../provider-definition";
import type { EmailProviderAdapter } from "../types";

const calls: Array<Parameters<EmailProviderAdapter["send"]>[0]> = [];
let current: TestNextly | undefined;

afterEach(async () => {
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

describe.each(getConfiguredTestDialects())(
  "a queued email whose state cannot be read after its attempt (%s)",
  dialect => {
    it("is reported waiting, not refused, and sent once", async () => {
      const t = await createTestNextly({
        dialect,
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

      const result = await t.nextly.email.queue({
        to: "a@example.com",
        subject: "Hi",
        html: "<p>x</p>",
      });

      expect(result).toEqual({ id: expect.any(String), state: "waiting" });
      expect(calls).toHaveLength(1);
    });
  }
);
