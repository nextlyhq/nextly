/**
 * C2 / D65 — plugin-contributed email providers + templates, end-to-end.
 *
 * A plugin registers a custom provider `type` (built via the provider registry,
 * replacing core's hardcoded switch) and an email template (seeded idempotently
 * into the DB on boot).
 */
import { afterEach, describe, expect, it } from "vitest";

import { getEmailProviderRegistry } from "../../domains/email/services/email-provider-registry";
import { NextlyError } from "../../errors";
import { runPostInitTasks } from "../../init/post-init-tasks";
import { definePlugin } from "../plugin-context";
import { createTestNextly, type TestNextly } from "../test-nextly";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const sent: Array<{ to: string; subject: string }> = [];

const emailPlugin = () =>
  definePlugin({
    name: "@test/email",
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: {
      emailProviders: [
        {
          type: "fake-mailer",
          label: "Fake Mailer",
          description: "A provider that exists only in this test.",
          capabilities: { attachments: false, replyTo: false },
          configFields: [
            {
              name: "apiKey",
              label: "API Key",
              kind: "password",
              required: true,
              secret: true,
            },
            // Deliberately NOT secret, and deliberately named so the retired
            // key-name heuristic would have masked it. If this value comes back
            // masked, redaction is still guessing rather than reading metadata.
            {
              name: "token",
              label: "Public Token",
              kind: "text",
            },
          ],
          parseConfig: (input: unknown) => {
            const config = input as { apiKey?: unknown; token?: unknown };
            if (typeof config.apiKey !== "string" || config.apiKey === "") {
              throw NextlyError.validation({
                errors: [
                  {
                    path: "configuration.apiKey",
                    code: "INVALID_PROVIDER_CONFIG",
                    message: "API key is required",
                  },
                ],
              });
            }
            return { apiKey: config.apiKey, token: config.token };
          },
          createAdapter: () => ({
            send: async (opts: { to: string; subject: string }) => {
              sent.push({ to: opts.to, subject: opts.subject });
              return { success: true, messageId: "fake-1" };
            },
          }),
        },
      ],
      emailTemplates: [
        {
          slug: "plugin-welcome",
          name: "Plugin Welcome",
          subject: "Hi {{name}}",
          htmlContent: "<p>Hi {{name}}</p>",
        },
      ],
    },
  });

describe("plugin email providers + templates", () => {
  it("registers a contributed provider type", async () => {
    current = await createTestNextly({ plugins: [emailPlugin()] });
    expect(getEmailProviderRegistry().has("fake-mailer")).toBe(true);
  });

  it("stores an instance of it through the product path and sends with it", async () => {
    // The point of this test. Registering a provider was always possible; what
    // was not, is CONFIGURING one -- the REST validator and the service both
    // rejected any type outside a hardcoded union, so the contribution surface
    // could register something nothing could persist. Going through
    // emailProviders.create and then sending proves the whole path, where
    // calling registry.create() directly proves only that a map lookup works.
    sent.length = 0;
    current = await createTestNextly({ plugins: [emailPlugin()] });

    const created = await current.nextly.emailProviders.create({
      data: {
        name: "Fake",
        type: "fake-mailer",
        fromEmail: "from@example.com",
        configuration: { apiKey: "secret-key-value", token: "public-token" },
        isDefault: true,
      },
    });
    expect(created.item.type).toBe("fake-mailer");

    const result = await current.nextly.email.send({
      to: "x@y.com",
      subject: "Hello",
      html: "<p>hi</p>",
    });
    expect(result.success).toBe(true);
    expect(sent).toContainEqual({ to: "x@y.com", subject: "Hello" });
  });

  it("rejects a configuration its own parseConfig refuses", async () => {
    current = await createTestNextly({ plugins: [emailPlugin()] });

    await expect(
      current.nextly.emailProviders.create({
        data: {
          name: "Broken",
          type: "fake-mailer",
          fromEmail: "from@example.com",
          configuration: { token: "no-api-key" },
        },
      })
    ).rejects.toThrow();
  });

  it("rejects a type no plugin registered", async () => {
    current = await createTestNextly({ plugins: [emailPlugin()] });

    await expect(
      current.nextly.emailProviders.create({
        data: {
          name: "Ghost",
          type: "not-installed",
          fromEmail: "from@example.com",
          configuration: {},
        },
      })
    ).rejects.toThrow();
  });

  it("masks what the provider DECLARED secret, and only that", async () => {
    // The negative half is what makes this meaningful: `token` would have been
    // masked by the old key-name heuristic. Asserting only that `apiKey` is
    // hidden would pass equally well against the behaviour this replaced.
    current = await createTestNextly({ plugins: [emailPlugin()] });

    const created = await current.nextly.emailProviders.create({
      data: {
        name: "Fake",
        type: "fake-mailer",
        fromEmail: "from@example.com",
        configuration: { apiKey: "secret-key-value", token: "public-token" },
      },
    });

    const serialized = JSON.stringify(created.item.configuration);
    expect(serialized).not.toContain("secret-key-value");
    expect(created.item.configuration.token).toBe("public-token");
  });

  it("seeds a contributed email template (resolvable by slug, idempotent)", async () => {
    current = await createTestNextly({ plugins: [emailPlugin()] });
    await runPostInitTasks();
    await runPostInitTasks(); // idempotent

    const tpl = await current.nextly.emailTemplates.findBySlug({
      slug: "plugin-welcome",
    });
    expect(tpl).not.toBeNull();
    expect(tpl?.subject).toBe("Hi {{name}}");
  });
});
