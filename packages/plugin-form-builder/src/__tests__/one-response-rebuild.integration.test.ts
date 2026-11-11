/**
 * One response per person after a form changes how it tells people apart,
 * on every dialect: earlier submissions are counted, the earliest of several
 * with one value keeping it; a repeat is refused while they are still being
 * counted; a sweep held across a second change writes nothing for the first;
 * an answer edited while the sweep is held keeps its own key; and the form's
 * other settings survive the sweep recording that it finished.
 */
import { definePlugin, type PluginContext } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { REBUILD_KEYS_JOB } from "../handlers/one-response-rebuild";
import { submitForm } from "../handlers/submit-form";
import { formBuilder } from "../plugin";

const PLUGIN_SUBMISSION = Symbol.for("nextly.plugin-form-builder.submission");

/** Whether a submission payload is the plugin writing a key it made. */
function isKeyWrite(data: unknown): boolean {
  const marks = (data as Record<symbol, { setKey?: unknown } | undefined>)?.[
    PLUGIN_SUBMISSION
  ];
  return marks?.setKey !== undefined;
}

/**
 * A gate the sweep's key writes wait at while `held`: `reached` settles when
 * the first one arrives, and `open` lets every one through.
 */
function keyWriteGate() {
  let held = false;
  let open = () => {};
  let arrived = () => {};
  let opened = Promise.resolve();
  let reached = Promise.resolve();
  return {
    hold() {
      held = true;
      opened = new Promise<void>(resolve => (open = resolve));
      reached = new Promise<void>(resolve => (arrived = resolve));
    },
    open() {
      held = false;
      open();
    },
    reached: () => reached,
    async pass(data: unknown) {
      if (!held || !isKeyWrite(data)) return;
      arrived();
      await opened;
    },
  };
}

const FIELDS = [
  { type: "text", name: "name", label: "Name" },
  { type: "email", name: "email", label: "Email", required: true },
];

