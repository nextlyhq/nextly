/**
 * One response per person, on every dialect: a second submission with the
 * same email or network is refused, exactly one of several sent at once is
 * stored, the stored row keeps only a keyed digest, spam takes no place, a
 * caller cannot choose a row's key, and a form that took one submission per
 * network before the upgrade still refuses a network that submitted then.
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

const FIELDS = [
  { type: "text", name: "name", label: "Name" },
  { type: "email", name: "email", label: "Email", required: true },
];

describe.each(getConfiguredTestDialects())(
  "one response per person (%s)",
  dialect => {
    let current: TestNextly | undefined;
    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot(settings: Record<string, unknown>) {
      const fb = formBuilder({
        spamProtection: { honeypot: true, recaptcha: { enabled: false } },
      });
      const probe = contextProbe("@test/fb-one-response");
      current = await createTestNextly({
        dialect,
        plugins: [fb.plugin, probe.plugin],
      });
      const form = await current.nextly.create({
        collection: "forms",
        data: {
          name: "Meetup",
          slug: "meetup",
          status: "published",
          fields: FIELDS,
          settings: { honeypotEnabled: true, ...settings },
        },
      });
      const submit = (data: Record<string, unknown>, ipAddress?: string) =>
        submitForm(
          {
            formSlug: "meetup",
            data,
            ...(ipAddress ? { metadata: { ipAddress } } : {}),
          },
          { pluginContext: probe.get(), pluginConfig: fb.config }
        );
      return { nextly: current.nextly, submit, formId: String(form.item.id) };
    }

    async function stored(nextly: TestNextly["nextly"]) {
      const { items } = await nextly.find({
        collection: "form-submissions",
        limit: 100,
      });
      return items as {
        id: string;
        status: string;
        responseKey: string | null;
        data: Record<string, unknown>;
      }[];
    }

    it("refuses a second response from the same email, whatever its case", async () => {
      const { nextly, submit } = await boot({
        oneResponse: "email",
        oneResponseField: "email",
      });
      expect((await submit({ email: "Ada@Example.com" })).success).toBe(true);
      expect(await submit({ email: " ada@example.COM" })).toMatchObject({
        success: false,
        outcome: "duplicate",
        error: "You have already submitted this form.",
      });
      expect((await submit({ email: "grace@example.com" })).success).toBe(true);

      const rows = await stored(nextly);
      expect(rows).toHaveLength(2);
      // A keyed digest only: never the address itself.
      for (const row of rows) {
        expect(row.responseKey).toMatch(/^[0-9a-f]{64}$/);
        expect(row.responseKey).not.toContain("example");
      }
    });

    it("stores exactly one of several sent at once with the same email", async () => {
      const { nextly, submit } = await boot({
        oneResponse: "email",
        oneResponseField: "email",
      });
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, n) =>
          submit({ email: n % 2 ? "ADA@example.com" : "ada@example.com" })
        )
      );
      expect(results.filter(result => result.success)).toHaveLength(1);
      expect(await stored(nextly)).toHaveLength(1);
    });

    it("stores exactly one of several sent at once from the same network", async () => {
      const { nextly, submit } = await boot({ oneResponse: "ip" });
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          submit({ email: "a@b.co" }, "203.0.113.9")
        )
      );
      expect(results.filter(result => result.success)).toHaveLength(1);
      for (const refused of results.filter(result => !result.success)) {
        expect(refused).toMatchObject({ outcome: "duplicate" });
      }
      expect((await submit({ email: "a@b.co" }, "203.0.113.10")).success).toBe(
        true
      );
      expect(await stored(nextly)).toHaveLength(2);
    });

    it("gives spam no key, so it takes nobody's place", async () => {
      const { nextly, submit } = await boot({
        oneResponse: "email",
        oneResponseField: "email",
      });
      // Caught by the trap field: stored as spam, with no key.
      expect(
        (await submit({ email: "ada@example.com", _hp: "filled" })).success
      ).toBe(true);
      expect((await submit({ email: "ada@example.com" })).success).toBe(true);

      const rows = await stored(nextly);
      expect(
        rows.find(row => row.status === "spam")?.responseKey ?? null
      ).toBeNull();
      expect(rows.filter(row => row.status !== "spam")).toHaveLength(1);
    });

    it("makes a row's key itself, whatever a caller sends", async () => {
      const { nextly, submit, formId } = await boot({
        oneResponse: "email",
        oneResponseField: "email",
      });
      // A caller naming another address's key cannot take its place.
      await nextly.create({
        collection: "form-submissions",
        data: {
          form: formId,
          data: { email: "grace@example.com" },
          status: "new",
          submittedAt: new Date(),
          responseKey: "0".repeat(64),
        },
      });
      const [row] = await stored(nextly);
      expect(row?.responseKey).not.toBe("0".repeat(64));
      expect(await submit({ email: "grace@example.com" })).toMatchObject({
        outcome: "duplicate",
      });
    });

    it("still refuses a network that submitted before the upgrade", async () => {
      // A form saved with the old switch, and a submission stored before the
      // key existed: no key on the row, its address stored.
      const { nextly, submit, formId } = await boot({
        allowMultipleSubmissions: false,
      });
      await nextly.create({
        collection: "form-submissions",
        data: {
          form: formId,
          data: { email: "ada@example.com" },
          status: "new",
          submittedAt: new Date(),
          ipAddress: "203.0.113.9",
        },
      });
      const { items } = await nextly.find({ collection: "form-submissions" });
      const old = items[0] as { id: string };
      await nextly.update({
        collection: "form-submissions",
        id: old.id,
        data: { responseKey: null, _overwrite: true },
      });

      expect(
        await submit({ email: "new@example.com" }, "203.0.113.9")
      ).toMatchObject({
        success: false,
        outcome: "duplicate",
      });
    });
  }
);
