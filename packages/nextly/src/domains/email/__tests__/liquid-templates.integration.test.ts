/**
 * Liquid templates on a running instance, on every configured dialect.
 *
 * - Stored templates the old engine would read differently keep its rendering
 *   after the upgrade, flagged, until their flagged text is changed and
 *   confirmed; saving other fields keeps them as they are.
 * - Text Liquid can't read is refused on save, naming the line.
 * - A stored template that cannot be rendered fails the send before any
 *   provider is asked, and is marked not retryable.
 * - Lists and objects reach a template through the Direct API, and a
 *   commerce-shaped template loops and branches on them.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { dispatchEmailTemplates } from "../../../dispatcher/handlers/email-dispatcher";
import { NextlyError } from "../../../errors";
import type { PluginEmailTemplate } from "../../../plugins/contributions";
import { definePlugin } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { parseRestRoute } from "../../../route-handler/route-parser";
import { defineEmailProvider } from "../provider-definition";
import type { EmailTemplateService } from "../services/email-template-service";
import { interpolateTemplate } from "../services/template-engine";

const sent: Array<{ to: string; subject: string; html: string }> = [];
let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  sent.length = 0;
});

/** A plugin whose provider keeps what it is handed, so nothing leaves the test. */
const capturing = definePlugin({
  name: "capturing-mail",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    emailProviders: [
      defineEmailProvider<{ apiKey: string }>({
        type: "capturing-mailer",
        label: "Capturing Mailer",
        configFields: [
          {
            name: "apiKey",
            label: "API Key",
            kind: "password",
            required: true,
            secret: true,
          },
        ],
        parseConfig: (input: unknown) => ({
          apiKey: String((input as { apiKey?: unknown }).apiKey ?? "key"),
        }),
        createAdapter: () => ({
          send: async (opts: { to: string; subject: string; html: string }) => {
            sent.push({ to: opts.to, subject: opts.subject, html: opts.html });
            return { success: true, messageId: `captured-${sent.length}` };
          },
        }),
      }),
    ],
  },
} as never);

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({ dialect, plugins: [capturing] });
  await current.nextly.emailProviders.create({
    data: {
      name: "Capturing",
      type: "capturing-mailer",
      fromEmail: "from@example.com",
      configuration: { apiKey: "throwaway-test-key" },
      isDefault: true,
    },
  });
  return current;
}

const templates = (t: TestNextly) =>
  t.getService("emailTemplateService") as unknown as EmailTemplateService;

/** Boot again with a plugin that contributes `contributed`. */
async function seedPluginTemplates(
  t: TestNextly,
  contributed: PluginEmailTemplate[]
): Promise<void> {
  templates(t).configureOwnership({
    plugins: [{ name: "promo-plugin", templates: contributed }],
  });
  await templates(t).ensureBuiltInTemplates();
}

/**
 * Store a template as an install before Liquid did, straight into the
 * table: some of what these hold no longer passes the save-time check.
 */
async function storeAsBefore(
  t: TestNextly,
  dialect: TestDialect,
  slug: string,
  htmlContent: string
): Promise<string> {
  const id = randomUUID();
  const q = (n: string) => (dialect === "mysql" ? `\`${n}\`` : `"${n}"`);
  const p = (i: number) => (dialect === "postgresql" ? `$${i}` : "?");
  const columns = [
    "id",
    "name",
    "slug",
    "subject",
    "html_content",
    "kind",
    "use_layout",
    "is_active",
    "created_at",
    "updated_at",
  ];
  const now = new Date();
  await t.adapter.executeQuery(
    `INSERT INTO ${q("email_templates")} (${columns.map(q).join(", ")}) VALUES (${columns.map((_, i) => p(i + 1)).join(", ")})`,
    [
      id,
      slug,
      slug,
      "Hello {{name}}",
      htmlContent,
      "template",
      dialect === "postgresql" ? false : 0,
      dialect === "postgresql" ? true : 1,
      now,
      now,
    ]
  );
  return id;
}

