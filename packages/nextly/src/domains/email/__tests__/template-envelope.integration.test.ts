/**
 * A template's envelope on a running instance, on every configured dialect.
 *
 * - Reply-To and the From display name render from the send's variables; a
 *   variable From address is refused on save, on the REST route and the
 *   Direct API.
 * - A send whose rendered Reply-To is not an address fails before any
 *   provider is asked, as not retryable, naming the field.
 * - A template's cc and bcc are added after the send's own, without
 *   duplicates; a variable in them is refused on save.
 * - A template its owner marks as carrying a secret refuses cc and bcc on
 *   save, and sends none even when they are written straight to its row.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { dispatchEmailTemplates } from "../../../dispatcher/handlers/email-dispatcher";
import { NextlyError } from "../../../errors";
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

interface Captured {
  to: string;
  from?: string;
  replyTo?: string;
  cc?: string[];
  bcc?: string[];
  subject: string;
}

const sent: Captured[] = [];
let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  sent.length = 0;
});

/** A plugin whose provider keeps the envelope it is handed, so nothing leaves the test. */
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
          send: async (opts: Captured) => {
            sent.push({
              to: opts.to,
              from: opts.from,
              replyTo: opts.replyTo,
              cc: opts.cc,
              bcc: opts.bcc,
              subject: opts.subject,
            });
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
  await templates(current).ensureBuiltInTemplates();
  return current;
}

const templates = (t: TestNextly) =>
  t.getService("emailTemplateService") as unknown as EmailTemplateService;

/** Call a template route through the REST dispatcher, as a request would. */
async function rest(
  method: "POST" | "PATCH",
  path: string[],
  body: Record<string, unknown>
): Promise<unknown> {
  const route = parseRestRoute(path, method);
  return dispatchEmailTemplates(
    route.method as string,
    route.routeParams ?? {},
    body
  );
}

