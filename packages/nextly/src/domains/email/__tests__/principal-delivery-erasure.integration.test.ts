/**
 * Email delivery records naming a plugin-defined person, and their erasure
 * when the plugin reports the person deleted, on every configured dialect.
 *
 * A plugin's send names the person it goes to; the record of it carries their
 * kind and id beside the address digest. Once the plugin reports them deleted,
 * their records lose the digest and name them by the keyed digest of kind and
 * id, and every record written for them afterwards, the deletion email
 * included, is written that way already. A staff user at the same address
 * keeps every record of theirs.
 *
 * @module domains/email/__tests__/principal-delivery-erasure.integration.test
 */

// Read through the env proxy by the digest key and the address digest: set
// before either is imported. A throwaway value, made for this file.
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
import type { PrincipalRef } from "../../../plugins/principals/types";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import {
  reportPrincipalDeleted,
  resealPrincipalDigestKeyAtBoot,
} from "../../audit/erase-principal";
import { deliveriesTableFor } from "../deliveries-table";
import { ERASED_RECIPIENT_HASH, recipientDigest } from "../delivery-record";
import { defineEmailProvider } from "../provider-definition";
import { pruneEmailData } from "../prune";
import { EmailDeliveryService } from "../services/email-delivery-service";

const KIND = "accounts:account";
const SHARED = "shared@example.com";

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
// Run by the capturing mailer as it accepts a message, so a test can change
// the database between the provider being resolved and the record written.
let duringSend: (() => Promise<void>) | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  ctx = undefined;
  sent.length = 0;
  duringSend = undefined;
});

const accounts = definePlugin({
  name: "accounts",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    principals: [
      {
        name: "account",
        attributes: { verified: "boolean" },
        resolve: async () => null,
        lookup: async (id: string) => ({ id, attributes: { verified: true } }),
      },
    ],
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
            await duringSend?.();
            return { success: true, messageId: `captured-${sent.length}` };
          },
        }),
      }),
    ],
    emailTemplates: [
      {
        slug: "accounts-deleted",
        name: "Account deleted",
        subject: "Your account is gone",
        htmlContent: "<p>Goodbye</p>",
      },
    ],
  },
  init(context: PluginContext) {
    ctx = context;
  },
} as never);

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({ dialect, plugins: [accounts] });
  if (!ctx) throw new Error("the plugin's init did not run");
  // Seeds the plugin's contributed template, as the app's first start does.
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

/** A person of the plugin's kind, as its lookup hands one out. */
async function person(id: string): Promise<PrincipalRef> {
  const found = await plugin().principals!.byId("account", id);
  if (!found) throw new Error(`no person ${id}`);
  return found;
}

function rows(t: TestNextly): Promise<DeliveryRow[]> {
  return t.adapter.select<DeliveryRow>("email_deliveries");
}

/** The ids of every row, to find the ones a write added. */
async function added(
  t: TestNextly,
  write: () => Promise<unknown>
): Promise<DeliveryRow[]> {
  const before = new Set((await rows(t)).map(row => row.id));
  await write();
  return (await rows(t)).filter(row => !before.has(row.id));
}

/** Every value in every column of every delivery row, as text. */
async function everyStoredValue(t: TestNextly): Promise<string[]> {
  const all =
    await t.adapter.select<Record<string, unknown>>("email_deliveries");
  return all.flatMap(row =>
    Object.values(row).map(value =>
      typeof value === "string" ? value : JSON.stringify(value ?? null)
    )
  );
}

/** A delivery service writing with the given secrets. */
function deliveriesWith(
  t: TestNextly,
  secrets: readonly string[]
): EmailDeliveryService {
  return new EmailDeliveryService(
    t.adapter as never,
    { info() {}, warn() {}, error() {}, debug() {} } as never,
    undefined,
    undefined,
    () => secrets
  );
}

