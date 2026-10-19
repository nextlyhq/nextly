/**
 * Email delivery records naming a staff user, on every configured dialect.
 *
 * Core's own emails to a staff user (the welcome email, a password reset, an
 * email verification) name that user on their delivery records by kind and
 * id, `staff` and the user's id, as a plugin-defined person is named. So does
 * any send that names a staff user through `person`, on the Direct API and on
 * a plugin's `ctx.services.email`. A record that names the user can be erased
 * with them whatever address it went to; one that names nobody can only be
 * found by address.
 *
 * @module domains/email/__tests__/staff-person.integration.test
 */

// Read through the env proxy by the address digest: set before it is
// imported. A throwaway value, made for this file.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors";
import { runPostInitTasks } from "../../../init/post-init-tasks";
import {
  definePlugin,
  type PluginContext,
} from "../../../plugins/plugin-context";
import { staffPerson } from "../../../plugins/principals/ref";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { AuthService } from "../../auth/services/auth-service";
import { recipientDigest } from "../delivery-record";
import { defineEmailProvider } from "../provider-definition";

/** A delivery row as read back (Drizzle camelCases the columns). */
interface DeliveryRow {
  id: string;
  recipientHash: string;
  recipientKind: string;
  principalKind: string | null;
  principalId: string | null;
  templateSlug: string | null;
}

let current: TestNextly | undefined;
let ctx: PluginContext | undefined;
const sent: string[] = [];

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  ctx = undefined;
  sent.length = 0;
});

/** Contributes a provider that accepts every message, and a template. */
const mailer = definePlugin({
  name: "mailer",
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
        parseConfig: (input: unknown) => {
          const config = input as { apiKey?: unknown };
          if (typeof config.apiKey !== "string" || !config.apiKey) {
            throw NextlyError.validation({
              errors: [
                {
                  path: "configuration.apiKey",
                  code: "INVALID_PROVIDER_CONFIG",
                  message: "API key is required",
                },
              ],
            });
          }
          return { apiKey: config.apiKey };
        },
        createAdapter: () => ({
          send: async (opts: { to: string }) => {
            sent.push(opts.to);
            return { success: true, messageId: `captured-${sent.length}` };
          },
        }),
      }),
    ],
    emailTemplates: [
      {
        slug: "mailer-notice",
        name: "Notice",
        subject: "A notice",
        htmlContent: "<p>Notice</p>",
      },
    ],
  },
  init(context: PluginContext) {
    ctx = context;
  },
} as never);

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({ dialect, plugins: [mailer] });
  if (!ctx) throw new Error("the plugin's init did not run");
  // Seeds the contributed and core templates, as the app's first start does.
  await runPostInitTasks();
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

function plugin(): PluginContext {
  if (!ctx) throw new Error("not booted");
  return ctx;
}

let serial = 0;

/** A staff user, unverified, with a password, as an install holds one. */
async function staffUser(
  t: TestNextly
): Promise<{ id: string; email: string }> {
  serial += 1;
  const id = `staff-person-${serial}`;
  const email = `staff-${serial}@example.com`;
  await t.adapter.insert("users", {
    id,
    email,
    name: "Staff",
    email_verified: null,
    is_active: true,
    password_hash:
      "$2a$10$abcdefghijklmnopqrstuuJ7rOq0r9rUuJ1yYb1E5vZ3QhJcI2xyK",
    created_at: new Date(),
    updated_at: new Date(),
  });
  return { id, email };
}

function rows(t: TestNextly): Promise<DeliveryRow[]> {
  return t.adapter.select<DeliveryRow>("email_deliveries");
}

/** The rows a write added. */
async function added(
  t: TestNextly,
  write: () => Promise<unknown>
): Promise<DeliveryRow[]> {
  const before = new Set((await rows(t)).map(row => row.id));
  await write();
  return (await rows(t)).filter(row => !before.has(row.id));
}

describe.each(getConfiguredTestDialects())(
  "email delivery records naming a staff user (%s)",
  dialect => {
    describe("core's own emails", () => {
      it("name the staff user on a password reset", async () => {
        const t = await boot(dialect);
        const user = await staffUser(t);
        const auth = t.getService("authService") as unknown as AuthService;

        const records = await added(t, () =>
          auth.generatePasswordResetToken(user.email)
        );

        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
          principalKind: "staff",
          principalId: user.id,
          recipientHash: recipientDigest(user.email),
          templateSlug: "password-reset",
        });
      }, 120_000);

      it("name the staff user on an email verification", async () => {
        const t = await boot(dialect);
        const user = await staffUser(t);
        const auth = t.getService("authService") as unknown as AuthService;

        const records = await added(t, () =>
          auth.generateEmailVerificationToken(user.email)
        );

        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
          principalKind: "staff",
          principalId: user.id,
          templateSlug: "email-verification",
        });
      }, 120_000);

      it("name the staff user on a welcome email", async () => {
        const t = await boot(dialect);
        const user = await staffUser(t);

        const records = await added(t, () =>
          t.nextly.users.update({
            id: user.id,
            data: { sendWelcomeEmail: true },
          } as never)
        );

        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
          principalKind: "staff",
          principalId: user.id,
          templateSlug: "welcome",
        });
      }, 120_000);
    });

    describe("a send that names a staff user through person", () => {
      const expected = (id: string) => ({
        principalKind: "staff",
        principalId: id,
      });

      it("is recorded through the Direct API's send", async () => {
        const t = await boot(dialect);
        const user = await staffUser(t);

        const records = await added(t, () =>
          t.nextly.email.send({
            to: user.email,
            subject: "Hello",
            html: "<p>hi</p>",
            person: staffPerson(user.id),
          })
        );

        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject(expected(user.id));
      }, 120_000);

      it("is recorded through the Direct API's sendWithTemplate", async () => {
        const t = await boot(dialect);
        const user = await staffUser(t);

        const records = await added(t, () =>
          t.nextly.email.sendWithTemplate({
            to: user.email,
            template: "mailer-notice",
            person: staffPerson(user.id),
          })
        );

        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject(expected(user.id));
      }, 120_000);

      it("is recorded through a plugin's send, on the to row only", async () => {
        const t = await boot(dialect);
        const user = await staffUser(t);

        const records = await added(t, () =>
          plugin().services.email.send({
            to: user.email,
            cc: ["copied@example.com"],
            subject: "Hello",
            html: "<p>hi</p>",
            person: staffPerson(user.id),
          })
        );

        expect(records.find(row => row.recipientKind === "to")).toMatchObject(
          expected(user.id)
        );
        // A copied address is someone else.
        expect(records.find(row => row.recipientKind === "cc")).toMatchObject({
          principalKind: null,
          principalId: null,
        });
      }, 120_000);

      it("is recorded through a plugin's sendWithTemplate", async () => {
        const t = await boot(dialect);
        const user = await staffUser(t);

        const records = await added(t, () =>
          plugin().services.email.sendWithTemplate(
            "mailer-notice",
            user.email,
            {},
            { person: staffPerson(user.id) }
          )
        );

        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject(expected(user.id));
      }, 120_000);

      it("is refused, before anything is sent, for a staff user who does not exist", async () => {
        const t = await boot(dialect);

        await expect(
          t.nextly.email.send({
            to: "nobody@example.com",
            subject: "Hello",
            html: "<p>hi</p>",
            person: staffPerson("no-such-user"),
          })
        ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
        expect(sent).toEqual([]);
      }, 120_000);
    });
  }
);
