/**
 * C2 / D65 — plugin-contributed email providers + templates, end-to-end.
 *
 * A plugin registers a custom provider `type` (built via the provider registry,
 * replacing core's hardcoded switch) and an email template (seeded idempotently
 * into the DB on boot).
 */
import { afterEach, describe, expect, it } from "vitest";

import { getEmailProviderRegistry } from "../../domains/email/services/email-provider-registry";
import {
  defineEmailProvider,
  toDescriptor,
} from "../../domains/email/provider-definition";
import { NextlyError } from "../../errors";

/** The plugin's own config shape, which must survive into createAdapter. */
interface FakeMailerConfig {
  apiKey: string;
  token?: string;
}
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
        defineEmailProvider<FakeMailerConfig>({
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
          parseConfig: (input: unknown): FakeMailerConfig => {
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
            return {
              apiKey: config.apiKey,
              token:
                typeof config.token === "string" ? config.token : undefined,
            };
          },
          // `config` is FakeMailerConfig here, not a widened record -- which
          // is the whole point of authoring through defineEmailProvider.
          createAdapter: (config: FakeMailerConfig) => ({
            send: async (opts: { to: string; subject: string }) => {
              sent.push({ to: opts.to, subject: opts.subject });
              return { success: true, messageId: `fake-${config.apiKey}` };
            },
          }),
        }),
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

  it("appears in the registry's descriptors, with its fields and no functions", async () => {
    // What the admin will fetch. A definition that never reaches a descriptor
    // is a provider an operator cannot select, which is the state this contract
    // exists to end -- so the descriptor is part of the feature, not a detail.
    current = await createTestNextly({ plugins: [emailPlugin()] });

    const descriptor = getEmailProviderRegistry()
      .list()
      .map(toDescriptor)
      .find(d => d.type === "fake-mailer");

    expect(descriptor).toBeDefined();
    expect(descriptor?.label).toBe("Fake Mailer");
    expect(descriptor?.configFields.map(f => f.name)).toEqual([
      "apiKey",
      "token",
    ]);
    // Nothing callable may cross to a browser.
    expect(JSON.stringify(descriptor)).not.toContain("function");
    expect(descriptor).not.toHaveProperty("parseConfig");
    expect(descriptor).not.toHaveProperty("createAdapter");
  });

  it("does not advertise a connection test it cannot perform", async () => {
    // The fake provider declares no testConnection, so the descriptor must not
    // offer one. Echoing a claimed capability would put a button in the admin
    // that nothing answers.
    current = await createTestNextly({ plugins: [emailPlugin()] });

    const descriptor = getEmailProviderRegistry()
      .list()
      .map(toDescriptor)
      .find(d => d.type === "fake-mailer");

    expect(descriptor?.capabilities.connectionTest).toBe(false);
  });

  it("rejects a provider type too long for the narrowest dialect column", () => {
    // Postgres and MySQL store the type in varchar(50) while SQLite does not
    // bound it, so an over-long id would register, work on SQLite, and fail or
    // truncate elsewhere -- leaving a stored type no registered provider matches.
    expect(() =>
      defineEmailProvider<FakeMailerConfig>({
        type: "x".repeat(51),
        label: "Too Long",
        configFields: [],
        parseConfig: () => ({ apiKey: "k" }),
        createAdapter: () => ({
          send: async () => ({ success: true }),
        }),
      })
    ).toThrow();
  });

  it("reports a third-party parser failure as validation, not as a server fault", async () => {
    // A provider validating with its own library throws that library's error.
    // Unrecognised errors are classified as internal, so without normalisation
    // a caller's malformed configuration returns 500 rather than the validation
    // failure it is.
    const provider = defineEmailProvider<{ apiKey: string }>({
      type: "throws-raw",
      label: "Throws Raw",
      configFields: [],
      parseConfig: () => {
        throw new TypeError("expected string, received number");
      },
      createAdapter: () => ({ send: async () => ({ success: true }) }),
    });

    let caught: unknown;
    try {
      provider.validateConfig({});
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(NextlyError);
    expect((caught as NextlyError).statusCode).toBe(400);
  });

  it("rejects an over-long type at the registry, not only at the helper", async () => {
    // defineEmailProvider is not the only way in: RegisteredEmailProvider is a
    // structural type, so a JavaScript plugin or a hand-built object reaches
    // register() directly. The invariant has to hold at the boundary every
    // provider actually crosses.
    current = await createTestNextly({ plugins: [emailPlugin()] });

    expect(() =>
      getEmailProviderRegistry().register({
        type: "y".repeat(51),
        label: "Hand Built",
        configFields: [],
        validateConfig: () => undefined,
        createAdapterFrom: () => ({
          send: async () => ({ success: true }),
        }),
        hasConnectionTest: false,
      })
    ).toThrow(/TYPE_TOO_LONG/);
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