describe.each(getConfiguredTestDialects())(
  "email delivery records naming a plugin-defined person (%s)",
  dialect => {
    it("records the person on each send method a plugin uses, on the to row only", async () => {
      const t = await boot(dialect);
      const someone = await person("acc_sends");

      const viaSend = await added(t, () =>
        plugin().services.email.send({
          to: "member@example.com",
          cc: ["copied@example.com"],
          subject: "Hello",
          html: "<p>hi</p>",
          person: someone,
        })
      );
      const viaTemplate = await added(t, () =>
        plugin().services.email.sendWithTemplate(
          "accounts-deleted",
          "member@example.com",
          {},
          { person: someone }
        )
      );

      const to = viaSend.find(row => row.recipientKind === "to");
      const cc = viaSend.find(row => row.recipientKind === "cc");
      expect(to).toMatchObject({
        principalKind: KIND,
        principalId: "acc_sends",
        recipientHash: recipientDigest("member@example.com"),
      });
      // A copied address is someone else.
      expect(cc).toMatchObject({ principalKind: null, principalId: null });
      expect(viaTemplate).toHaveLength(1);
      expect(viaTemplate[0]).toMatchObject({
        principalKind: KIND,
        principalId: "acc_sends",
        templateSlug: "accounts-deleted",
      });
    }, 120_000);

    it("refuses, before sending, a person that cannot name one", async () => {
      await boot(dialect);
      await expect(
        plugin().services.email.send({
          to: "member@example.com",
          subject: "Hello",
          html: "<p>hi</p>",
          person: { kind: "staff", id: "u1" },
        })
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect(sent).toEqual([]);
    }, 120_000);

    it("refuses, before sending, a person of a kind no plugin registered", async () => {
      // Well formed but misspelled: no deletion report could name the kind,
      // so a record kept under it would outlive the person. The registered
      // `accounts:account`, sent above, is the control.
      await boot(dialect);
      await expect(
        plugin().services.email.send({
          to: "member@example.com",
          subject: "Hello",
          html: "<p>hi</p>",
          person: { kind: "accounts:acount", id: "acc_1" },
        })
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect(sent).toEqual([]);
    }, 120_000);

    it("erases a reported person's records, and the deletion email after it, keeping a staff user's at the same address", async () => {
      const t = await boot(dialect);
      // Resolved before the report, as a request in flight would have.
      const gone = await person("acc_gone");

      const before = await added(t, () =>
        plugin().services.email.send({
          to: SHARED,
          subject: "Welcome",
          html: "<p>hi</p>",
          person: gone,
        })
      );
      // A staff user's email, to the same address, naming no person.
      const staff = await added(t, () =>
        t.nextly.email.send({
          to: SHARED,
          subject: "Staff notice",
          html: "<p>hi</p>",
        })
      );

      await plugin().principals!.reportDeleted(gone);
      const deletionEmail = await added(t, () =>
        plugin().services.email.sendWithTemplate(
          "accounts-deleted",
          SHARED,
          {},
          { person: gone }
        )
      );

      const all = await rows(t);
      const byId = (id: string) => all.find(row => row.id === id)!;
      for (const row of [...before, ...deletionEmail].map(r => byId(r.id))) {
        expect(row.recipientHash).toBe(ERASED_RECIPIENT_HASH);
        expect(row.principalKind).toBe(KIND);
        expect(row.principalId).toMatch(/^[0-9a-f]{64}$/);
      }
      expect(byId(staff[0].id)).toMatchObject({
        recipientHash: recipientDigest(SHARED),
        principalId: null,
      });
      expect(await everyStoredValue(t)).not.toContain("acc_gone");
      // The digest is the one the deleted-people record keeps.
      const [kept] = await t.adapter.select<{ digest: string }>(
        "nextly_deleted_principals"
      );
      expect(byId(before[0].id).principalId).toBe(kept.digest);
    }, 120_000);

    it("erases a reported person's record of an email that copied a staff address, keeping the staff address's", async () => {
      // The person names the `to` recipient only. A copied staff address on
      // the same message is someone else, and their record must survive the
      // person's erasure exactly as written.
      const t = await boot(dialect);
      const gone = await person("acc_copied");

      const written = await added(t, () =>
        plugin().services.email.send({
          to: "member@example.com",
          cc: ["staff@example.com"],
          bcc: ["audit@example.com"],
          subject: "Order placed",
          html: "<p>hi</p>",
          person: gone,
        })
      );
      const copied = written.filter(row => row.recipientKind !== "to");
      expect(copied).toHaveLength(2);
      const copiedBefore =
        await t.adapter.select<DeliveryRow>("email_deliveries");

      await plugin().principals!.reportDeleted(gone);

      const all = await rows(t);
      const byId = (id: string) => all.find(row => row.id === id)!;
      const to = written.find(row => row.recipientKind === "to")!;
      expect(byId(to.id).recipientHash).toBe(ERASED_RECIPIENT_HASH);
      for (const row of copied) {
        expect(byId(row.id)).toEqual(
          copiedBefore.find(before => before.id === row.id)
        );
        expect(byId(row.id)).toMatchObject({
          principalKind: null,
          principalId: null,
        });
      }
      expect(byId(copied[0].id).recipientHash).toBe(
        recipientDigest(
          copied[0].recipientKind === "cc"
            ? "staff@example.com"
            : "audit@example.com"
        )
      );
    }, 120_000);

    it("clears a keyed send's key digest from every record of it when the person is erased", async () => {
      // A key is the caller's text and may be built from the person's
      // address, so its digest goes from the copies too, whose addresses stay.
      const t = await boot(dialect);
      const gone = await person("acc_keyed");

      const written = await added(t, () =>
        plugin().services.email.send({
          to: "member@example.com",
          cc: ["staff@example.com"],
          subject: "Order placed",
          html: "<p>hi</p>",
          person: gone,
          idempotencyKey: "order-1:member@example.com",
        })
      );
      const keyOf = (row: DeliveryRow) =>
        (row as DeliveryRow & { keyDigest: string | null }).keyDigest;
      expect(written.map(keyOf).every(digest => digest !== null)).toBe(true);

      await plugin().principals!.reportDeleted(gone);

      const after = (await rows(t)).filter(row =>
        written.some(before => before.id === row.id)
      );
      expect(after.map(keyOf)).toEqual([null, null]);
      const copy = after.find(row => row.recipientKind === "cc")!;
      expect(copy.recipientHash).toBe(recipientDigest("staff@example.com"));
      // The send's claim keeps neither digest.
      const claims = await t.adapter.select("email_send_claims");
      expect(claims).toEqual([
        expect.objectContaining({ keyDigest: null, messageDigest: null }),
      ]);
    }, 120_000);

    it("writes a keyed send to a person already reported deleted with no key digest anywhere", async () => {
      // The send was claimed before the report and recorded after it, so the
      // report found nothing to clear: the records and the claim are written
      // as the report would have left them.
      const t = await boot(dialect);
      const gone = await person("acc_keyed_late");
      await plugin().principals!.reportDeleted(gone);

      const written = await added(t, () =>
        plugin().services.email.send({
          to: "member@example.com",
          cc: ["staff@example.com"],
          subject: "Order placed",
          html: "<p>hi</p>",
          person: gone,
          idempotencyKey: "order-2:member@example.com",
        })
      );

      expect(
        written.map(
          row => (row as DeliveryRow & { keyDigest: string | null }).keyDigest
        )
      ).toEqual([null, null]);
      expect(await t.adapter.select("email_send_claims")).toEqual([
        expect.objectContaining({ keyDigest: null, messageDigest: null }),
      ]);
    }, 120_000);

    it("writes the deletion email erased when it is sent in the reporting transaction", async () => {
      const t = await boot(dialect);
      const gone = await person("acc_in_tx");

      const written = await added(t, () =>
        plugin().db.transaction(async tx => {
          await plugin().principals!.reportDeleted(gone, { tx });
          await plugin().services.email.sendWithTemplate(
            "accounts-deleted",
            SHARED,
            {},
            { person: gone }
          );
        })
      );
      expect(written).toHaveLength(1);
      expect(written[0].recipientHash).toBe(ERASED_RECIPIENT_HASH);
      expect(written[0].principalId).toMatch(/^[0-9a-f]{64}$/);
    }, 120_000);

    it("keeps a deletion report still running when the deletion email's record fails beside it", async () => {
      // The report and the email start together on the plugin's transaction,
      // so the report is still making its statements when the email's record
      // fails on the removed provider and is rolled back to its savepoint. A
      // rollback reaching into the report would undo its later writes while
      // the transaction still committed; failing the transaction instead
      // would lose the deletion loudly. Neither may happen: the record waits
      // for the report, and both commit.
      const t = await boot(dialect);
      const gone = await person("acc_report_in_flight");
      const [provider] = await t.adapter.select<{ id: string }>(
        "email_providers"
      );
      duringSend = async () => {
        duringSend = undefined;
        await t.adapter.delete("email_providers", {
          and: [{ column: "id", op: "=", value: provider.id }],
        });
      };

      const written = await added(t, () =>
        plugin().db.transaction(async tx => {
          await Promise.all([
            plugin().principals!.reportDeleted(gone, { tx }),
            plugin().services.email.sendWithTemplate(
              "accounts-deleted",
              SHARED,
              {},
              { person: gone }
            ),
          ]);
        })
      );

      // The record, retried and written erased: the transaction committed.
      expect(written).toHaveLength(1);
      expect(written[0].recipientHash).toBe(ERASED_RECIPIENT_HASH);
      // And the report committed whole: a later record for the person is
      // erased as it is written, which only a committed report decides.
      await t.nextly.emailProviders.create({
        data: {
          name: "Capturing again",
          type: "capturing-mailer",
          fromEmail: "from@example.com",
          configuration: { apiKey: "throwaway-test-key" },
          isDefault: true,
        },
      });
      const later = await added(t, () =>
        plugin().services.email.sendWithTemplate(
          "accounts-deleted",
          SHARED,
          {},
          { person: gone }
        )
      );
      expect(later).toHaveLength(1);
      expect(later[0].recipientHash).toBe(ERASED_RECIPIENT_HASH);
    }, 120_000);

    it("keeps the deletion when the deletion email's record fails in the reporting transaction", async () => {
      // The provider is removed after the send resolved it and before its
      // record is written, so the first insert breaks the provider reference
      // inside the plugin's transaction and the recorder retries without it.
      // On PostgreSQL a failed statement aborts the whole transaction: had the
      // recorder's failure been left in it, the commit would roll back the
      // report, and the deletion along with it, while the plugin was told it
      // had committed.
      const t = await boot(dialect);
      const gone = await person("acc_record_fails");
      const [provider] = await t.adapter.select<{ id: string }>(
        "email_providers"
      );
      duringSend = async () => {
        duringSend = undefined;
        await t.adapter.delete("email_providers", {
          and: [{ column: "id", op: "=", value: provider.id }],
        });
      };

      const written = await added(t, () =>
        plugin().db.transaction(async tx => {
          await plugin().principals!.reportDeleted(gone, { tx });
          await plugin().services.email.sendWithTemplate(
            "accounts-deleted",
            SHARED,
            {},
            { person: gone }
          );
        })
      );

      // The retried record, written erased: the transaction committed, with
      // the report it holds.
      expect(written).toHaveLength(1);
      expect(written[0].recipientHash).toBe(ERASED_RECIPIENT_HASH);
      // And the report outlived it: a later record for the person is erased
      // as it is written, which only a committed report decides.
      await t.nextly.emailProviders.create({
        data: {
          name: "Capturing again",
          type: "capturing-mailer",
          fromEmail: "from@example.com",
          configuration: { apiKey: "throwaway-test-key" },
          isDefault: true,
        },
      });
      const later = await added(t, () =>
        plugin().services.email.sendWithTemplate(
          "accounts-deleted",
          SHARED,
          {},
          { person: gone }
        )
      );
      expect(later).toHaveLength(1);
      expect(later[0].recipientHash).toBe(ERASED_RECIPIENT_HASH);
    }, 120_000);

    it("writes a record erased long after the report, the delivery log pruned in between", async () => {
      const t = await boot(dialect);
      const gone = await person("acc_retained");
      await plugin().services.email.send({
        to: SHARED,
        subject: "Welcome",
        html: "<p>hi</p>",
        person: gone,
      });
      await plugin().principals!.reportDeleted(gone);

      // A year on, with a 90-day window: every delivery row is pruned, and the
      // deleted-people record, which has no expiry, is not.
      const yearOn = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      await pruneEmailData(
        { adapter: t.adapter, now: () => yearOn },
        {
          maxAgeMs: 90 * 24 * 60 * 60 * 1000,
          intervalMs: 60_000,
          maxBatchesPerRun: 10,
        }
      );
      expect(await rows(t)).toEqual([]);

      const late = await added(t, () =>
        plugin().services.email.send({
          to: SHARED,
          subject: "Still here?",
          html: "<p>hi</p>",
          person: gone,
        })
      );
      expect(late[0]).toMatchObject({ recipientHash: ERASED_RECIPIENT_HASH });
      expect(late[0].principalId).toMatch(/^[0-9a-f]{64}$/);
    }, 120_000);

    it("writes a record erased after two rotations of the secret", async () => {
      const t = await boot(dialect);
      const gone = await person("acc_rotated");
      const first = "email-rotation-secret-first-0123456789abcd";
      const second = "email-rotation-secret-second-0123456789abc";
      const third = "email-rotation-secret-third-0123456789abcd";
      const adapter = t.adapter as never;

      await reportPrincipalDeleted(gone, { adapter, secrets: [first] });
      await resealPrincipalDigestKeyAtBoot(adapter, [second, first]);
      const late = await added(t, () =>
        deliveriesWith(t, [third, second]).record({
          to: SHARED,
          providerType: "capturing-mailer",
          status: "sent",
          person: gone,
        })
      );
      expect(late).toHaveLength(1);
      expect(late[0].recipientHash).toBe(ERASED_RECIPIENT_HASH);
      const [kept] = await t.adapter.select<{ digest: string }>(
        "nextly_deleted_principals"
      );
      expect(late[0].principalId).toBe(kept.digest);
    }, 120_000);

    it("serialises a report against a send that checked just before it", async () => {
      // The send reads that the person is not deleted, the report then starts,
      // and the send's record is written only after the report has had every
      // chance to record the person and scan their rows. The record must
      // still end up erased.
      const t = await boot(dialect);
      const gone = await person("acc_race");
      const emailDeliveries = deliveriesTableFor(dialect);
      let reached!: () => void;
      const checked = new Promise<void>(resolve => (reached = resolve));
      let release!: () => void;
      const gate = new Promise<void>(resolve => (release = resolve));
      const service = new EmailDeliveryService(
        pausingAdapter(t, emailDeliveries, reached, gate) as never,
        { info() {}, warn() {}, error() {}, debug() {} } as never
      );

      const writing = service.record({
        to: SHARED,
        providerType: "capturing-mailer",
        status: "sent",
        person: gone,
      });
      await checked;
      const reporting = plugin().principals!.reportDeleted(gone);
      // Long enough for a report that did not wait to record and scan.
      await new Promise(resolve => setTimeout(resolve, 750));
      release();
      await writing;
      await reporting;

      const all = await rows(t);
      expect(all).toHaveLength(1);
      expect(all[0].recipientHash).toBe(ERASED_RECIPIENT_HASH);
      expect(all[0].principalId).toMatch(/^[0-9a-f]{64}$/);
    }, 120_000);

    it.runIf(dialect === "sqlite")(
      "keeps a record's erasure made while another request's transaction is open and then rolls back",
      async () => {
        const t = await boot(dialect);
        const gone = await person("acc_sqlite");
        await plugin().services.email.send({
          to: SHARED,
          subject: "Welcome",
          html: "<p>hi</p>",
          person: gone,
        });

        let opened!: () => void;
        const isOpen = new Promise<void>(resolve => (opened = resolve));
        let release!: () => void;
        const gate = new Promise<void>(resolve => (release = resolve));
        const adapter = t.adapter as unknown as {
          transaction(work: () => Promise<void>): Promise<void>;
        };
        const other = adapter.transaction(async () => {
          opened();
          await gate;
          throw new Error("the other request failed");
        });
        await isOpen;
        const reporting = plugin().principals!.reportDeleted(gone);
        await new Promise(resolve => setTimeout(resolve, 200));
        release();
        await expect(other).rejects.toThrow("the other request failed");
        await reporting;

        const [row] = await rows(t);
        expect(row.recipientHash).toBe(ERASED_RECIPIENT_HASH);
      },
      120_000
    );
  }
);

/**
 * The booted adapter, with every insert into `table` held at `gate` after
 * signalling `reached`: by then the writer holds its lock and has read
 * whether the person was deleted, and has not yet written its row.
 */
function pausingAdapter(
  t: TestNextly,
  table: unknown,
  reached: () => void,
  gate: Promise<void>
): unknown {
  const real = t.adapter as unknown as {
    dialect: string;
    getCapabilities(): unknown;
    transaction(work: unknown): Promise<unknown>;
    transactionOpenInFlow(): boolean;
    getDrizzle(relations?: unknown): object;
  };
  return {
    dialect: real.dialect,
    getCapabilities: () => real.getCapabilities(),
    transaction: (work: unknown) => real.transaction(work),
    transactionOpenInFlow: () => real.transactionOpenInFlow(),
    getDrizzle: (relations?: unknown) =>
      pausing(real.getDrizzle(relations), table, reached, gate),
  };
}

type Method = (...args: unknown[]) => unknown;

function pausing(
  db: object,
  table: unknown,
  reached: () => void,
  gate: Promise<void>
): object {
  return new Proxy(db, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target) as unknown;
      if (prop === "insert") {
        return (into: unknown) => {
          const builder = (value as Method).call(target, into) as {
            values(rows: unknown): Promise<unknown>;
          };
          if (into !== table) return builder;
          return {
            values: async (rows: unknown) => {
              reached();
              await gate;
              return builder.values(rows);
            },
          };
        };
      }
      if (prop === "transaction") {
        return (work: (tx: object) => Promise<unknown>) =>
          (value as Method).call(target, (tx: object) =>
            work(pausing(tx, table, reached, gate))
          );
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