/** The validation errors a call is refused with. */
async function refusal(
  call: Promise<unknown>
): Promise<Array<{ path: string; code: string }>> {
  let caught: unknown;
  try {
    await call;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(NextlyError);
  expect((caught as NextlyError).code).toBe("VALIDATION_ERROR");
  const data = (caught as NextlyError).publicData as {
    errors: Array<{ path: string; code: string }>;
  };
  return data.errors.map(({ path, code }) => ({ path, code }));
}

const site = (slug: string, extra: Record<string, unknown> = {}) => ({
  name: slug,
  slug,
  subject: "Hello",
  htmlContent: "<p>Hello</p>",
  useLayout: false,
  ...extra,
});

/** Write a template's copies straight to its row, past every save-time check. */
async function writeCopiesDirectly(
  t: TestNextly,
  dialect: TestDialect,
  slug: string,
  cc: string[]
): Promise<void> {
  const q = (n: string) => (dialect === "mysql" ? `\`${n}\`` : `"${n}"`);
  const p = (i: number) => (dialect === "postgresql" ? `$${i}` : "?");
  await t.adapter.executeQuery(
    `UPDATE ${q("email_templates")} SET ${q("cc")} = ${p(1)} WHERE ${q("slug")} = ${p(2)}`,
    [JSON.stringify(cc), slug]
  );
}

for (const dialect of getConfiguredTestDialects()) {
  describe(`template envelope (${dialect})`, () => {
    it("renders Reply-To and the From display name from the send's variables, keeping the From address", async () => {
      const t = await boot(dialect);
      await t.nextly.emailTemplates.create({
        data: site("order-paid", {
          fromOverride: "{{ shopName }} Orders <orders@shop.example>",
          replyTo: "{{ customer.email }}",
        }),
      });

      await t.nextly.email.sendWithTemplate({
        to: "buyer@example.com",
        template: "order-paid",
        variables: {
          shopName: "Acme",
          customer: { email: "contact@buyer.example" },
        },
      });

      expect(sent).toEqual([
        expect.objectContaining({
          to: "buyer@example.com",
          from: "Acme Orders <orders@shop.example>",
          replyTo: "contact@buyer.example",
        }),
      ]);
    });

    it("lets the send's own From and Reply-To win over the template's, as before", async () => {
      const t = await boot(dialect);
      await t.nextly.emailTemplates.create({
        data: site("order-paid", {
          fromOverride: "{{ shopName }} <orders@shop.example>",
          replyTo: "{{ customer.email }}",
        }),
      });

      // The template's Reply-To would fail to render as an address here; the
      // send's own replaces it, so it is never rendered.
      await t.nextly.email.sendWithTemplate({
        to: "buyer@example.com",
        template: "order-paid",
        variables: { customer: { email: "not an address" } },
        from: "Desk <desk@shop.example>",
        replyTo: "desk@shop.example",
      });

      expect(sent).toEqual([
        expect.objectContaining({
          from: "Desk <desk@shop.example>",
          replyTo: "desk@shop.example",
        }),
      ]);
    });

    it("fails a send whose rendered Reply-To is not an address, before any provider, as not retryable", async () => {
      const t = await boot(dialect);
      await t.nextly.emailTemplates.create({
        data: site("form-notice", { replyTo: "{{ submitter }}" }),
      });

      let caught: unknown;
      try {
        await t.nextly.email.sendWithTemplate({
          to: "team@shop.example",
          template: "form-notice",
          variables: { submitter: "Jane from the contact form" },
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(NextlyError);
      expect((caught as NextlyError).publicMessage).toMatch(/Reply-To/);
      expect((caught as NextlyError).logContext).toMatchObject({
        retryable: false,
        field: "replyTo",
        slug: "form-notice",
      });
      expect(sent).toEqual([]);

      // The control: the same template, rendering an address, is delivered.
      await t.nextly.email.sendWithTemplate({
        to: "team@shop.example",
        template: "form-notice",
        variables: { submitter: "jane@example.com" },
      });
      expect(sent).toEqual([
        expect.objectContaining({ replyTo: "jane@example.com" }),
      ]);
    });

    it("refuses a variable in the From address on save, on the REST route and the Direct API, and stores nothing", async () => {
      const t = await boot(dialect);

      expect(
        await refusal(
          rest(
            "POST",
            ["email-templates"],
            site("spoof", { fromOverride: "Shop <{{ sender }}>" })
          )
        )
      ).toEqual([{ path: "fromOverride", code: "VARIABLE_ADDRESS" }]);
      expect(
        await refusal(
          t.nextly.emailTemplates.create({
            data: site("spoof", { fromOverride: "{{ sender }}" }),
          })
        )
      ).toEqual([{ path: "fromOverride", code: "VARIABLE_ADDRESS" }]);
      expect(await templates(t).getTemplateBySlug("spoof")).toBeNull();

      // An update is held to it too, and leaves the stored From as it was.
      const { item } = await t.nextly.emailTemplates.create({
        data: site("honest", { fromOverride: "Shop <shop@example.com>" }),
      });
      expect(
        await refusal(
          rest("PATCH", ["email-templates", item.id], {
            fromOverride: "{{ name }} <{{ sender }}>",
          })
        )
      ).toEqual([{ path: "fromOverride", code: "VARIABLE_ADDRESS" }]);
      expect((await templates(t).getTemplate(item.id)).fromOverride).toBe(
        "Shop <shop@example.com>"
      );

      // The control: a variable in the display name is accepted.
      await rest("PATCH", ["email-templates", item.id], {
        fromOverride: "{{ name }} <shop@example.com>",
      });
      expect((await templates(t).getTemplate(item.id)).fromOverride).toBe(
        "{{ name }} <shop@example.com>"
      );
    });

    it("adds a template's cc and bcc after the send's own, with no address twice", async () => {
      const t = await boot(dialect);
      await rest(
        "POST",
        ["email-templates"],
        site("order-shipped", {
          cc: ["staff@shop.example", "Buyer <BUYER@example.com>"],
          bcc: ["audit@shop.example", "manager@shop.example"],
        })
      );

      await t.nextly.email.sendWithTemplate({
        to: "buyer@example.com",
        template: "order-shipped",
        variables: {},
        cc: ["partner@example.com"],
        bcc: ["manager@shop.example"],
      });

      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        to: "buyer@example.com",
        cc: ["partner@example.com", "staff@shop.example"],
        bcc: ["manager@shop.example", "audit@shop.example"],
      });
    });

    it("sends a template's copies when the send gives none", async () => {
      const t = await boot(dialect);
      await t.nextly.emailTemplates.create({
        data: site("order-shipped", { bcc: ["audit@shop.example"] }),
      });

      await t.nextly.email.sendWithTemplate({
        to: "buyer@example.com",
        template: "order-shipped",
        variables: {},
      });

      expect(sent[0]).toMatchObject({ bcc: ["audit@shop.example"] });
      expect(sent[0]?.cc).toBeUndefined();
    });

    it("refuses a variable in cc or bcc on save, on the REST route and the Direct API", async () => {
      const t = await boot(dialect);

      expect(
        await refusal(
          rest(
            "POST",
            ["email-templates"],
            site("watched", { cc: ["{{ manager.email }}"] })
          )
        )
      ).toEqual([{ path: "cc.0", code: "VARIABLE_ADDRESS" }]);
      const { item } = await t.nextly.emailTemplates.create({
        data: site("watched"),
      });
      expect(
        await refusal(
          t.nextly.emailTemplates.update({
            id: item.id,
            data: { bcc: ["audit@shop.example", "{{ boss }}"] },
          })
        )
      ).toEqual([{ path: "bcc.1", code: "VARIABLE_ADDRESS" }]);
      expect(await templates(t).getTemplate(item.id)).toMatchObject({
        cc: null,
        bcc: null,
      });
    });

    it("refuses cc and bcc on core's templates that carry a secret, on the REST route and the Direct API", async () => {
      const t = await boot(dialect);

      for (const slug of ["password-reset", "email-verification", "welcome"]) {
        const template = await templates(t).getTemplateBySlug(slug);
        if (!template) expect.fail(`${slug} was not seeded`);
        expect(template.carriesSecret).toBe(true);

        // The mark is the owner's: a request cannot clear it on the way in.
        expect(
          await refusal(
            rest("PATCH", ["email-templates", template.id], {
              carriesSecret: false,
              cc: ["spy@evil.example"],
            })
          )
        ).toEqual([{ path: "cc", code: "CARRIES_SECRET" }]);
        expect(
          await refusal(
            t.nextly.emailTemplates.update({
              id: template.id,
              data: { bcc: ["spy@evil.example"] },
            })
          )
        ).toEqual([{ path: "bcc", code: "CARRIES_SECRET" }]);
        expect(await templates(t).getTemplate(template.id)).toMatchObject({
          cc: null,
          bcc: null,
        });
      }

      // The control: core's layout carries no secret.
      const layout = await templates(t).getTemplateBySlug("default-layout");
      expect(layout?.carriesSecret).toBe(false);
    });

    it("refuses copies on a plugin template its plugin marks as carrying a secret, and accepts them on one it does not", async () => {
      const t = await boot(dialect);
      templates(t).configureOwnership({
        plugins: [
          {
            name: "@acme/plugin-shop",
            templates: [
              {
                ...site("shop-sign-in"),
                carriesSecret: true,
              },
              site("shop-receipt"),
            ],
          },
        ],
      });
      await templates(t).ensureBuiltInTemplates();
      const signIn = await templates(t).getTemplateBySlug("shop-sign-in");
      const receipt = await templates(t).getTemplateBySlug("shop-receipt");
      if (!signIn || !receipt)
        expect.fail("the plugin's templates were not seeded");

      expect(
        await refusal(
          rest("PATCH", ["email-templates", signIn.id], {
            bcc: ["spy@evil.example"],
          })
        )
      ).toEqual([{ path: "bcc", code: "CARRIES_SECRET" }]);

      await rest("PATCH", ["email-templates", receipt.id], {
        bcc: ["audit@shop.example"],
      });
      expect((await templates(t).getTemplate(receipt.id)).bcc).toEqual([
        "audit@shop.example",
      ]);
    });

    it("does not send copies written straight to the row of a template carrying a secret", async () => {
      const t = await boot(dialect);
      await t.nextly.emailTemplates.create({ data: site("newsletter") });
      await writeCopiesDirectly(t, dialect, "password-reset", [
        "spy@evil.example",
      ]);
      // The control: the same write on a template without the mark, which
      // shows the write reaches what a send reads.
      await writeCopiesDirectly(t, dialect, "newsletter", [
        "editor@shop.example",
      ]);
      expect(
        (await templates(t).getTemplateBySlug("password-reset"))?.cc
      ).toEqual(["spy@evil.example"]);

      await t.nextly.email.sendWithTemplate({
        to: "user@example.com",
        template: "password-reset",
        variables: { userName: "Ann", resetLink: "https://site/reset/abc" },
      });
      await t.nextly.email.sendWithTemplate({
        to: "reader@example.com",
        template: "newsletter",
        variables: {},
      });

      expect(sent).toHaveLength(2);
      expect(sent[0]).toMatchObject({ to: "user@example.com" });
      expect(sent[0]?.cc).toBeUndefined();
      expect(sent[0]?.bcc).toBeUndefined();
      expect(sent[1]).toMatchObject({
        to: "reader@example.com",
        cc: ["editor@shop.example"],
      });
    });
  });
}
