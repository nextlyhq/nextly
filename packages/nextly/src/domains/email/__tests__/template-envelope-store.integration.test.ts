/**
 * The secret mark and a plugin's Reply-To across boots, on every dialect, and
 * the envelope columns reaching an existing installation.
 *
 * - The mark is the owner's: each boot stores its current declaration,
 *   overridden or not, and a plugin that stops running leaves its template
 *   with the mark it last declared.
 * - A plugin's Reply-To is what its template starts with; after that it is
 *   the site's setting, which the plugin's later versions never change.
 * - `cc`, `bcc` and `carries_secret` are added to an existing table in place
 *   by the core reconcile, its rows untouched.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import {
  availableDialects,
  withFreshDatabase,
  type FreshDatabase,
} from "../../../__tests__/helpers/fresh-database";
import {
  migrateFresh,
  noMigrationsDir,
} from "../../../__tests__/helpers/migrate-core";
import { NextlyError } from "../../../errors";
import type { PluginEmailTemplate } from "../../../plugins/contributions";
import { EmailTemplateService } from "../services/email-template-service";

import {
  openTemplateStore,
  silentLogger,
  TEMPLATE_STORE_DIALECTS,
  type TemplateStore,
} from "./template-ownership-fixture";

const SHOP = "@acme/plugin-shop";

const signIn = (extra: Partial<PluginEmailTemplate> = {}) => ({
  slug: "shop-sign-in",
  name: "Sign in",
  subject: "Your sign-in link",
  htmlContent: '<a href="{{link}}">Sign in</a>',
  ...extra,
});

/** Whether a stored boolean reads as true, however the dialect returns it. */
const isTrue = (value: unknown) => value === true || Number(value) === 1;

