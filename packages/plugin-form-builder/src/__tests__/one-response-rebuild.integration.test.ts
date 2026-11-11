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

    /**
     * `keysInSave: 0` sends every change of setting to the background sweep,
     * whatever the form's size, so a test can hold it.
     */
    async function boot(
      settings: Record<string, unknown>,
      options: { keysInSave?: number } = {}
    ) {
      const fb = formBuilder({
        spamProtection: { honeypot: false, recaptcha: { enabled: false } },
        ...(options.keysInSave === undefined
          ? {}
          : { oneResponse: { keysInSave: options.keysInSave } }),
      });
      /** Every key a stored submission's update committed with. */
      const committed: unknown[] = [];
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
              ctx.hooks.on("afterUpdate", "form-submissions", hook => {
                committed.push(
                  (hook as { data?: { responseKey?: unknown } }).data
                    ?.responseKey
                );
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
      /**
       * Wait until the form's keys are made for `version`. The sweep a save
       * starts runs after the save has answered, so this runs it again until
       * it has: a run is refused while another holds the sweep.
       */
      const settle = (version: number) =>
        expect
          .poll(
            async () => {
              await sweep();
              return (await form()).settings.oneResponseKeyedVersion;
            },
            { timeout: 20_000 }
          )
          .toBe(version);
      return {
        nextly,
        submit,
        form,
        saveSettings,
        rows,
        sweep,
        settle,
        gate,
        formId,
        committed,
      };
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

    it("answers the save with a revision the next save can use", async () => {
      const { nextly, submit, form, formId } = await boot({
        oneResponse: "off",
      });
      expect((await submit({ email: "ada@example.com" })).success).toBe(true);
      const read = (await nextly.findByID({
        collection: "forms",
        id: formId,
      })) as { _rev?: string; settings: Record<string, unknown> };
      const saved = (await nextly.update({
        collection: "forms",
        id: formId,
        data: {
          settings: {
            ...read.settings,
            oneResponse: "email",
            oneResponseField: "email",
          },
          _rev: read._rev,
        },
      })) as { item?: { _rev?: string }; _rev?: string };
      const rev = saved.item?._rev ?? saved._rev;
      expect(typeof rev).toBe("string");
      // The form's next save, from the revision the first answered with.
      await nextly.update({
        collection: "forms",
        id: formId,
        data: { name: "Meetup, renamed", _rev: rev },
      });
      expect((await form()).settings).toMatchObject({
        oneResponseVersion: 1,
        oneResponseKeyedVersion: 1,
      });
    });

    it("refuses a repeat while earlier submissions are still being counted", async () => {
      const { submit, saveSettings, rows, form, gate, settle } = await boot(
        { oneResponse: "off" },
        { keysInSave: 0 }
      );
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
      await settle(1);
      expect((await rows()).map(row => row.responseKey)).toEqual([
        expect.stringMatching(/^v1:/),
        expect.stringMatching(/^v1:/),
      ]);
    });

    it("writes nothing for a change the form has left while its sweep was held", async () => {
      const { submit, saveSettings, rows, form, gate, settle, committed } =
        await boot({ oneResponse: "off" }, { keysInSave: 0 });
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
      await settle(2);
      // The held sweep's write, made for version 1, was refused where it was
      // stored: no submission ever committed a key for the change the form
      // has left.
      expect(
        committed.filter(key => typeof key === "string" && /^v1:/.test(key))
      ).toEqual([]);

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
      const { nextly, submit, saveSettings, rows, gate, settle } = await boot(
        { oneResponse: "off" },
        { keysInSave: 0 }
      );
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
      await settle(1);

      expect((await rows())[0]?.responseKey).toBe(edited);
      expect(await submit({ email: "grace@example.com" })).toMatchObject({
        outcome: "duplicate",
      });
      expect((await submit({ email: "ada@example.com" })).success).toBe(true);
    });

    it("refuses an edit onto an earlier answer the sweep has not keyed yet", async () => {
      const { nextly, submit, saveSettings, rows, gate, settle } = await boot(
        { oneResponse: "off" },
        { keysInSave: 0 }
      );
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
      await settle(1);
      expect((await rows()).find(row => row.id === grace!.id)?.data.email).toBe(
        "grace@example.com"
      );
    });

    it("refuses a move onto a form whose earlier answer is not keyed yet", async () => {
      const { nextly, submit, saveSettings, rows, gate, settle, formId } =
        await boot({ oneResponse: "off" }, { keysInSave: 0 });
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
      await settle(1);
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

    /**
     * A form that started taking one per email with two earlier responses
     * from ada: the earliest holds the key, the later one none.
     */
    async function adaTwice() {
      const booted = await boot({ oneResponse: "off" });
      expect((await booted.submit({ email: "ada@example.com" })).success).toBe(
        true
      );
      await tick();
      expect((await booted.submit({ email: "ADA@example.com" })).success).toBe(
        true
      );
      await booted.saveSettings({
        oneResponse: "email",
        oneResponseField: "email",
      });
      const [holder, waiting] = await booted.rows();
      expect(holder?.responseKey).toMatch(/^v1:/);
      expect(waiting?.responseKey ?? null).toBeNull();
      return { ...booted, holder: holder!, waiting: waiting! };
    }

    for (const [how, leave] of [
      [
        "deleted",
        (nextly: TestNextly["nextly"], id: string) =>
          nextly.delete({ collection: "form-submissions", id }),
      ],
      [
        "marked spam",
        (nextly: TestNextly["nextly"], id: string) =>
          nextly.update({
            collection: "form-submissions",
            id,
            data: { status: "spam", _overwrite: true },
          }),
      ],
      [
        "edited to another address",
        (nextly: TestNextly["nextly"], id: string) =>
          nextly.update({
            collection: "form-submissions",
            id,
            data: { data: { email: "grace@example.com" }, _overwrite: true },
          }),
      ],
    ] as const) {
      it(`hands an email's key to the next response when its holder is ${how}`, async () => {
        const { nextly, submit, rows, holder, waiting } = await adaTwice();
        await leave(nextly, holder.id);
        const after = (await rows()).find(row => row.id === waiting.id);
        expect(after?.responseKey).toBe(holder.responseKey);
        expect(await submit({ email: "ada@example.com" })).toMatchObject({
          outcome: "duplicate",
        });
      });
    }

    it("hands a network's key to the next response from that address", async () => {
      const { nextly, submit, saveSettings, rows } = await boot({
        oneResponse: "off",
      });
      expect(
        (await submit({ email: "a@example.com" }, "203.0.113.9")).success
      ).toBe(true);
      await tick();
      expect(
        (await submit({ email: "b@example.com" }, "203.0.113.9")).success
      ).toBe(true);
      await saveSettings({ oneResponse: "ip" });
      const [holder, waiting] = await rows();
      await nextly.delete({ collection: "form-submissions", id: holder!.id });
      expect(
        (await rows()).find(row => row.id === waiting!.id)?.responseKey
      ).toBe(holder!.responseKey);
      expect(
        await submit({ email: "c@example.com" }, "203.0.113.9")
      ).toMatchObject({ outcome: "duplicate" });
    });

    it("frees the value when no other response holds it", async () => {
      const { nextly, submit, saveSettings, rows } = await boot({
        oneResponse: "off",
      });
      expect((await submit({ email: "ada@example.com" })).success).toBe(true);
      await saveSettings({ oneResponse: "email", oneResponseField: "email" });
      const [holder] = await rows();
      await nextly.delete({ collection: "form-submissions", id: holder!.id });
      expect((await submit({ email: "ada@example.com" })).success).toBe(true);
    });

    it("carries a browser's key to another form at that form's version", async () => {
      const { nextly, rows, formId, saveSettings } = await boot({
        oneResponse: "off",
      });
      // This form takes one per browser at version 1; the other at 0.
      await saveSettings({ oneResponse: "browser" });
      const other = await nextly.create({
        collection: "forms",
        data: {
          name: "Other",
          slug: "other",
          status: "published",
          fields: FIELDS,
          settings: { oneResponse: "browser" },
        },
      });
      const token = (n: number) => `3b241101-e2bb-4255-8caf-4136c566a96${n}`;
      const store = (form: unknown, n: number) =>
        nextly.create({
          collection: "form-submissions",
          data: {
            form,
            data: {
              email: `p${n}@example.com`,
              "nextly-browser-token": token(n),
            },
          },
        });
      await store(formId, 1);
      const same = await store(other.item.id, 1);
      const fresh = await store(other.item.id, 2);
      const move = (id: unknown) =>
        nextly.update({
          collection: "form-submissions",
          id: String(id),
          data: { form: formId, _overwrite: true },
        });

      // The same browser has responded here already: refused.
      await expect(move(same.item.id)).rejects.toThrow();
      // Another browser: its key comes along, spelled for this form.
      await move(fresh.item.id);
      const carried = (await rows()).find(
        row => row.id === String(fresh.item.id)
      );
      expect(carried?.responseKey).toMatch(/^v1:browser:[0-9a-f]{64}$/);
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