const LITERAL_IF = "<p>Members: {% if vip %}VIP{% endif %} {{name}}</p>";
const FILTER = "<p>Hi {{ name | upcase }}</p>";
const UNREADABLE = "<p>Use code {%SPRING25%}, {{name}}.</p>";
const PLAIN = "<p>Hi {{name}}</p>";
const DATA = { name: "Priya <3", vip: true };

for (const dialect of getConfiguredTestDialects()) {
  describe(`Liquid templates — ${dialect}`, () => {
    it("keeps each stored template the old engine read differently, rendering as before, flagged until changed and confirmed", async () => {
      const t = await boot(dialect);
      const ids = {
        literalIf: await storeAsBefore(t, dialect, "literal-if", LITERAL_IF),
        filter: await storeAsBefore(t, dialect, "with-filter", FILTER),
        unreadable: await storeAsBefore(t, dialect, "unreadable", UNREADABLE),
        plain: await storeAsBefore(t, dialect, "plain", PLAIN),
      };
      // The first boot on Liquid records which ones it keeps.
      await templates(t).ensureBuiltInTemplates();

      for (const [key, html] of [
        ["literalIf", LITERAL_IF],
        ["filter", FILTER],
        ["unreadable", UNREADABLE],
      ] as const) {
        const preview = await t.nextly.emailTemplates.preview({
          id: ids[key],
          data: DATA,
        });
        expect(preview.html).toBe(interpolateTemplate(html, DATA));
        const status = await templates(t).oldEngineStatus(ids[key]);
        expect(status.kept).toBe(true);
        expect(status.reasons[0]).toMatchObject({
          field: "htmlContent",
          label: "HTML",
        });
      }
      // The control: an ordinary template is Liquid, and not flagged.
      expect((await templates(t).oldEngineStatus(ids.plain)).kept).toBe(false);
      expect(
        (await t.nextly.emailTemplates.preview({ id: ids.plain, data: DATA }))
          .html
      ).toBe("<p>Hi Priya &lt;3</p>");

      // Saving another field keeps it on the old engine.
      await t.nextly.emailTemplates.update({
        id: ids.literalIf,
        data: { name: "Members" },
      });
      expect((await templates(t).oldEngineStatus(ids.literalIf)).kept).toBe(
        true
      );

      // Confirming text nobody changed is refused: it would change the email.
      await expect(
        templates(t).confirmLiquid(ids.literalIf)
      ).rejects.toMatchObject({
        code: "BUSINESS_RULE_VIOLATION",
      });

      // Changed, then confirmed: it is Liquid from now on.
      await t.nextly.emailTemplates.update({
        id: ids.literalIf,
        data: {
          htmlContent: "<p>Members: {% if vip %}VIP{% endif %} {{ name }}</p>",
        },
      });
      await templates(t).confirmLiquid(ids.literalIf);
      expect((await templates(t).oldEngineStatus(ids.literalIf)).kept).toBe(
        false
      );
      expect(
        (
          await t.nextly.emailTemplates.preview({
            id: ids.literalIf,
            data: DATA,
          })
        ).html
      ).toBe("<p>Members: VIP Priya &lt;3</p>");

      // A later boot leaves the record as it is.
      await templates(t).ensureBuiltInTemplates();
      expect((await templates(t).oldEngineStatus(ids.filter)).kept).toBe(true);
      expect((await templates(t).oldEngineStatus(ids.literalIf)).kept).toBe(
        false
      );
    });

    it("records the switch on a boot that has nothing left to seed, so new templates are Liquid", async () => {
      const t = await boot(dialect);
      // Every built-in is already there: this boot seeds nothing.
      await templates(t).ensureBuiltInTemplates();
      await templates(t).ensureBuiltInTemplates();
      const created = await t.nextly.emailTemplates.create({
        data: {
          name: "Shout",
          slug: "shout",
          subject: "Hi",
          htmlContent: FILTER,
          useLayout: false,
        },
      });
      expect((await templates(t).oldEngineStatus(created.item.id)).kept).toBe(
        false
      );
      expect(
        (
          await t.nextly.emailTemplates.preview({
            id: created.item.id,
            data: DATA,
          })
        ).html
      ).toBe("<p>Hi PRIYA &lt;3</p>");
    });

    it("confirms only once every flagged field changed, and previews a kept template's draft as it sends", async () => {
      const t = await boot(dialect);
      const id = await storeAsBefore(t, dialect, "literal-if", LITERAL_IF);
      await templates(t).ensureBuiltInTemplates();

      // Another field changed, the flagged HTML as it was: refused.
      await t.nextly.emailTemplates.update({
        id,
        data: { subject: "Hello {{ name }}" },
      });
      await expect(templates(t).confirmLiquid(id)).rejects.toMatchObject({
        code: "BUSINESS_RULE_VIOLATION",
        publicMessage: expect.stringContaining("HTML"),
      });

      const draft = {
        subject: "Hi",
        htmlContent: LITERAL_IF,
        plainTextContent: null,
        preheader: null,
        useLayout: false,
        kind: "template" as const,
        layoutId: null,
      };
      // A draft of the kept template previews with the old engine...
      expect(
        (await templates(t).previewDraft({ ...draft, id }, DATA)).html
      ).toBe(interpolateTemplate(LITERAL_IF, DATA));
      // ...and the same fields with no saved template behind them, as Liquid.
      expect((await templates(t).previewDraft(draft, DATA)).html).toBe(
        "<p>Members: VIP Priya &lt;3</p>"
      );
    });

    it("keeps a plugin's template seeded after the switch on the old engine when that engine reads it differently", async () => {
      const t = await boot(dialect);
      await templates(t).ensureBuiltInTemplates();
      await seedPluginTemplates(t, [
        {
          name: "Promo",
          slug: "promo",
          subject: "Hi",
          htmlContent: UNREADABLE,
          useLayout: false,
        },
        {
          name: "Plain",
          slug: "plain-plugin",
          subject: "Hi",
          htmlContent: PLAIN,
        },
      ]);
      const promo = await t.nextly.emailTemplates.findBySlug({ slug: "promo" });
      expect((await templates(t).oldEngineStatus(promo!.id)).kept).toBe(true);
      expect(
        (await t.nextly.emailTemplates.preview({ id: promo!.id, data: DATA }))
          .html
      ).toBe(interpolateTemplate(UNREADABLE, DATA));
      // The control: an ordinary contribution is Liquid.
      const plain = await t.nextly.emailTemplates.findBySlug({
        slug: "plain-plugin",
      });
      expect((await templates(t).oldEngineStatus(plain!.id)).kept).toBe(false);
    });

    it("writes no plugin row when its engine choice can't be recorded, so the next boot tries again", async () => {
      const t = await boot(dialect);
      await templates(t).ensureBuiltInTemplates();
      const promo = [
        {
          name: "Promo",
          slug: "promo",
          subject: "Hi",
          htmlContent: UNREADABLE,
          useLayout: false,
        },
      ];
      const meta = (
        templates(t) as unknown as {
          meta: { insertIfAbsent: () => Promise<unknown> };
        }
      ).meta;
      const spy = vi
        .spyOn(meta, "insertIfAbsent")
        .mockRejectedValueOnce(new Error("connection reset"));
      await expect(seedPluginTemplates(t, promo)).rejects.toThrow();
      expect(
        await t.nextly.emailTemplates.findBySlug({
          slug: "promo",
          disableErrors: true,
        })
      ).toBeNull();
      spy.mockRestore();

      await seedPluginTemplates(t, promo);
      const row = await t.nextly.emailTemplates.findBySlug({ slug: "promo" });
      expect((await templates(t).oldEngineStatus(row!.id)).kept).toBe(true);
    });

    it("leaves no engine choice behind when a plugin row can't be written", async () => {
      const t = await boot(dialect);
      await templates(t).ensureBuiltInTemplates();
      const service = templates(t) as unknown as {
        db: { insert: () => unknown };
        meta: { getAll(): Promise<Record<string, unknown>> };
      };
      const keptKeys = async () =>
        Object.keys(await service.meta.getAll()).filter(key =>
          key.startsWith("email.templates.liquid.kept.")
        );
      const before = await keptKeys();
      const spy = vi.spyOn(service.db, "insert").mockImplementationOnce(() => {
        throw new Error("value too long for column");
      });
      await seedPluginTemplates(t, [
        {
          name: "Promo",
          slug: "promo",
          subject: "Hi",
          htmlContent: UNREADABLE,
          useLayout: false,
        },
      ]);
      spy.mockRestore();
      expect(
        await t.nextly.emailTemplates.findBySlug({
          slug: "promo",
          disableErrors: true,
        })
      ).toBeNull();
      expect(await keptKeys()).toEqual(before);
    });

    it("leaves a template saved as Liquid before the switch was recorded as Liquid", async () => {
      const t = await boot(dialect);
      await templates(t).ensureBuiltInTemplates();
      // As the first boot on Liquid, before its switch is recorded.
      const meta = (
        templates(t) as unknown as {
          meta: { delete(key: string): Promise<void> };
        }
      ).meta;
      await meta.delete("email.templates.liquid.adoptedAt");
      const created = await t.nextly.emailTemplates.create({
        data: {
          name: "Shout",
          slug: "shout",
          subject: "Hi",
          htmlContent: FILTER,
          useLayout: false,
        },
      });
      await templates(t).ensureBuiltInTemplates();
      expect((await templates(t).oldEngineStatus(created.item.id)).kept).toBe(
        false
      );
      expect(
        (
          await t.nextly.emailTemplates.preview({
            id: created.item.id,
            data: DATA,
          })
        ).html
      ).toBe("<p>Hi PRIYA &lt;3</p>");
    });

    it("reads a plugin's contribution written in Liquid as Liquid", async () => {
      const t = await boot(dialect);
      await templates(t).ensureBuiltInTemplates();
      await seedPluginTemplates(t, [
        {
          name: "Shout",
          slug: "plugin-shout",
          subject: "Hi",
          htmlContent: FILTER,
          useLayout: false,
        },
      ]);
      const row = await t.nextly.emailTemplates.findBySlug({
        slug: "plugin-shout",
      });
      expect((await templates(t).oldEngineStatus(row!.id)).kept).toBe(false);
      expect(
        (await t.nextly.emailTemplates.preview({ id: row!.id, data: DATA }))
          .html
      ).toBe("<p>Hi PRIYA &lt;3</p>");
    });

    it("reads a plugin's Liquid contribution as Liquid on a new install's first boot", async () => {
      const t = await boot(dialect);
      // No boot has recorded the switch: this one seeds the plugin's
      // template and records it.
      await seedPluginTemplates(t, [
        {
          name: "Shout",
          slug: "plugin-shout",
          subject: "Hi",
          htmlContent: FILTER,
          useLayout: false,
        },
      ]);
      const row = await t.nextly.emailTemplates.findBySlug({
        slug: "plugin-shout",
      });
      expect((await templates(t).oldEngineStatus(row!.id)).kept).toBe(false);
      expect(
        (await t.nextly.emailTemplates.preview({ id: row!.id, data: DATA }))
          .html
      ).toBe("<p>Hi PRIYA &lt;3</p>");
    });

    it("renders a plugin's template on the engine its current version was written for", async () => {
      const t = await boot(dialect);
      await templates(t).ensureBuiltInTemplates();
      const shipping = (htmlContent: string) =>
        seedPluginTemplates(t, [
          {
            name: "Promo",
            slug: "promo",
            subject: "Hi",
            htmlContent,
            useLayout: false,
          },
        ]);
      const kept = async () => {
        const row = await t.nextly.emailTemplates.findBySlug({ slug: "promo" });
        return (await templates(t).oldEngineStatus(row!.id)).kept;
      };
      await shipping(UNREADABLE);
      expect(await kept()).toBe(true);
      // The plugin's next release is written in Liquid.
      await shipping(FILTER);
      expect(await kept()).toBe(false);
      const row = await t.nextly.emailTemplates.findBySlug({ slug: "promo" });
      expect(
        (await t.nextly.emailTemplates.preview({ id: row!.id, data: DATA }))
          .html
      ).toBe("<p>Hi PRIYA &lt;3</p>");
      // And one written for the engine before it is kept on that engine.
      await shipping(UNREADABLE);
      expect(await kept()).toBe(true);
    });

    it("keeps a template on the old engine when a confirmation overtakes a save Liquid can't read", async () => {
      const t = await boot(dialect);
      const id = await storeAsBefore(t, dialect, "literal-if", LITERAL_IF);
      await templates(t).ensureBuiltInTemplates();
      const service = templates(t) as unknown as {
        checkLiquidOnSave(...args: unknown[]): Promise<boolean>;
        meta: { delete(key: string): Promise<void> };
      };
      const original = service.checkLiquidOnSave.bind(service);
      // The save is checked while the template is kept; a confirmation then
      // removes the mark before the save writes.
      const spy = vi
        .spyOn(service, "checkLiquidOnSave")
        .mockImplementationOnce(async (...args: unknown[]) => {
          const kept = await original(...args);
          await service.meta.delete(`email.templates.liquid.kept.${id}`);
          return kept;
        });
      await t.nextly.emailTemplates.update({
        id,
        data: { htmlContent: UNREADABLE },
      });
      spy.mockRestore();
      expect((await templates(t).oldEngineStatus(id)).kept).toBe(true);
      expect(
        (await t.nextly.emailTemplates.preview({ id, data: DATA })).html
      ).toBe(interpolateTemplate(UNREADABLE, DATA));
    });

    it("keeps a template on the old engine when a confirmation overtakes a save of the old engine's syntax", async () => {
      const t = await boot(dialect);
      const id = await storeAsBefore(t, dialect, "literal-if", LITERAL_IF);
      await templates(t).ensureBuiltInTemplates();
      const service = templates(t) as unknown as {
        checkLiquidOnSave(...args: unknown[]): Promise<unknown>;
        meta: { delete(key: string): Promise<void> };
      };
      const original = service.checkLiquidOnSave.bind(service);
      const spy = vi
        .spyOn(service, "checkLiquidOnSave")
        .mockImplementationOnce(async (...args: unknown[]) => {
          const afterSave = await original(...args);
          await service.meta.delete(`email.templates.liquid.kept.${id}`);
          return afterSave;
        });
      // Liquid parses it, and reads its tag as a condition the old engine
      // sent as text.
      const restored = "<p>Now: {% if vip %}VIP{% endif %} {{name}}</p>";
      await t.nextly.emailTemplates.update({
        id,
        data: { htmlContent: restored },
      });
      spy.mockRestore();
      expect((await templates(t).oldEngineStatus(id)).kept).toBe(true);
      expect(
        (await t.nextly.emailTemplates.preview({ id, data: DATA })).html
      ).toBe(interpolateTemplate(restored, DATA));
    });

    it("refuses an override whose text Liquid can't read", async () => {
      const t = await boot(dialect);
      await templates(t).ensureBuiltInTemplates();
      await seedPluginTemplates(t, [
        {
          name: "Plain",
          slug: "plain-plugin",
          subject: "Hi",
          htmlContent: PLAIN,
        },
      ]);
      const row = await t.nextly.emailTemplates.findBySlug({
        slug: "plain-plugin",
      });
      await expect(
        templates(t).overrideTemplate(row!.id, {
          version: { htmlContent: UNREADABLE },
        })
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      // The control: an override Liquid reads is written.
      const overridden = await templates(t).overrideTemplate(row!.id, {
        version: { htmlContent: FILTER },
      });
      expect(overridden.htmlContent).toBe(FILTER);
    });

    it("keeps the owner's version Reset writes on the old engine when Liquid can't read it", async () => {
      const t = await boot(dialect);
      await templates(t).ensureBuiltInTemplates();
      const shipping = (htmlContent: string) =>
        seedPluginTemplates(t, [
          { name: "Promo", slug: "promo", subject: "Hi", htmlContent },
        ]);
      await shipping(PLAIN);
      const row = await t.nextly.emailTemplates.findBySlug({ slug: "promo" });
      // The site overrides it, then the plugin ships text for the old engine.
      await t.nextly.emailTemplates.update({
        id: row!.id,
        data: { htmlContent: FILTER },
      });
      await shipping(UNREADABLE);
      await templates(t).resetTemplate(row!.id);
      expect((await templates(t).oldEngineStatus(row!.id)).kept).toBe(true);
      const preview = await templates(t).previewTemplate(row!.id, DATA);
      expect(preview.html).toContain(interpolateTemplate(UNREADABLE, DATA));
    });

    it("takes back the old-engine mark when the owner's version doesn't land or fails", async () => {
      const t = await boot(dialect);
      await templates(t).ensureBuiltInTemplates();
      const shipping = (htmlContent: string) =>
        seedPluginTemplates(t, [
          {
            name: "Promo",
            slug: "promo",
            subject: "Hi",
            htmlContent,
            useLayout: false,
          },
        ]);
      await shipping(PLAIN);
      const row = await t.nextly.emailTemplates.findBySlug({ slug: "promo" });
      const id = row!.id;
      const service = templates(t) as unknown as {
        keepIfWrittenForOldEngine(...args: unknown[]): Promise<unknown>;
        db: { update: () => unknown };
      };
      const original = service.keepIfWrittenForOldEngine.bind(service);
      const between = (act: () => Promise<unknown> | void) =>
        vi
          .spyOn(service, "keepIfWrittenForOldEngine")
          .mockImplementationOnce(async (...args: unknown[]) => {
            const engine = await original(...args);
            await act();
            return engine;
          });

      // The write fails: the mark recorded for it goes too.
      let failing: { mockRestore(): void } | undefined;
      const failed = between(() => {
        failing = vi.spyOn(service.db, "update").mockImplementationOnce(() => {
          throw new Error("connection reset");
        });
      });
      await expect(shipping(UNREADABLE)).rejects.toThrow("connection reset");
      failed.mockRestore();
      failing?.mockRestore();
      expect((await templates(t).oldEngineStatus(id)).kept).toBe(false);

      // The site saves in between, so the owner's version doesn't land: the
      // site's Liquid override renders as Liquid.
      const raced = between(() =>
        t.nextly.emailTemplates.update({ id, data: { htmlContent: FILTER } })
      );
      await shipping(UNREADABLE);
      raced.mockRestore();
      expect((await templates(t).oldEngineStatus(id)).kept).toBe(false);
      expect(
        (await t.nextly.emailTemplates.preview({ id, data: DATA })).html
      ).toBe("<p>Hi PRIYA &lt;3</p>");
    });

    it("refuses a layout whose body marker sits where Liquid writes nothing", async () => {
      const t = await boot(dialect);
      await templates(t).ensureBuiltInTemplates();
      await expect(
        t.nextly.emailTemplates.create({
          data: {
            name: "Hidden body",
            slug: "hidden-body",
            subject: "",
            kind: "layout",
            htmlContent: "<div>{% raw %}{{content}}{% endraw %}</div>",
          },
        })
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      await expect(
        t.nextly.emailTemplates.create({
          data: {
            name: "Quoted body",
            slug: "quoted-body",
            subject: "",
            kind: "layout",
            htmlContent: "{% assign x = '{{content}}' %}<div>layout</div>",
          },
        })
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      // The control: the same layout with the marker outside is accepted.
      await t.nextly.emailTemplates.create({
        data: {
          name: "Shown body",
          slug: "shown-body",
          subject: "",
          kind: "layout",
          htmlContent: "<div>{{content}}</div>",
        },
      });
    });

    it("raises a failure to read the switch rather than rendering with the old engine", async () => {
      const t = await boot(dialect);
      await templates(t).ensureBuiltInTemplates();
      const created = await t.nextly.emailTemplates.create({
        data: {
          name: "Shout",
          slug: "shout",
          subject: "Hi",
          htmlContent: FILTER,
        },
      });
      const meta = (
        templates(t) as unknown as {
          meta: { getEntry: () => Promise<unknown> };
        }
      ).meta;
      const spy = vi
        .spyOn(meta, "getEntry")
        .mockRejectedValue(new Error("connection reset"));
      await expect(
        t.nextly.emailTemplates.preview({ id: created.item.id, data: DATA })
      ).rejects.toThrow();
      spy.mockRestore();
    });

    it("refuses to save text Liquid can't read, naming the field and the line, on the route and the Direct API", async () => {
      const t = await boot(dialect);
      await templates(t).ensureBuiltInTemplates();
      const broken = {
        name: "Broken",
        slug: "broken",
        subject: "Hi",
        htmlContent: "<p>ok</p>\n<p>{% if vip %}VIP</p>",
      };

      const route = parseRestRoute(["email-templates"], "POST");
      expect(route.method).toBe("createTemplate");
      let caught: unknown;
      try {
        await dispatchEmailTemplates(
          route.method as string,
          route.routeParams ?? {},
          broken
        );
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(NextlyError);
      expect((caught as NextlyError).publicData).toMatchObject({
        errors: [
          {
            path: "htmlContent",
            code: "LIQUID_SYNTAX",
            message: expect.stringMatching(/^HTML, line 2: /),
          },
        ],
      });

      await expect(
        t.nextly.emailTemplates.create({
          data: { ...broken, subject: "Hi {{ name | nope }}" },
        })
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect(
        await t.nextly.emailTemplates.findBySlug({
          slug: "broken",
          disableErrors: true,
        })
      ).toBeNull();
    });

    it("fails a send whose stored template can't be rendered, before any provider, as not retryable", async () => {
      const t = await boot(dialect);
      await templates(t).ensureBuiltInTemplates();
      await t.nextly.emailTemplates.create({
        data: {
          name: "Runaway",
          slug: "runaway",
          subject: "Hi",
          htmlContent: "{% for i in (1..100000000) %}{{ i }}{% endfor %}",
          useLayout: false,
        },
      });

      let caught: unknown;
      try {
        await t.nextly.email.sendWithTemplate({
          to: "a@example.com",
          template: "runaway",
          variables: {},
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(NextlyError);
      expect((caught as NextlyError).logContext).toMatchObject({
        retryable: false,
      });
      expect(sent).toEqual([]);

      // The control: the same provider delivers an ordinary template.
      await t.nextly.emailTemplates.create({
        data: {
          name: "Fine",
          slug: "fine",
          subject: "Hi",
          htmlContent: "<p>fine</p>",
          useLayout: false,
        },
      });
      await t.nextly.email.sendWithTemplate({
        to: "a@example.com",
        template: "fine",
        variables: {},
      });
      expect(sent).toHaveLength(1);
    });

    it("takes lists and objects through the Direct API, and renders order lines with a paid or due branch", async () => {
      const t = await boot(dialect);
      await templates(t).ensureBuiltInTemplates();
      await t.nextly.emailTemplates.create({
        data: {
          name: "Order confirmation",
          slug: "order-confirmation",
          subject: "Order #{{ order.number }}",
          htmlContent: [
            "{% for line in order.lines %}<p>{{ line.quantity }} × {{ line.title }}</p>{% endfor %}",
            "{% if order.balance_due > 0 %}<p>Still to pay: {{ order.balance_due }}</p>{% else %}<p>Paid in full.</p>{% endif %}",
          ].join("\n"),
          useLayout: false,
        },
      });

      await t.nextly.email.sendWithTemplate({
        to: "buyer@example.com",
        template: "order-confirmation",
        variables: {
          order: {
            number: 1042,
            balance_due: 125,
            lines: [
              { quantity: 1, title: "Tent" },
              { quantity: 2, title: "Socks <wool>" },
            ],
          },
        },
      });
      await t.nextly.email.sendWithTemplate({
        to: "buyer@example.com",
        template: "order-confirmation",
        variables: { order: { number: 1043, balance_due: 0, lines: [] } },
      });

      expect(sent[0]).toMatchObject({ subject: "Order #1042" });
      expect(sent[0].html).toContain(
        "<p>1 × Tent</p><p>2 × Socks &lt;wool&gt;</p>"
      );
      expect(sent[0].html).toContain("<p>Still to pay: 125</p>");
      expect(sent[1].html).toContain("<p>Paid in full.</p>");
    });
  });
}
