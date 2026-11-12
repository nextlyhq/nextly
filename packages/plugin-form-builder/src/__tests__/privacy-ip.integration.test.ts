/**
 * A form that keeps no IP address or browser, on every dialect: its new
 * submissions store neither, while one per network still refuses a network
 * that has responded, by the keyed digest made before the address is
 * dropped. A form that keeps them stores both.
 */
import { definePlugin, type PluginContext } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { submitForm } from "../handlers/submit-form";
import { formBuilder } from "../plugin";

const FIELDS = [{ type: "email", name: "email", label: "Email" }];

describe.each(getConfiguredTestDialects())("a form's privacy (%s)", dialect => {
  let current: TestNextly | undefined;
  afterEach(async () => {
    await current?.destroy();
    current = undefined;
  });

  async function boot(settings: Record<string, unknown>) {
    const fb = formBuilder({
      spamProtection: { honeypot: false, recaptcha: { enabled: false } },
    });
    let probe: PluginContext | undefined;
    current = await createTestNextly({
      dialect,
      plugins: [
        fb.plugin,
        definePlugin({
          name: "@test/fb-privacy-probe",
          version: "1.0.0",
          nextly: ">=0.0.0",
          init: ctx => {
            probe = ctx;
          },
        }),
      ],
    });
    await current.nextly.create({
      collection: "forms",
      data: {
        name: "Meetup",
        slug: "meetup",
        status: "published",
        fields: FIELDS,
        settings,
      },
    });
    const submit = (email: string, ipAddress: string) =>
      submitForm(
        {
          formSlug: "meetup",
          data: { email },
          metadata: { ipAddress, userAgent: "Mozilla/5.0 (Test)" },
        },
        { pluginContext: probe!, pluginConfig: fb.config }
      );
    const rows = async () =>
      (
        await current!.nextly.find({
          collection: "form-submissions",
          limit: 100,
        })
      ).items as {
        ipAddress: string | null;
        userAgent: string | null;
        responseKey: string | null;
      }[];
    return { submit, rows, t: current! };
  }

  it("stores neither address nor browser, and still takes one per network", async () => {
    const { submit, rows } = await boot({
      oneResponse: "ip",
      storeIpAndBrowser: false,
    });
    expect((await submit("ada@example.com", "203.0.113.9")).success).toBe(true);
    expect(await submit("grace@example.com", "203.0.113.9")).toMatchObject({
      outcome: "duplicate",
    });
    expect((await submit("linus@example.com", "203.0.113.10")).success).toBe(
      true
    );

    const stored = await rows();
    expect(stored).toHaveLength(2);
    for (const row of stored) {
      expect(row.ipAddress ?? null).toBeNull();
      expect(row.userAgent ?? null).toBeNull();
      expect(row.responseKey).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(row)).not.toContain("203.0.113");
    }
  });

  it("keeps a network's key through staff edits of an addressless submission", async () => {
    const { submit, rows, t } = await boot({
      oneResponse: "ip",

      storeIpAndBrowser: false,
    });

    expect((await submit("ada@example.com", "203.0.113.9")).success).toBe(true);

    const { items } = await t.nextly.find({
      collection: "form-submissions",

      limit: 1,
    });

    const id = String((items[0] as { id: unknown }).id);

    const [before] = await rows();

    await t.nextly.update({
      collection: "form-submissions",

      id,

      data: { status: "read", _overwrite: true },
    });

    await t.nextly.update({
      collection: "form-submissions",

      id,

      data: { data: { email: "ada@other.example" }, _overwrite: true },
    });

    const [after] = await rows();

    expect(after?.responseKey).toBe(before?.responseKey);

    expect(await submit("grace@example.com", "203.0.113.9")).toMatchObject({
      outcome: "duplicate",
    });
  });

  it("refuses a network an earlier, unkeyed submission came from, at every door", async () => {
    const { t } = await boot({ oneResponse: "ip" });

    const formId = String(
      (
        (await t.nextly.find({ collection: "forms", limit: 1 })).items[0] as {
          id: unknown;
        }
      ).id
    );

    // An earlier submission with its address and no key, as one stored before

    // keys were.

    const earlier = await t.nextly.create({
      collection: "form-submissions",

      data: {
        form: formId,

        data: { email: "ada@example.com" },

        ipAddress: "203.0.113.9",
      },
    });

    await t.adapter.update(
      "dc_form_submissions",

      { response_key: null },

      { and: [{ column: "id", op: "=", value: String(earlier.item.id) }] }
    );

    // The form stops keeping addresses; what it compares is unchanged.

    const form = (await t.nextly.findByID({
      collection: "forms",

      id: formId,
    })) as { settings: Record<string, unknown> };

    await t.nextly.update({
      collection: "forms",

      id: formId,

      data: {
        settings: { ...form.settings, storeIpAndBrowser: false },

        _overwrite: true,
      },
    });

    await expect(
      t.nextly.create({
        collection: "form-submissions",

        data: {
          form: formId,

          data: { email: "grace@example.com" },

          ipAddress: "203.0.113.9",
        },
      })
    ).rejects.toThrow();
  });

  it("stores both on a form that keeps them", async () => {
    const { submit, rows } = await boot({ oneResponse: "off" });
    expect((await submit("ada@example.com", "203.0.113.9")).success).toBe(true);
    const [row] = await rows();
    expect(row).toMatchObject({
      ipAddress: "203.0.113.9",
      userAgent: "Mozilla/5.0 (Test)",
    });
  });
});
