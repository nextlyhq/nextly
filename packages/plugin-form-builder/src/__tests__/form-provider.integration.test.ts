/**
 * A native form post to one of this plugin's forms, as the page builder's
 * receiver hands it to the plugin's provider, against a real database: it
 * runs the same checks and stores the same submission as the plugin's JSON
 * address, and keeps the same one-response rule.
 *
 * The page builder is stood in for by a plugin under its name offering its
 * `forms` service, so this plugin is tested without importing it.
 */
import { definePlugin } from "@nextlyhq/plugin-sdk";
import type { FormProvider } from "@nextlyhq/plugin-sdk/blocks";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { FORMS_PROVIDER_ID } from "../form-provider/provider";
import { formBuilder } from "../plugin";

/** The providers registered with the stand-in page builder, this boot. */
const registered: FormProvider[] = [];

/** A page builder offering only its `forms` service, as the real one does. */
const pageBuilderStandIn = definePlugin({
  name: "@nextlyhq/plugin-page-builder",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    services: {
      forms: () => ({
        register: (provider: FormProvider) => {
          registered.push(provider);
        },
      }),
    },
  },
} as never);

const FIELDS = [
  { type: "text", name: "name", label: "Name" },
  { type: "email", name: "email", label: "Email", required: true },
  {
    type: "select",
    name: "topic",
    label: "Topic",
    options: [
      { value: "sales", label: "Sales" },
      { value: "help", label: "Help" },
    ],
  },
];

describe.each(getConfiguredTestDialects())(
  "a native post to a Forms form (%s)",
  dialect => {
    let current: TestNextly | undefined;
    afterEach(async () => {
      registered.length = 0;
      await current?.destroy();
      current = undefined;
    });

    async function boot(settings: Record<string, unknown> = {}) {
      const fb = formBuilder({
        spamProtection: { honeypot: true, recaptcha: { enabled: false } },
      });
      current = await createTestNextly({
        dialect,
        plugins: [pageBuilderStandIn, fb.plugin],
        seedPublic: true,
      });
      const form = await current.nextly.create({
        collection: "forms",
        data: {
          name: "Contact",
          slug: "contact",
          status: "published",
          fields: FIELDS,
          settings: { honeypotEnabled: true, ...settings },
        },
      });
      const provider = registered.find(each => each.id === FORMS_PROVIDER_ID);
      if (provider === undefined) throw new Error("no provider registered");
      return { nextly: current.nextly, provider, formId: String(form.item.id) };
    }

    /** A post as the receiver hands it: answers by name, and the request. */
    const native = (answers: Record<string, string>) => ({
      answers: new Map(
        Object.entries(answers).map(([name, value]) => [name, [value]])
      ),
      request: new Request("http://localhost/admin/api/plugins/x/forms/send", {
        method: "POST",
        headers: { "user-agent": "Browser/1" },
      }),
    });

    /** The same answers through the plugin's JSON address. */
    async function viaJson(data: Record<string, string>): Promise<number> {
      const response = await createDynamicHandlers().POST(
        new Request("http://localhost/api/forms/contact/submit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ data }),
        }),
        { params: Promise.resolve({ params: ["forms", "contact", "submit"] }) }
      );
      return response.status;
    }

    async function stored(nextly: TestNextly["nextly"]) {
      const { items } = await nextly.find({
        collection: "form-submissions",
        limit: 100,
        sort: "createdAt",
      });
      return items as { status: string; data: Record<string, unknown> }[];
    }

    it("registers once, and draws the form's fields from its own description", async () => {
      const { provider, formId } = await boot();
      expect(registered).toHaveLength(1);
      const described = await provider.describe(formId, {
        access: { as: "public" },
      });
      expect(
        "fields" in described ? described.fields.map(field => field.kind) : []
      ).toEqual(["text", "email", "select"]);
    });

    it("stores the same submission as the JSON address", async () => {
      const { nextly, provider, formId } = await boot();
      const answers = {
        name: "Ada Lovelace",
        email: "ada@example.com",
        topic: "help",
      };
      expect(await provider.accept(formId, native(answers))).toEqual({
        kind: "sent",
      });
      expect(await viaJson(answers)).toBe(201);

      const [first, second] = await stored(nextly);
      // Must-be-found: both were kept.
      expect(first?.data).toBeDefined();
      expect(first?.data).toEqual(second?.data);
      expect(first?.status).toBe(second?.status);
      expect(first?.data).toMatchObject(answers);
    });

    it("refuses what the JSON address refuses, storing nothing", async () => {
      const { nextly, provider, formId } = await boot();
      const refused = await provider.accept(
        formId,
        native({ name: "Ada", email: "not-an-email" })
      );
      expect(refused.kind).toBe("invalid");
      expect(
        refused.kind === "invalid"
          ? refused.issues.map(issue => issue.field)
          : []
      ).toContain("email");
      expect(await viaJson({ name: "Ada", email: "not-an-email" })).toBe(400);
      expect(await stored(nextly)).toEqual([]);
    });

    it("keeps one response per email, whichever door the second comes through", async () => {
      const { provider, formId } = await boot({
        oneResponse: "email",
        oneResponseField: "email",
      });
      expect(
        (await provider.accept(formId, native({ email: "ada@example.com" })))
          .kind
      ).toBe("sent");
      expect(
        (await provider.accept(formId, native({ email: "ada@example.com" })))
          .kind
      ).toBe("closed");
      expect(await viaJson({ email: "ada@example.com" })).toBe(409);
    });

    it("answers a closed form as closed, asking it to take nothing", async () => {
      const { nextly, provider, formId } = await boot();
      await nextly.update({
        collection: "forms",
        id: formId,
        data: {
          status: "closed",
          closedMessage: "Entries have closed.",
          _overwrite: true,
        },
      });
      expect(
        await provider.describe(formId, { access: { as: "public" } })
      ).toEqual({ unavailable: "closed", message: "Entries have closed." });
      expect(
        (await provider.accept(formId, native({ email: "a@b.co" }))).kind
      ).toBe("closed");
      expect(await stored(nextly)).toEqual([]);
    });
  }
);
