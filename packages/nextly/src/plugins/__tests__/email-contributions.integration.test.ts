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
        defineEmailProvider<{ secondKey: string }>({
          type: "second-mailer",
          label: "Second Mailer",
          configFields: [
            {
              name: "secondKey",
              label: "Second Key",
              kind: "password",
              required: true,
              secret: true,
            },
          ],
          parseConfig: (input: unknown) => {
            const config = input as { secondKey?: unknown };
            if (typeof config.secondKey !== "string" || !config.secondKey) {
              throw NextlyError.validation({
                errors: [
                  {
                    path: "configuration.secondKey",
                    code: "INVALID_PROVIDER_CONFIG",
                    message: "Second key is required",
                  },
                ],
              });
            }
            return { secondKey: config.secondKey };
          },
          createAdapter: () => ({
            send: async () => ({ success: true, messageId: "second-1" }),
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

    expect(
      () =>
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
      // Asserts the shared factory, not a message: both boundaries report this
      // invariant through one NextlyError so they cannot describe it differently.
    ).toThrow(NextlyError);
  });

  it("validates a type CHANGE against the new type, not the stored one", async () => {
    // `data.type` is applied on update, so a provider can move from one type to
    // another. Validating the merged configuration against the STORED type
    // would check smtp's rules and store the row as resend -- accepted here and
    // unusable at send time.
    current = await createTestNextly({ plugins: [emailPlugin()] });

    const created = await current.nextly.emailProviders.create({
      data: {
        name: "Fake",
        type: "fake-mailer",
        fromEmail: "from@example.com",
        configuration: { apiKey: "k", token: "t" },
      },
    });

    await expect(
      current.nextly.emailProviders.update({
        id: created.item.id,
        data: { type: "not-installed" },
      })
    ).rejects.toThrow();
  });

  it("masks everything when a provider declares no field metadata", async () => {
    // An empty configFields list is an ABSENCE of information, not a statement
    // that nothing is secret -- a provider can still store credentials without
    // describing them. Reading the empty list as permission would expose them.
    current = await createTestNextly({ plugins: [emailPlugin()] });

    getEmailProviderRegistry().register({
      type: "no-metadata",
      label: "No Metadata",
      configFields: [],
      validateConfig: () => undefined,
      createAdapterFrom: () => ({ send: async () => ({ success: true }) }),
      hasConnectionTest: false,
    });

    const created = await current.nextly.emailProviders.create({
      data: {
        name: "Opaque",
        type: "no-metadata",
        fromEmail: "from@example.com",
        configuration: { anythingAtAll: "sensitive-value" },
      },
    });

    expect(JSON.stringify(created.item.configuration)).not.toContain(
      "sensitive-value"
    );
  });

  it("still SENDS for a test, and only probes when explicitly asked", async () => {
    // The REST route reports a dispatched message and the admin tells the
    // operator to check that inbox. Substituting a probe would have returned
    // success with nothing sent -- a silent change to what "Send Test" means.
    sent.length = 0;
    current = await createTestNextly({ plugins: [emailPlugin()] });

    const created = await current.nextly.emailProviders.create({
      data: {
        name: "Fake",
        type: "fake-mailer",
        fromEmail: "from@example.com",
        configuration: { apiKey: "k", token: "t" },
      },
    });

    await current.nextly.emailProviders.test({
      id: created.item.id,
      to: "probe@example.com",
    });

    expect(sent).toContainEqual({
      to: "probe@example.com",
      subject: "Nextly — Test Email",
    });
  });

  it("switches provider type with the SUBMITTED configuration, not the old one", async () => {
    // The admin's supported flow: change type and supply the new provider's
    // credentials in the same edit. Validating the STORED configuration here
    // fails every real switch, because the submitted key is exactly what the
    // previous shape lacked.
    current = await createTestNextly({ plugins: [emailPlugin()] });

    const created = await current.nextly.emailProviders.create({
      data: {
        name: "Switcher",
        type: "fake-mailer",
        fromEmail: "from@example.com",
        configuration: { apiKey: "original", token: "t" },
      },
    });

    const updated = await current.nextly.emailProviders.update({
      id: created.item.id,
      data: {
        type: "second-mailer",
        configuration: { secondKey: "brand-new" },
      },
    });

    expect(updated.item.type).toBe("second-mailer");
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
