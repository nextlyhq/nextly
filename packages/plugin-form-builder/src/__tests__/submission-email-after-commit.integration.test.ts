/**
 * A form submission saved inside a caller's transaction emails only once that
 * transaction commits.
 *
 * The notification is queued inside the transaction that stores the
 * submission, which for a write made inside a caller's transaction is the
 * caller's. An email cannot be taken back: sent there, it would go out for a
 * submission a rollback then removes, and its delivery record, written on
 * another connection, would outlive the rollback too.
 *
 * So, for a submission saved in a transaction:
 * - rolled back: no email is sent and no delivery is recorded;
 * - committed: the email is sent, and recorded, exactly once.
 *
 * The provider is a real one that captures what it is handed, so a send goes
 * through the email service and records its delivery as any send does; a spy
 * on the service would skip the record and prove nothing about it.
 *
 * PostgreSQL and MySQL are the evidence for the record, which is written on a
 * second connection there. SQLite has one connection, so a record written
 * inside the transaction rolls back with it, but the send has still gone out:
 * it is the evidence for the send and the control for the record.
 */
import { defineEmailProvider, definePlugin } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { formBuilder } from "../plugin";

const TEMPLATE = "form-notification";
const ADMIN = "admin@example.com";

/** Every address the capturing provider was handed, in order. */
const sent: string[] = [];

/** A provider that sends nothing and records who it was asked to send to. */
const mailer = definePlugin({
  name: "@test/capturing-mailer",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    emailProviders: [
      defineEmailProvider<{ apiKey: string }>({
        type: "capturing-mailer",
        label: "Capturing mailer",
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
          apiKey: String((input as { apiKey?: unknown }).apiKey ?? ""),
        }),
        createAdapter: () => ({
          send: async (opts: { to: string | string[] }) => {
            sent.push(...(Array.isArray(opts.to) ? opts.to : [opts.to]));
            return { success: true, messageId: `captured-${sent.length}` };
          },
        }),
      }),
    ],
  },
} as never);

let current: TestNextly | undefined;
afterEach(async () => {
  sent.length = 0;
  const instance = current;
  current = undefined;
  if (!instance) return;
  // Bounded, so a teardown that hangs does not hold the file; one that fails
  // or runs out the bound fails the case rather than passing unremarked.
  await within(instance.destroy(), 10_000);
});

/** `work`, or a rejection once `ms` pass. */
function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`did not settle within ${ms} ms`)),
      ms
    );
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** The in-transaction create, as the collections handler serves it. */
interface EntryService {
  createEntryInTransaction(
    tx: unknown,
    params: { collectionName: string; overrideAccess: boolean },
    body: Record<string, unknown>
  ): Promise<{ success: boolean; data: unknown }>;
}

interface Booted {
  t: TestNextly;
  formId: string;
  entries: EntryService;
}

/**
 * An instance with the form builder and the capturing provider as the
 * default, a template the notification names, and a published form whose one
 * notification goes to {@link ADMIN}.
 */
async function boot(dialect: TestDialect): Promise<Booted> {
  const fb = formBuilder();
  current = await createTestNextly({ dialect, plugins: [fb.plugin, mailer] });
  const t = current;
  await t.nextly.emailProviders.create({
    data: {
      name: "Capturing",
      type: "capturing-mailer",
      fromEmail: "from@example.com",
      configuration: { apiKey: "throwaway-test-key" },
      isDefault: true,
    },
  } as never);
  await t.nextly.emailTemplates.create({
    data: {
      name: "Form notification",
      slug: TEMPLATE,
      subject: "A new submission",
      htmlContent: "<p>A form was submitted.</p>",
      isActive: true,
    },
  } as never);
  const form = (await t.nextly.create({
    collection: "forms",
    data: {
      name: "Contact",
      slug: "contact",
      fields: [{ type: "text", name: "message", label: "Message" }],
      status: "published",
      notifications: [
        {
          id: "n1",
          name: "Admin",
          enabled: true,
          recipientType: "static",
          to: ADMIN,
          cc: [],
          bcc: [],
          templateSlug: TEMPLATE,
        },
      ],
    },
  })) as unknown as { item: { id: string } };
  const handler = t.getService("collectionsHandler") as {
    getEntryService(): EntryService;
  };
  return { t, formId: form.item.id, entries: handler.getEntryService() };
}

/** Saves one submission to the form, inside `tx`. */
async function submit(b: Booted, tx: unknown): Promise<void> {
  const created = await b.entries.createEntryInTransaction(
    tx,
    { collectionName: "form-submissions", overrideAccess: true },
    {
      form: b.formId,
      data: { message: "hello" },
      status: "new",
      submittedAt: new Date(),
    }
  );
  expect(created.success, JSON.stringify(created)).toBe(true);
}

async function deliveries(t: TestNextly): Promise<{ templateSlug: unknown }[]> {
  return t.adapter.select<{ templateSlug: unknown }>("email_deliveries");
}

async function submissions(t: TestNextly): Promise<unknown[]> {
  const found = (await t.nextly.find({
    collection: "form-submissions",
  })) as unknown as { items: unknown[] };
  return found.items;
}

describe.each(getConfiguredTestDialects())(
  "a form submission saved inside a caller's transaction (integration, %s)",
  dialect => {
    it("sends no email and records no delivery when the transaction rolls back", async () => {
      const b = await boot(dialect);

      await expect(
        b.t.adapter.transaction(async tx => {
          await submit(b, tx);
          throw new Error("the caller's work failed after the submission");
        })
      ).rejects.toThrow("the caller's work failed after the submission");

      // Each reported on its own, so a run shows every one that failed.
      expect.soft(await submissions(b.t)).toEqual([]);
      expect.soft(sent).toEqual([]);
      expect.soft(await deliveries(b.t)).toEqual([]);
    }, 60_000);

    // The control: the fixture reaches the send, so the silence above is the
    // rollback's, and a held send still goes out once.
    it("sends the email, and records it, once when the transaction commits", async () => {
      const b = await boot(dialect);

      await b.t.adapter.transaction(tx => submit(b, tx));

      expect(await submissions(b.t)).toHaveLength(1);
      expect(sent).toEqual([ADMIN]);
      expect(await deliveries(b.t)).toEqual([
        expect.objectContaining({ templateSlug: TEMPLATE }),
      ]);
    }, 60_000);
  }
);