async function refusedCode(call: Promise<unknown>): Promise<string> {
  let caught: unknown;
  try {
    await call;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(NextlyError);
  const data = (caught as NextlyError).publicData as {
    errors: Array<{ code: string }>;
  };
  return data.errors[0]?.code ?? "";
}

for (const entry of TEMPLATE_STORE_DIALECTS) {
  const suite = entry.url ? describe : describe.skip;

  suite(`template envelope across boots — ${entry.dialect}`, () => {
    let store: TemplateStore;

    async function boot(
      templates: PluginEmailTemplate[] | null
    ): Promise<EmailTemplateService> {
      const service = store.newService();
      service.configureOwnership({
        plugins: templates === null ? [] : [{ name: SHOP, templates }],
      });
      await service.ensureBuiltInTemplates();
      return service;
    }

    async function storedMark(slug: string): Promise<unknown> {
      const q = store.q;
      const [row] = await store.query<Record<string, unknown>>(
        `SELECT ${q("carries_secret")} AS mark FROM ${q("email_templates")} WHERE ${q("slug")} = ?`,
        [slug]
      );
      return row?.mark;
    }

    async function idOf(
      service: EmailTemplateService,
      slug: string
    ): Promise<string> {
      const template = await service.getTemplateBySlug(slug);
      if (!template) expect.fail(`${slug} is missing`);
      return template.id;
    }

    beforeAll(async () => {
      store = await openTemplateStore(entry);
    }, 60_000);

    afterAll(async () => {
      await store?.close();
    });

    beforeEach(async () => {
      await store.clear();
    });

    it("stores core's marks at the first boot", async () => {
      await boot(null);
      expect(isTrue(await storedMark("password-reset"))).toBe(true);
      expect(isTrue(await storedMark("default-layout"))).toBe(false);
    });

    it("keeps a plugin's mark on its template after the plugin stops running", async () => {
      await boot([signIn({ carriesSecret: true })]);
      expect(isTrue(await storedMark("shop-sign-in"))).toBe(true);

      const without = await boot(null);
      const template = await without.getTemplateBySlug("shop-sign-in");
      expect(template).toMatchObject({
        owner: { kind: "plugin", name: SHOP, installed: false },
        carriesSecret: true,
      });
      expect(
        await refusedCode(
          without.updateTemplate(await idOf(without, "shop-sign-in"), {
            bcc: ["spy@evil.example"],
          })
        )
      ).toBe("CARRIES_SECRET");
    });

    it("follows the owner's mark at the next boot, overridden or not", async () => {
      const first = await boot([signIn()]);
      const id = await idOf(first, "shop-sign-in");
      // The site overrides it and copies its staff, which is allowed while
      // the plugin does not mark it.
      await first.updateTemplate(id, {
        subject: "Sign in to Acme",
        cc: ["staff@shop.example"],
      });
      expect(await first.getTemplate(id)).toMatchObject({
        overridden: true,
        carriesSecret: false,
      });

      // The plugin's next version marks it: the mark is stored even though
      // the site's version stays.
      const marked = await boot([signIn({ carriesSecret: true })]);
      expect(await marked.getTemplate(id)).toMatchObject({
        overridden: true,
        subject: "Sign in to Acme",
        carriesSecret: true,
      });
      expect(isTrue(await storedMark("shop-sign-in"))).toBe(true);

      // And a version that drops it clears it.
      const unmarked = await boot([signIn()]);
      expect((await unmarked.getTemplate(id)).carriesSecret).toBe(false);
      expect(isTrue(await storedMark("shop-sign-in"))).toBe(false);
    });

    it("starts a plugin's template with the plugin's Reply-To, then keeps the site's", async () => {
      const first = await boot([signIn({ replyTo: "{{ shopContact }}" })]);
      const id = await idOf(first, "shop-sign-in");
      expect((await first.getTemplate(id)).replyTo).toBe("{{ shopContact }}");

      await first.updateTemplate(id, { replyTo: "help@shop.example" });
      const later = await boot([signIn({ replyTo: "{{ supportEmail }}" })]);
      expect(await later.getTemplate(id)).toMatchObject({
        replyTo: "help@shop.example",
        overridden: false,
      });
    });
  });
}

/** The service over a fresh database, as a boot constructs it. */
function serviceOver(fresh: FreshDatabase): EmailTemplateService {
  const adapter = {
    dialect: fresh.dialect,
    getDrizzle: () => fresh.db,
    getCapabilities: () => ({ dialect: fresh.dialect }),
    connect: async () => {},
    disconnect: async () => {},
    executeQuery: async (sql: string) => {
      await fresh.exec(sql);
      return [];
    },
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(fresh.db),
  };
  return new EmailTemplateService(
    adapter as unknown as DrizzleAdapter,
    silentLogger
  );
}

/** The columns this change adds, none of them indexed. */
const ENVELOPE_COLUMNS = ["cc", "bcc", "carries_secret"];
const LEGACY_ID = "00000000-0000-4000-8000-0000000000e2";

const { dir: NO_MIGRATIONS, remove } = noMigrationsDir("nextly-ete-");
afterAll(remove);

describe.each(availableDialects())(
  "template envelope columns on an existing database (%s)",
  dialect => {
    it("adds them in place, keeps the rows, and the boot then stores core's marks", async () => {
      await withFreshDatabase(dialect, "nextly_ete_existing", async fresh => {
        await migrateFresh(fresh, NO_MIGRATIONS);
        for (const column of ENVELOPE_COLUMNS) {
          await fresh.exec(`ALTER TABLE email_templates DROP COLUMN ${column}`);
        }
        const yes = fresh.dialect === "postgresql" ? "true" : "1";
        const now =
          fresh.dialect === "sqlite" ? "1760000000" : "'2026-10-01 09:00:00'";
        await fresh.exec(
          `INSERT INTO email_templates (id, name, slug, subject, html_content, kind, use_layout, is_active, reply_to, created_at, updated_at) VALUES ('${LEGACY_ID}', 'Order paid', 'order-paid', 'Paid', '<p>Paid</p>', 'template', ${yes}, ${yes}, 'shop@example.com', ${now}, ${now})`
        );

        // The production reconcile adds the columns.
        expect(await migrateFresh(fresh, NO_MIGRATIONS)).toBe(true);
        expect(await fresh.columnsOf("email_templates")).toEqual(
          expect.arrayContaining(ENVELOPE_COLUMNS)
        );

        const service = serviceOver(fresh);
        service.configureOwnership({ plugins: [] });
        await service.ensureBuiltInTemplates();
        // The row as it was, with no copies and no mark.
        expect(await service.getTemplateBySlug("order-paid")).toMatchObject({
          subject: "Paid",
          replyTo: "shop@example.com",
          cc: null,
          bcc: null,
          carriesSecret: false,
        });
        // Read from the column, not the record: the record also reads the
        // running registry, so only the row shows the boot stored the mark.
        const db = fresh.db as unknown as {
          select: () => {
            from: (table: unknown) => {
              where: (cond: unknown) => Promise<Record<string, unknown>[]>;
            };
          };
        };
        const table = fresh.tables.emailTemplates as unknown as {
          slug: unknown;
        };
        const [reset] = await db
          .select()
          .from(table)
          .where(eq(table.slug as never, "password-reset"));
        expect(isTrue(reset?.carriesSecret)).toBe(true);

        // Nothing left to add.
        expect(await migrateFresh(fresh, NO_MIGRATIONS)).toBe(false);
      });
    }, 180_000);
  }
);
