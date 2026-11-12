/**
 * One response per person, on every dialect: a second submission with the
 * same email or network is refused, exactly one of several sent at once is
 * stored, the stored row keeps only a keyed digest, spam takes no place, a
 * caller cannot choose a row's key, and a form that took one submission per
 * network before the upgrade still refuses a network that submitted then.
 * One per browser compares the token the visitor's browser sends, keeps the
 * token out of the row, and refuses a key whose mode changed in flight.
 */
import { definePlugin, type PluginContext } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { SETTINGS_CHANGED } from "../handlers/form-closing-hold";
import { BROWSER_TOKEN_FIELD } from "../handlers/one-response";
import { submitForm } from "../handlers/submit-form";
import { formBuilder } from "../plugin";

/**
 * The live plugin context, captured by a plugin booted beside the forms; and,
 * when given `afterKeyed`, a step run on each submission after the forms
 * plugin's own write hook (registered before this one) has keyed it.
 */
function contextProbe(name: string, afterKeyed?: () => Promise<void>) {
  let captured: PluginContext | undefined;
  const plugin = definePlugin({
    name,
    version: "1.0.0",
    nextly: ">=0.0.0",
    init: context => {
      captured = context;
      if (afterKeyed) {
        context.hooks.on("beforeChange", "form-submissions", async hook => {
          await afterKeyed();
          return (hook as { data?: unknown }).data;
        });
      }
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

const params = (...segments: string[]) => ({
  params: Promise.resolve({ params: segments }),
});

const TOKEN = "3b241101-e2bb-4255-8caf-4136c566a962";
const OTHER_TOKEN = "9f0c5a52-6d1e-4c43-b7a8-21d0c3b9e8f1";
/** Answers as a browser taking part in one per browser sends them. */
const fromBrowser = (token: string, email = "a@b.co") => ({
  email,
  [BROWSER_TOKEN_FIELD]: token,
});

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

    async function boot(
      settings: Record<string, unknown>,
      /** Runs on each submission after the plugin has keyed it. */
      afterKeyed?: () => Promise<void>
    ) {
      const fb = formBuilder({
        spamProtection: { honeypot: true, recaptcha: { enabled: false } },
      });
      const probe = contextProbe("@test/fb-one-response", afterKeyed);
      current = await createTestNextly({
        dialect,
        plugins: [fb.plugin, probe.plugin],
        // The Public role as an install seeds it, for the public routes.
        seedPublic: true,
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
      // A submission stored while the form allowed several responses, so with
      // no key, as every submission was before keys existed; then the form is
      // saved with the old one-per-IP switch, which reads as one per network.
      const { nextly, submit, formId } = await boot({});
      expect(
        (await submit({ email: "ada@example.com" }, "203.0.113.9")).success
      ).toBe(true);
      const [old] = await stored(nextly);
      expect(old?.responseKey ?? null).toBeNull();
      await nextly.update({
        collection: "forms",
        id: formId,
        data: {
          settings: { honeypotEnabled: true, allowMultipleSubmissions: false },
          _overwrite: true,
        },
      });

      expect(
        await submit({ email: "new@example.com" }, "203.0.113.9")
      ).toMatchObject({ success: false, outcome: "duplicate" });
      expect(
        (await submit({ email: "new@example.com" }, "203.0.113.10")).success
      ).toBe(true);
    });

    it("moves the key with an edited email, and refuses an edit onto a held one", async () => {
      const { nextly, submit } = await boot({
        oneResponse: "email",
        oneResponseField: "email",
      });
      await submit({ email: "ada@example.com" });
      await submit({ email: "grace@example.com" });
      const ada = (await stored(nextly)).find(
        row => row.data.email === "ada@example.com"
      )!;

      // Staff correct Ada's address: the old one is free, the new one held.
      await nextly.update({
        collection: "form-submissions",
        id: ada.id,
        data: { data: { email: "ada@lovelace.dev" }, _overwrite: true },
      });
      expect((await submit({ email: "ada@example.com" })).success).toBe(true);
      expect(await submit({ email: "ADA@lovelace.dev" })).toMatchObject({
        outcome: "duplicate",
      });

      // An edit onto an address another submission holds is refused.
      await expect(
        nextly.update({
          collection: "form-submissions",
          id: ada.id,
          data: { data: { email: "grace@example.com" }, _overwrite: true },
        })
      ).rejects.toMatchObject({ code: "DUPLICATE" });
    });

    it("gives a submission restored from spam its key back, unless taken since", async () => {
      const { nextly, submit } = await boot({
        oneResponse: "email",
        oneResponseField: "email",
      });
      await submit({ email: "ada@example.com" });
      const [first] = await stored(nextly);
      const markAs = (id: string, status: string) =>
        nextly.update({
          collection: "form-submissions",
          id,
          data: { status, _overwrite: true },
        });

      // Restored with the value free: it holds it again.
      await markAs(first!.id, "spam");
      await markAs(first!.id, "new");
      expect(await submit({ email: "ada@example.com" })).toMatchObject({
        outcome: "duplicate",
      });

      // Taken while it was spam: the restore keeps no key, and succeeds.
      await markAs(first!.id, "spam");
      expect((await submit({ email: "ada@example.com" })).success).toBe(true);
      await markAs(first!.id, "new");
      const restored = (await stored(nextly)).find(row => row.id === first!.id);
      expect(restored?.status).toBe("new");
      expect(restored?.responseKey ?? null).toBeNull();

      // Its value still held by the other, it stays keyless through later
      // changes that leave its value alone.
      await markAs(first!.id, "read");
      const read = (await stored(nextly)).find(row => row.id === first!.id);
      expect(read?.status).toBe("read");
      expect(read?.responseKey ?? null).toBeNull();
    });

    it("judges a submission moved to another form by that form's responses", async () => {
      const { nextly, submit, formId } = await boot({
        oneResponse: "email",
        oneResponseField: "email",
      });
      await submit({ email: "ada@example.com" });
      // A form allowing several responses, with a submission from the same
      // address and no key.
      const open = await nextly.create({
        collection: "forms",
        data: {
          name: "Open",
          slug: "open",
          status: "published",
          fields: FIELDS,
          settings: { honeypotEnabled: false },
        },
      });
      const elsewhere = await nextly.create({
        collection: "form-submissions",
        data: {
          form: open.item.id,
          data: { email: "ADA@example.com" },
          status: "new",
          submittedAt: new Date(),
        },
      });

      // Moved onto the form that already holds that address: refused.
      await expect(
        nextly.update({
          collection: "form-submissions",
          id: elsewhere.item.id,
          data: { form: formId, _overwrite: true },
        })
      ).rejects.toMatchObject({ code: "DUPLICATE" });
    });

    it("frees a network once its submission's stored address is cleared", async () => {
      const { nextly, submit } = await boot({ oneResponse: "ip" });
      expect((await submit({ email: "a@b.co" }, "203.0.113.9")).success).toBe(
        true
      );
      const [first] = await stored(nextly);
      await nextly.update({
        collection: "form-submissions",
        id: first!.id,
        data: { ipAddress: null, _overwrite: true },
      });
      const [cleared] = await stored(nextly);
      expect(cleared?.responseKey ?? null).toBeNull();
      expect((await submit({ email: "a@b.co" }, "203.0.113.9")).success).toBe(
        true
      );
    });

    it("lets a person respond again once their submission is marked spam", async () => {
      const { nextly, submit } = await boot({
        oneResponse: "email",
        oneResponseField: "email",
      });
      expect((await submit({ email: "ada@example.com" })).success).toBe(true);
      const [first] = await stored(nextly);
      await nextly.update({
        collection: "form-submissions",
        id: first!.id,
        data: { status: "spam", _overwrite: true },
      });
      const [marked] = await stored(nextly);
      expect(marked?.responseKey ?? null).toBeNull();

      expect((await submit({ email: "ada@example.com" })).success).toBe(true);
    });

    it("refuses a second response from the same browser, keeping no token", async () => {
      const { nextly, submit } = await boot({ oneResponse: "browser" });
      expect((await submit(fromBrowser(TOKEN))).success).toBe(true);
      // Another address, the same browser: still the same person.
      expect(await submit(fromBrowser(TOKEN, "someone@else.co"))).toMatchObject(
        { success: false, outcome: "duplicate" }
      );
      expect((await submit(fromBrowser(OTHER_TOKEN))).success).toBe(true);

      const rows = await stored(nextly);
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        // A keyed digest marked as a browser's; the token itself is kept
        // nowhere in the row.
        expect(row.responseKey).toMatch(/^browser:[0-9a-f]{64}$/);
        expect(JSON.stringify(row)).not.toContain(TOKEN);
        expect(JSON.stringify(row)).not.toContain(OTHER_TOKEN);
        expect(row.data).not.toHaveProperty(BROWSER_TOKEN_FIELD);
      }
    });

    it("tells a visitor's form where to send its token, and refuses it twice through the route", async () => {
      const { nextly } = await boot({ oneResponse: "browser" });
      const handlers = createDynamicHandlers();
      const read = (await (
        await handlers.GET(
          new Request("http://localhost/api/forms/meetup"),
          params("forms", "meetup")
        )
      ).json()) as Record<string, unknown>;
      expect(read).toMatchObject({
        oneResponse: { by: "browser", field: BROWSER_TOKEN_FIELD },
      });
      const post = () =>
        handlers.POST(
          new Request("http://localhost/api/forms/meetup/submit", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ data: fromBrowser(TOKEN) }),
          }),
          params("forms", "meetup", "submit")
        );
      expect((await post()).status).toBe(201);
      expect((await post()).status).toBe(409);
      expect(await stored(nextly)).toHaveLength(1);
    });

    it("says nothing of a browser token on a form that does not compare browsers", async () => {
      await boot({ oneResponse: "ip" });
      const read = (await (
        await createDynamicHandlers().GET(
          new Request("http://localhost/api/forms/meetup"),
          params("forms", "meetup")
        )
      ).json()) as Record<string, unknown>;
      expect(read).not.toHaveProperty("oneResponse");
    });

    it("stores exactly one of several sent at once from the same browser", async () => {
      const { nextly, submit } = await boot({ oneResponse: "browser" });
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, n) =>
          submit(fromBrowser(TOKEN, `p${n}@b.co`))
        )
      );
      expect(results.filter(result => result.success)).toHaveLength(1);
      expect(await stored(nextly)).toHaveLength(1);
    });

    it("accepts a browser that sends no token, without a key", async () => {
      const { nextly, submit } = await boot({ oneResponse: "browser" });
      expect((await submit({ email: "a@b.co" })).success).toBe(true);
      expect(
        (await submit({ email: "a@b.co", [BROWSER_TOKEN_FIELD]: "bad" }))
          .success
      ).toBe(true);
      const rows = await stored(nextly);
      expect(rows.map(row => row.responseKey ?? null)).toEqual([null, null]);
    });

    it("keeps a browser's key through a staff edit, and frees it once marked spam", async () => {
      const { nextly, submit } = await boot({ oneResponse: "browser" });
      expect((await submit(fromBrowser(TOKEN))).success).toBe(true);
      const [first] = await stored(nextly);
      const key = first!.responseKey;

      await nextly.update({
        collection: "form-submissions",
        id: first!.id,
        data: { status: "read", _overwrite: true },
      });
      await nextly.update({
        collection: "form-submissions",
        id: first!.id,
        data: { data: { email: "c@d.co" }, _overwrite: true },
      });
      expect((await stored(nextly))[0]?.responseKey).toBe(key);
      expect(await submit(fromBrowser(TOKEN))).toMatchObject({
        outcome: "duplicate",
      });

      await nextly.update({
        collection: "form-submissions",
        id: first!.id,
        data: { status: "spam", _overwrite: true },
      });
      expect((await stored(nextly))[0]?.responseKey ?? null).toBeNull();
      expect((await submit(fromBrowser(TOKEN))).success).toBe(true);
    });

    it("keys a browser token sent to the collection's own create too", async () => {
      const { nextly, formId } = await boot({ oneResponse: "browser" });
      const create = () =>
        nextly.create({
          collection: "form-submissions",
          data: { form: formId, data: fromBrowser(TOKEN) },
        });
      await create();
      await expect(create()).rejects.toThrow();
      expect(await stored(nextly)).toHaveLength(1);
    });

    it("refuses a browser's key once the form compares networks instead", async () => {
      let formId = "";
      let change = false;
      const {
        nextly,
        submit,
        formId: id,
      } = await boot({ oneResponse: "browser" }, async () => {
        if (!change) return;
        change = false;
        // The form's mode changes after the submission was keyed and
        // before it is stored.
        await current!.nextly.update({
          collection: "forms",
          id: formId,
          data: { settings: { oneResponse: "ip" }, _overwrite: true },
        });
      });
      formId = id;
      change = true;
      expect(await submit(fromBrowser(TOKEN), "203.0.113.9")).toMatchObject({
        success: false,
        error: SETTINGS_CHANGED,
      });
      expect(await stored(nextly)).toHaveLength(0);
      // Sent again, it is judged by the network, as the form now compares.
      expect((await submit(fromBrowser(TOKEN), "203.0.113.9")).success).toBe(
        true
      );
      const [row] = await stored(nextly);
      // A network's key, made for the version the change moved the form to.
      expect(row?.responseKey).toMatch(/^v1:[0-9a-f]{64}$/);
    });
  }
);
