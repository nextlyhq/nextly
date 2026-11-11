/**
 * What a form's Settings saves is what the site does, on every dialect: the
 * button text and message reach the public form, one response per network is
 * enforced, the internal note stays in the admin, and an installation that
 * saved its forms before the settings changed reads them as they now mean.
 */
import { definePlugin, type PluginContext } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { createDynamicHandlers } from "nextly/runtime";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { submitForm } from "../handlers/submit-form";
import { formBuilder } from "../plugin";
import { normalizeFormSettings } from "../utils/form-settings";

/** The catch-all's params for a `/api/...` path, as Next.js supplies them. */
function params(...segments: string[]) {
  return { params: Promise.resolve({ params: segments }) };
}

/** The live plugin context, captured by a plugin booted beside the forms. */
function contextProbe(name: string) {
  let captured: PluginContext | undefined;
  const plugin = definePlugin({
    name,
    version: "1.0.0",
    nextly: ">=0.0.0",
    init: context => {
      captured = context;
    },
  });
  return {
    plugin,
    get: (): PluginContext => {
      if (!captured) throw new Error("probe plugin did not initialize");
      return captured;
    },
  };
}

const FIELDS = [{ type: "text", name: "name", label: "Name" }];

/** The settings as the editor saves them: the whole group, every key. */
const SAVED_SETTINGS = {
  submitButtonText: "Save my seat",
  confirmationType: "message",
  successMessage: "You're on the list.",
  oneResponse: "ip",
  honeypotEnabled: false,
  botCheck: "off",
  internalNote: "Lahore meetup, 6 December.",
};

describe("settings saved in Settings", () => {
  let current: TestNextly | undefined;
  afterEach(async () => {
    await current?.destroy();
    current = undefined;
  });

  async function boot() {
    const fb = formBuilder({
      spamProtection: { honeypot: false, recaptcha: { enabled: false } },
    });
    const probe = contextProbe("@test/fb-settings");
    current = await createTestNextly({
      plugins: [fb.plugin, probe.plugin],
      seedPublic: true,
    });
    await current.nextly.create({
      collection: "forms",
      data: { name: "Meetup", slug: "meetup", status: "draft", fields: FIELDS },
    });
    const { items } = await current.nextly.find({ collection: "forms" });
    // Saved as the editor saves: the form's status and its whole settings.
    await current.nextly.update({
      collection: "forms",
      id: (items[0] as { id: string }).id,
      data: { status: "published", settings: SAVED_SETTINGS, _overwrite: true },
    });
    return { fb, probe, handlers: createDynamicHandlers() };
  }

  it("reach the public form: its button text, and the message after submitting", async () => {
    const { handlers } = await boot();

    const read = await handlers.GET(
      new Request("http://localhost/api/forms/meetup"),
      params("forms", "meetup")
    );
    expect(read.status).toBe(200);
    const form = (await read.json()) as { settings: Record<string, unknown> };
    expect(form.settings.submitButtonText).toBe("Save my seat");

    const sent = await handlers.POST(
      new Request("http://localhost/api/forms/meetup/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: { name: "Ada" } }),
      }),
      params("forms", "meetup", "submit")
    );
    expect(sent.status).toBe(201);
    expect(((await sent.json()) as { message: string }).message).toBe(
      "You're on the list."
    );
  });

  it("keep the internal note in the admin", async () => {
    const { handlers } = await boot();

    const read = await handlers.GET(
      new Request("http://localhost/api/forms/meetup"),
      params("forms", "meetup")
    );
    const form = (await read.json()) as { settings: Record<string, unknown> };
    expect(form.settings).not.toHaveProperty("internalNote");

    // Stored all the same, for the people who manage the form.
    const { items } = await current!.nextly.find({ collection: "forms" });
    const stored = items[0] as { settings: Record<string, unknown> };
    expect(stored.settings.internalNote).toBe("Lahore meetup, 6 December.");
  });

  it("enforce one response per network", async () => {
    const { fb, probe } = await boot();
    const submit = () =>
      submitForm(
        {
          formSlug: "meetup",
          data: { name: "Ada" },
          metadata: { ipAddress: "203.0.113.9" },
        },
        { pluginContext: probe.get(), pluginConfig: fb.config }
      );

    expect((await submit()).success).toBe(true);
    const second = await submit();
    expect(second.success).toBe(false);
    expect(second.error).toContain("already submitted");
  });
});

/**
 * Forms saved before the settings changed carry `allowMultipleSubmissions`
 * and `captchaEnabled`, which are no longer written. Each is stored on this
 * dialect as such a form stored it, read back, and read as what it now means.
 */
describe("a form saved before the settings changed", () => {
  const LEGACY = [
    {
      slug: "several",
      stored: { allowMultipleSubmissions: true },
      reads: { oneResponse: "off" },
    },
    {
      slug: "once",
      stored: { allowMultipleSubmissions: false },
      reads: { oneResponse: "ip" },
    },
    {
      slug: "bot-inherit",
      stored: {},
      reads: { oneResponse: "off", botCheck: "default" },
    },
    {
      slug: "bot-on",
      stored: { captchaEnabled: true },
      reads: { botCheck: "recaptcha" },
    },
    {
      slug: "bot-off",
      stored: { captchaEnabled: false },
      reads: { botCheck: "off" },
    },
  ] as const;

  let current: TestNextly | undefined;
  const fb = formBuilder({
    spamProtection: { honeypot: false, recaptcha: { enabled: false } },
  });
  const probe = contextProbe("@test/fb-legacy");

  beforeAll(async () => {
    current = await createTestNextly({ plugins: [fb.plugin, probe.plugin] });
    for (const { slug, stored } of LEGACY) {
      await current.nextly.create({
        collection: "forms",
        data: {
          name: slug,
          slug,
          status: "published",
          fields: FIELDS,
          settings: stored,
        },
      });
    }
  });
  afterAll(async () => {
    await current?.destroy();
    current = undefined;
  });

  it.each(LEGACY)("$slug reads as $reads", async ({ slug, reads }) => {
    const { items } = await current!.nextly.find({
      collection: "forms",
      where: { slug: { equals: slug } },
    });
    const row = items[0] as { settings?: unknown };
    expect(normalizeFormSettings(row.settings)).toMatchObject(reads);
  });

  it("still takes several responses from one network when it allowed them", async () => {
    const submit = () =>
      submitForm(
        {
          formSlug: "several",
          data: { name: "Ada" },
          metadata: { ipAddress: "203.0.113.9" },
        },
        { pluginContext: probe.get(), pluginConfig: fb.config }
      );
    expect((await submit()).success).toBe(true);
    expect((await submit()).success).toBe(true);
  });

  it("still takes one response per network when it did not", async () => {
    const submit = () =>
      submitForm(
        {
          formSlug: "once",
          data: { name: "Ada" },
          metadata: { ipAddress: "203.0.113.10" },
        },
        { pluginContext: probe.get(), pluginConfig: fb.config }
      );
    expect((await submit()).success).toBe(true);
    expect((await submit()).success).toBe(false);
  });
});