describe.each(getConfiguredTestDialects())(
  "one response per person after a change (%s)",
  dialect => {
    let current: TestNextly | undefined;
    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot(settings: Record<string, unknown>) {
      const fb = formBuilder({
        spamProtection: { honeypot: false, recaptcha: { enabled: false } },
      });
      const gate = keyWriteGate();
      let probe: PluginContext | undefined;
      // The forms plugin's own context: only a plugin may run its sweep now.
      let own: PluginContext | undefined;
      const init = fb.plugin.init;
      const plugin = {
        ...fb.plugin,
        init: async (ctx: PluginContext) => {
          own = ctx;
          await init?.(ctx);
        },
      };
      current = await createTestNextly({
        dialect,
        plugins: [
          plugin,
          definePlugin({
            name: "@test/fb-rebuild-probe",
            version: "1.0.0",
            nextly: ">=0.0.0",
            init: ctx => {
              probe = ctx;
              ctx.hooks.on("beforeChange", "form-submissions", async hook => {
                const data = (hook as { data?: unknown }).data;
                await gate.pass(data);
                return data;
              });
            },
          }),
        ],
      });
      const nextly = current.nextly;
      const created = await nextly.create({
        collection: "forms",
        data: {
          name: "Meetup",
          slug: "meetup",
          status: "published",
          fields: FIELDS,
          settings,
        },
      });
      const formId = String(created.item.id);
      const submit = (data: Record<string, unknown>, ipAddress?: string) =>
        submitForm(
          {
            formSlug: "meetup",
            data,
            ...(ipAddress ? { metadata: { ipAddress } } : {}),
          },
          { pluginContext: probe!, pluginConfig: fb.config }
        );
      const form = async () =>
        (await nextly.findByID({ collection: "forms", id: formId })) as {
          settings: Record<string, unknown>;
        };
      /** Save the form's settings as the admin does: the whole group. */
      const saveSettings = async (patch: Record<string, unknown>) =>
        nextly.update({
          collection: "forms",
          id: formId,
          data: {
            settings: { ...(await form()).settings, ...patch },
            _overwrite: true,
          },
        });
      const rows = async () =>
        (
          await nextly.find({
            collection: "form-submissions",
            sort: "createdAt",
            limit: 100,
          })
        ).items as {
          id: string;
          responseKey: string | null;
          data: Record<string, unknown>;
        }[];
      const sweep = () => own!.services.jobs.runSweepNow(REBUILD_KEYS_JOB);
      return { nextly, submit, form, saveSettings, rows, sweep, gate, formId };
    }

    /** One second apart, so "earliest" is the same on every dialect. */
    const tick = () => new Promise(resolve => setTimeout(resolve, 1100));

    it("counts earlier submissions when a form starts taking one per email", async () => {
      const { submit, saveSettings, rows, form } = await boot({
        oneResponse: "off",
      });
      expect((await submit({ email: "ada@example.com" })).success).toBe(true);
      await tick();
      expect((await submit({ email: "ADA@example.com" })).success).toBe(true);
      expect((await submit({ email: "grace@example.com" })).success).toBe(true);

      await saveSettings({ oneResponse: "email", oneResponseField: "email" });

      // Brought up to date before the save answered.
      expect((await form()).settings).toMatchObject({
        oneResponseVersion: 1,
        oneResponseKeyedVersion: 1,
      });
      const stored = await rows();
      // By address: the last two are stored in the same second.
      const byEmail = (email: string) =>
        stored.find(row => row.data.email === email);
      const [ada, adaAgain, grace] = [
        stored[0],
        byEmail("ADA@example.com"),
        byEmail("grace@example.com"),
      ];
      expect(ada?.data.email).toBe("ada@example.com");
      expect(ada?.responseKey).toMatch(/^v1:[0-9a-f]{64}$/);
      expect(adaAgain?.responseKey ?? null).toBeNull();
      expect(grace?.responseKey).toMatch(/^v1:[0-9a-f]{64}$/);

      expect(await submit({ email: "Ada@Example.com" })).toMatchObject({
        outcome: "duplicate",
      });
      expect((await submit({ email: "new@example.com" })).success).toBe(true);
    });

    it("refuses a repeat while earlier submissions are still being counted", async () => {
      const { submit, saveSettings, rows, form, gate, sweep } = await boot({
        oneResponse: "off",
      });
      expect((await submit({ email: "ada@example.com" })).success).toBe(true);

      gate.hold();
      const saving = saveSettings({
        oneResponse: "email",
        oneResponseField: "email",
      });
      await gate.reached();
      // The change is committed; the sweep is held before its first write.
      expect((await form()).settings).toMatchObject({
        oneResponseVersion: 1,
        oneResponseKeyedVersion: 0,
      });
      expect(await submit({ email: "ADA@example.com" })).toMatchObject({
        success: false,
        outcome: "duplicate",
      });
      expect((await submit({ email: "grace@example.com" })).success).toBe(true);

      gate.open();
      await saving;
      await sweep();
      expect((await form()).settings).toMatchObject({
        oneResponseKeyedVersion: 1,
      });
      expect((await rows()).map(row => row.responseKey)).toEqual([
        expect.stringMatching(/^v1:/),
        expect.stringMatching(/^v1:/),
      ]);
    });

    it("writes nothing for a change the form has left while its sweep was held", async () => {
      const { submit, saveSettings, rows, form, gate, sweep } = await boot({
        oneResponse: "off",
      });
      expect(
        (await submit({ email: "ada@example.com" }, "203.0.113.9")).success
      ).toBe(true);

      gate.hold();
      const first = saveSettings({
        oneResponse: "email",
        oneResponseField: "email",
      });
      await gate.reached();
      // Changed again while the first change's sweep is held.
      await saveSettings({ oneResponse: "ip" });
      gate.open();
      await first;
      // The held sweep's write, made for version 1, was refused where it was
      // stored: no key from the change the form has left.
      expect((await rows())[0]?.responseKey ?? "").not.toMatch(/^v1:/);
      await sweep();

      expect((await form()).settings).toMatchObject({
        oneResponseVersion: 2,
        oneResponseKeyedVersion: 2,
      });
      const [ada] = await rows();
      expect(ada?.responseKey).toMatch(/^v2:/);
      expect(
        await submit({ email: "other@example.com" }, "203.0.113.9")
      ).toMatchObject({ outcome: "duplicate" });
    });

    it("keeps the key of an answer edited while the sweep was held", async () => {
      const { nextly, submit, saveSettings, rows, gate, sweep } = await boot({
        oneResponse: "off",
      });
      expect((await submit({ email: "ada@example.com" })).success).toBe(true);
      const [ada] = await rows();

      gate.hold();
      const saving = saveSettings({
        oneResponse: "email",
        oneResponseField: "email",
      });
      await gate.reached();
      await nextly.update({
        collection: "form-submissions",
        id: ada!.id,
        data: { data: { email: "grace@example.com" }, _overwrite: true },
      });
      const edited = (await rows())[0]?.responseKey;
      expect(edited).toMatch(/^v1:/);
      gate.open();
      await saving;
      await sweep();

      expect((await rows())[0]?.responseKey).toBe(edited);
      expect(await submit({ email: "grace@example.com" })).toMatchObject({
        outcome: "duplicate",
      });
      expect((await submit({ email: "ada@example.com" })).success).toBe(true);
    });

    it("refuses an edit onto an earlier answer the sweep has not keyed yet", async () => {
      const { nextly, submit, saveSettings, rows, gate, sweep } = await boot({
        oneResponse: "off",
      });
      expect((await submit({ email: "ada@example.com" })).success).toBe(true);
      await tick();
      expect((await submit({ email: "grace@example.com" })).success).toBe(true);
      const grace = (await rows()).find(
        row => row.data.email === "grace@example.com"
      );

      gate.hold();
      const saving = saveSettings({
        oneResponse: "email",
        oneResponseField: "email",
      });
      // Held at its first write: the oldest, ada's, has no key yet.
      await gate.reached();
      await expect(
        nextly.update({
          collection: "form-submissions",
          id: grace!.id,
          data: { data: { email: "ADA@example.com" }, _overwrite: true },
        })
      ).rejects.toThrow();
      gate.open();
      await saving;
      await sweep();
      expect((await rows()).find(row => row.id === grace!.id)?.data.email).toBe(
        "grace@example.com"
      );
    });

    it("refuses a move onto a form whose earlier answer is not keyed yet", async () => {
      const { nextly, submit, saveSettings, rows, gate, sweep, formId } =
        await boot({ oneResponse: "off" });
      expect((await submit({ email: "ada@example.com" })).success).toBe(true);
      // Another form, taking several responses, with the same address.
      const other = await nextly.create({
        collection: "forms",
        data: {
          name: "Other",
          slug: "other",
          status: "published",
          fields: FIELDS,
          settings: { oneResponse: "off" },
        },
      });
      const moved = await nextly.create({
        collection: "form-submissions",
        data: { form: other.item.id, data: { email: "ADA@example.com" } },
      });

      gate.hold();
      const saving = saveSettings({
        oneResponse: "email",
        oneResponseField: "email",
      });
      // Held at its first write: ada's submission has no key yet.
      await gate.reached();
      await expect(
        nextly.update({
          collection: "form-submissions",
          id: String(moved.item.id),
          data: { form: formId, _overwrite: true },
        })
      ).rejects.toThrow();
      gate.open();
      await saving;
      await sweep();
      // `form` reads as the id or as the populated form.
      const formOf = (row: unknown) => {
        const form = (row as { form?: unknown }).form;
        return typeof form === "object" && form !== null
          ? String((form as { id?: unknown }).id)
          : String(form);
      };
      const meetup = (await rows()).filter(row => formOf(row) === formId);
      expect(meetup).toHaveLength(1);
      expect(meetup[0]?.responseKey).toMatch(/^v1:/);
    });

    it("keeps the form's other settings when it records the keys made", async () => {
      const { submit, saveSettings, form } = await boot({
        oneResponse: "off",
        internalNote: "Lahore meetup.",
        submitButtonText: "Save my seat",
      });
      expect((await submit({ email: "ada@example.com" })).success).toBe(true);
      await saveSettings({ oneResponse: "email", oneResponseField: "email" });
      expect((await form()).settings).toMatchObject({
        internalNote: "Lahore meetup.",
        submitButtonText: "Save my seat",
        oneResponse: "email",
        oneResponseKeyedVersion: 1,
      });
    });

    it("never takes the version from a caller", async () => {
      const { saveSettings, form } = await boot({ oneResponse: "ip" });
      await saveSettings({
        oneResponseVersion: 7,
        oneResponseKeyedVersion: 7,
      });
      expect((await form()).settings).toMatchObject({ oneResponseVersion: 0 });
      expect((await form()).settings).not.toHaveProperty(
        "oneResponseKeyedVersion",
        7
      );
    });
  }
);
