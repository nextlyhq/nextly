/**
 * The Email hub's Activity reads, through the REST catch-all as real users
 * with real roles, and through the Direct API: the delivery list and the
 * queued-email list with their filters, each template's last send, and
 * whether queued email is overdue.
 *
 * Each read needs `read-email-deliveries`, seeded to super-admin alone, and
 * none ever returns an address, a recipient's digest, a subject or a body.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { loadedDialect } from "../../../database/dialect-tables";
import { seedAllPermissions } from "../../../init/seed-permissions";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import { ServiceContainer } from "../../../services/index";
import { recipientDigests } from "../delivery-record";
import type { EmailDeliveryService } from "../services/email-delivery-service";

const ORIGIN = "http://localhost";
const REFUSED = [401, 403];

type Headers = Record<string, string>;

/** What a delivery reads as, and nothing else. */
const DELIVERY_FIELDS = [
  "createdAt",
  "erased",
  "failureKind",
  "failureReason",
  "failureStatus",
  "id",
  "namedPerson",
  "outcome",
  "provider",
  "queuedId",
  "recipientKind",
  "templateSlug",
  "templateVersion",
].sort();

/** What a queued email reads as, and nothing else. */
const QUEUED_FIELDS = [
  "attempts",
  "createdAt",
  "id",
  "lastFailure",
  "messageHeld",
  "nextAttemptAt",
  "queuedBy",
  "settledAt",
  "state",
  "templateSlug",
  "updatedAt",
].sort();

/** Every address, subject and body these tests send or record. */
const ADDRESSES = [
  "alice@example.com",
  "bob@example.com",
  "carol@example.com",
  "dana@example.com",
  "erin@example.com",
  "queued@example.com",
];
const SUBJECT = "A subject naming Alice";
const BODY = "<p>A body for Alice</p>";

async function permissionIds(t: TestNextly, slugs: string[]) {
  const ids: string[] = [];
  for (let page = 1; ; page++) {
    const found = await t.nextly.permissions.find({ limit: 100, page });
    ids.push(
      ...found.items.filter(p => slugs.includes(p.slug)).map(p => String(p.id))
    );
    if (!found.meta.hasNext) return ids;
  }
}

async function tokenFor(
  id: string,
  name: string,
  roleIds: string[]
): Promise<Headers> {
  const token = await signAccessToken(
    buildClaims({
      userId: id,
      email: `${name}@activity.test`,
      name,
      image: null,
      roleIds,
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET ?? ""
  );
  return { cookie: `nextly_session=${token}` };
}

async function sessionFor(
  t: TestNextly,
  services: ServiceContainer,
  name: string,
  slugs: string[]
): Promise<{ headers: Headers; id: string }> {
  const role = await t.nextly.roles.create({
    data: { name, slug: name, permissionIds: await permissionIds(t, slugs) },
  });
  const roleId = String(role.item.id);
  const made = await t.nextly.users.create({
    email: `${name}@activity.test`,
    password: "Password123!",
    data: { name, isActive: true },
  });
  const id = String((made.item as { id: string | number }).id);
  await services.userRoles.assignRoleToUser(id, roleId);
  return { headers: await tokenFor(id, name, [roleId]), id };
}

/** One GET through the REST catch-all, as the admin sends it. */
function get(path: string, headers: Headers): Promise<Response> {
  const [pathname] = path.split("?");
  const segments = pathname.split("/").filter(Boolean);
  const req = new Request(`${ORIGIN}/api/${path}`, {
    method: "GET",
    headers: { origin: ORIGIN, ...headers },
  });
  return createDynamicHandlers().GET(req, {
    params: Promise.resolve({ params: segments }),
  });
}

/** A successful read's body, and its text for the leak checks. */
async function read(
  path: string,
  headers: Headers
): Promise<{ body: Record<string, unknown>; text: string }> {
  const response = await get(path, headers);
  const text = await response.text();
  expect(response.status, text).toBe(200);
  return { body: JSON.parse(text) as Record<string, unknown>, text };
}

/** The response's text carries no address, digest, subject or body. */
function expectNothingPersonal(text: string): void {
  for (const address of ADDRESSES) {
    expect(text).not.toContain(address);
    for (const digest of recipientDigests(address)) {
      expect(text).not.toContain(digest);
    }
  }
  expect(text).not.toContain(SUBJECT);
  expect(text).not.toContain(BODY);
  expect(text.toLowerCase()).not.toContain("alice");
}

type Item = Record<string, unknown>;
const itemsOf = (body: Record<string, unknown>) =>
  (body.items ?? (body.data as Item)?.items) as Item[];

for (const dialect of getConfiguredTestDialects()) {
  describe(`the Activity reads — ${dialect}`, () => {
    let t: TestNextly;
    let root: Headers;
    let reader: Headers;
    let readerId: string;
    let manager: Headers;
    let stranger: Headers;
    let strangerId: string;
    let selfRegistered: Headers;
    let providerId: string;
    let failedQueuedId: string;
    let sentQueuedId: string;

    const at = (iso: string) => new Date(iso);

    beforeAll(async () => {
      t = await createTestNextly({ dialect });
      try {
        const services = new ServiceContainer(t.adapter);
        await seedAllPermissions();
        const rootMade = await t.nextly.users.create({
          email: "root@activity.test",
          password: "Password123!",
          data: { name: "root", isActive: true },
        });
        const rootId = String((rootMade.item as { id: string | number }).id);
        root = await tokenFor(
          rootId,
          "root",
          await services.userRoles.listUserRoles(rootId)
        );
        ({ headers: reader, id: readerId } = await sessionFor(
          t,
          services,
          "reader",
          ["read-email-deliveries"]
        ));
        ({ headers: manager } = await sessionFor(t, services, "manager", [
          "manage-email-deliveries",
        ]));
        ({ headers: stranger, id: strangerId } = await sessionFor(
          t,
          services,
          "stranger",
          ["read-users"]
        ));
        const self = await services.users.createLocalUser(
          {
            email: "self@activity.test",
            name: "self",
            password: "Password123!",
            emailVerification: "pending",
          },
          undefined,
          "self-registration"
        );
        selfRegistered = await tokenFor(
          String(self.id),
          "self",
          await services.userRoles.listUserRoles(String(self.id))
        );

        const provider = await t.nextly.emailProviders.create({
          data: {
            name: "Log",
            type: "log",
            fromEmail: "from@example.com",
            configuration: {},
            isDefault: true,
          },
        });
        providerId = provider.item.id;

        // The delivery log: each row told apart by its message id, then
        // dated so the newest-first order and the time filter can be read.
        const deliveries = t.getService(
          "emailDeliveryService"
        ) as unknown as EmailDeliveryService;
        await deliveries.recordAll([
          {
            to: "Alice <alice@example.com>",
            providerId,
            providerType: "log",
            templateSlug: "welcome",
            status: "sent",
            messageId: "m-welcome-to",
          },
          {
            to: "bob@example.com",
            recipientKind: "cc",
            providerId,
            providerType: "log",
            templateSlug: "welcome",
            status: "sent",
            messageId: "m-welcome-cc",
          },
        ]);
        await deliveries.record({
          to: "carol@example.com",
          providerType: "smtp",
          templateSlug: "password-reset",
          status: "failed",
          error: "550 5.1.1 <carol@example.com> User unknown",
          messageId: "m-reset-failed",
        });
        await deliveries.record({
          to: "dana@example.com",
          providerType: "smtp",
          status: "sent",
          messageId: "m-raw",
          person: { kind: "customer", id: "c-1" },
        });
        await deliveries.record({
          to: "erin@example.com",
          providerType: "smtp",
          templateSlug: "welcome",
          status: "failed",
          error: "The email provider refused the message.",
          messageId: "m-welcome-failed",
        });
        await deliveries.eraseRecipient("erin@example.com");
        const table = loadedDialect(dialect).tables.emailDeliveries;
        const dated: Array<[string, string]> = [
          ["m-welcome-to", "2026-11-01T10:00:00.000Z"],
          ["m-welcome-cc", "2026-11-01T10:00:00.000Z"],
          ["m-reset-failed", "2026-11-02T10:00:00.000Z"],
          ["m-raw", "2026-11-03T10:00:00.000Z"],
          ["m-welcome-failed", "2026-11-04T10:00:00.000Z"],
        ];
        const db = t.adapter.getDrizzle() as never as {
          update(table: unknown): {
            set(values: unknown): { where(c: unknown): Promise<unknown> };
          };
        };
        for (const [messageId, iso] of dated) {
          await db
            .update(table)
            .set({ createdAt: at(iso) })
            .where(eq(table.messageId as never, messageId));
        }

        // Queued email: one sent, and one that fails for good because its
        // template does not exist, keeping its message.
        sentQueuedId = (
          await t.nextly.email.queue({
            to: "queued@example.com",
            subject: SUBJECT,
            html: BODY,
          })
        ).id;
        failedQueuedId = (
          await t.nextly.email.queueWithTemplate({
            template: "no-such-template",
            to: "queued@example.com",
            variables: { name: "Alice" },
          })
        ).id;
      } catch (error) {
        await t.destroy();
        throw error;
      }
    }, 180_000);

    afterAll(async () => {
      await t?.destroy();
    });

    const READS = [
      "email-deliveries",
      "email-deliveries/queued",
      "email-deliveries/last-sent",
      "email-deliveries/overdue",
    ];

    it("lets a holder of read-email-deliveries, and the super-admin, read each", async () => {
      for (const path of READS) {
        expect((await get(path, reader)).status, path).toBe(200);
        expect((await get(path, root)).status, path).toBe(200);
      }
    });

    it("lets a reader open a delivery's and a queued email's detail, and refuses the rest", async () => {
      const [delivery] = itemsOf((await read("email-deliveries", reader)).body);
      const details = [
        `email-deliveries/${String(delivery.id)}`,
        `email-deliveries/queued/${failedQueuedId}`,
      ];
      for (const path of details) {
        const { body, text } = await read(path, reader);
        expectNothingPersonal(text);
        expect(body).toMatchObject({ timeline: expect.any(Array) });
        expect((await get(path, root)).status, path).toBe(200);
        for (const caller of [manager, stranger, selfRegistered]) {
          expect(REFUSED, path).toContain((await get(path, caller)).status);
        }
      }
      // An id that names nothing, whatever its shape, is not found.
      for (const path of [
        "email-deliveries/00000000-0000-4000-8000-000000000000",
        "email-deliveries/not-an-id",
        "email-deliveries/queued/not-an-id",
      ]) {
        expect((await get(path, reader)).status, path).toBe(404);
      }
    });

    it("refuses each read to a manager without the read grant, a user with no email grant, and a self-registered account", async () => {
      for (const path of READS) {
        for (const caller of [manager, stranger, selfRegistered]) {
          expect(REFUSED, path).toContain((await get(path, caller)).status);
        }
      }
    });

    it("lists deliveries newest first, each field named and nothing personal", async () => {
      const { body, text } = await read("email-deliveries", reader);
      expectNothingPersonal(text);
      const items = itemsOf(body);
      for (const item of items) {
        expect(Object.keys(item).sort()).toEqual(DELIVERY_FIELDS);
      }
      // The queued email's own send is recorded too; the dated rows follow it.
      const dated = items.filter(item => String(item.createdAt) < "2026-11-05");
      expect(dated).toEqual([
        {
          id: expect.any(String),
          createdAt: "2026-11-04T10:00:00.000Z",
          outcome: "failed",
          templateSlug: "welcome",
          provider: { id: null, type: "smtp" },
          recipientKind: "to",
          failureReason: "The email provider refused the message.",
          namedPerson: false,
          erased: true,
          queuedId: null,
          templateVersion: "not-recorded",
          failureKind: null,
          failureStatus: null,
        },
        {
          id: expect.any(String),
          createdAt: "2026-11-03T10:00:00.000Z",
          outcome: "sent",
          templateSlug: null,
          provider: { id: null, type: "smtp" },
          recipientKind: "to",
          failureReason: null,
          namedPerson: true,
          erased: false,
          queuedId: null,
          templateVersion: "not-recorded",
          failureKind: null,
          failureStatus: null,
        },
        {
          id: expect.any(String),
          createdAt: "2026-11-02T10:00:00.000Z",
          outcome: "failed",
          templateSlug: "password-reset",
          provider: { id: null, type: "smtp" },
          recipientKind: "to",
          failureReason: expect.not.stringContaining("carol"),
          namedPerson: false,
          erased: false,
          queuedId: null,
          templateVersion: "not-recorded",
          failureKind: null,
          failureStatus: null,
        },
        expect.objectContaining({
          createdAt: "2026-11-01T10:00:00.000Z",
          provider: { id: providerId, type: "log" },
        }),
        expect.objectContaining({
          createdAt: "2026-11-01T10:00:00.000Z",
          provider: { id: providerId, type: "log" },
        }),
      ]);
      expect(
        dated
          .slice(3)
          .map(item => item.recipientKind)
          .sort()
      ).toEqual(["cc", "to"]);
    });

    it("filters deliveries by outcome, template, provider and time", async () => {
      const slugsOf = async (query: string) =>
        itemsOf((await read(`email-deliveries?${query}`, reader)).body).map(
          item => `${item.outcome}:${item.templateSlug}`
        );

      expect(await slugsOf("outcome=failed")).toEqual([
        "failed:welcome",
        "failed:password-reset",
      ]);
      expect(await slugsOf("template=welcome")).toEqual([
        "failed:welcome",
        "sent:welcome",
        "sent:welcome",
      ]);
      expect(await slugsOf(`providerId=${providerId}`)).toEqual(
        expect.arrayContaining(["sent:welcome", "sent:welcome"])
      );
      expect(
        (await slugsOf(`providerId=${providerId}`)).filter(s =>
          s.startsWith("failed")
        )
      ).toEqual([]);
      // A provider id in capitals names the same provider on every dialect.
      expect(await slugsOf(`providerId=${providerId.toUpperCase()}`)).toEqual(
        await slugsOf(`providerId=${providerId}`)
      );
      expect(await slugsOf("providerType=smtp")).toEqual([
        "failed:welcome",
        "sent:null",
        "failed:password-reset",
      ]);
      expect(
        await slugsOf(
          "from=2026-11-02T00:00:00.000Z&to=2026-11-03T23:59:59.999Z"
        )
      ).toEqual(["sent:null", "failed:password-reset"]);
    });

    it("pages deliveries by cursor in the list's canonical meta, without repeating or skipping one", async () => {
      const seen: string[] = [];
      let before: string | undefined;
      let pages = 0;
      do {
        const query: string = before
          ? `limit=2&before=${encodeURIComponent(before)}`
          : "limit=2";
        const { body } = await read(`email-deliveries?${query}`, reader);
        const items = itemsOf(body);
        const meta = body.meta as Item;
        expect(meta).toMatchObject({
          limit: 2,
          total: items.length,
          hasPrev: pages > 0,
          hasNext: meta.nextBefore !== undefined,
        });
        expect(items.length).toBeLessThanOrEqual(2);
        seen.push(...items.map(item => String(item.id)));
        before = meta.nextBefore as string | undefined;
        pages += 1;
      } while (before);
      expect(pages).toBeGreaterThan(1);
      const all = itemsOf(
        (await read("email-deliveries?limit=100", reader)).body
      ).map(item => String(item.id));
      expect(seen).toEqual(all);
    });

    it("refuses a filter it cannot read", async () => {
      for (const query of [
        "outcome=bounced",
        "from=yesterday",
        "limit=0",
        "limit=1000",
        "before=not-a-cursor",
        // PostgreSQL holds a provider's id as a UUID: anything else is
        // refused alike on every dialect, not a database error on one.
        "providerId=not-a-uuid",
        `before=${Buffer.from(JSON.stringify([1, "not-a-uuid"])).toString("base64url")}`,
        // A time no date can hold.
        `before=${Buffer.from(JSON.stringify([1e100, "00000000-0000-4000-8000-000000000000"])).toString("base64url")}`,
      ]) {
        expect(
          (await get(`email-deliveries?${query}`, reader)).status,
          query
        ).toBe(400);
      }
    });

    it("lists queued emails with their state, attempts and failure, and nothing personal", async () => {
      const { body, text } = await read("email-deliveries/queued", reader);
      expectNothingPersonal(text);
      const items = itemsOf(body);
      for (const item of items) {
        expect(Object.keys(item).sort()).toEqual(QUEUED_FIELDS);
      }
      const byId = new Map(items.map(item => [item.id, item]));
      expect(byId.get(sentQueuedId)).toMatchObject({
        state: "sent",
        attempts: 1,
        messageHeld: false,
        templateSlug: null,
        queuedBy: "site",
        nextAttemptAt: null,
        lastFailure: null,
        settledAt: expect.any(String),
      });
      expect(byId.get(failedQueuedId)).toMatchObject({
        state: "failed",
        attempts: 1,
        messageHeld: true,
        templateSlug: "no-such-template",
        nextAttemptAt: null,
        lastFailure: { retryable: false, reason: expect.any(String) },
      });
    });

    it("filters queued emails by state, template and time", async () => {
      const idsOf = async (query: string) =>
        itemsOf(
          (await read(`email-deliveries/queued?${query}`, reader)).body
        ).map(item => item.id);

      expect(await idsOf("state=failed")).toEqual([failedQueuedId]);
      expect(await idsOf("state=sent")).toEqual([sentQueuedId]);
      expect(await idsOf("state=retrying")).toEqual([]);
      expect(await idsOf("template=no-such-template")).toEqual([
        failedQueuedId,
      ]);
      expect(await idsOf("from=2099-01-01T00:00:00.000Z")).toEqual([]);
    });

    it("says when each template was last sent, from sent deliveries only", async () => {
      const { body } = await read("email-deliveries/last-sent", reader);
      const templates = (body.templates ??
        (body.data as Item)?.templates) as Item[];
      expect(templates).toEqual(
        expect.arrayContaining([
          { slug: "welcome", lastSentAt: "2026-11-01T10:00:00.000Z" },
        ])
      );
      // A template whose only delivery failed has not been sent.
      expect(templates.map(entry => entry.slug)).not.toContain(
        "password-reset"
      );
      // Said as far back as the log reaches: its retention window's start.
      const keptSince = Date.parse(String(body.keptSince));
      const ninetyDays = 90 * 24 * 60 * 60 * 1000;
      expect(Math.abs(Date.now() - ninetyDays - keptSince)).toBeLessThan(
        60_000
      );
    });

    it("says whether queued email is overdue, and by how many", async () => {
      const { body } = await read("email-deliveries/overdue", reader);
      expect(body.data ?? body).toEqual({
        overdue: 0,
        capped: false,
        warningAfterMinutes: 15,
      });
    });

    it("offers the same reads on the Direct API, checked as REST checks them", async () => {
      const page = await t.nextly.emailDeliveries.find({ outcome: "failed" });
      expect(page.items.map(item => item.templateSlug)).toEqual([
        "welcome",
        "password-reset",
      ]);
      expectNothingPersonal(JSON.stringify(page));
      const queued = await t.nextly.emailDeliveries.findQueued({
        state: "failed",
      });
      expect(queued.items.map(item => item.id)).toEqual([failedQueuedId]);
      const lastSent = await t.nextly.emailDeliveries.lastSent();
      expect(lastSent.templates).toEqual(
        expect.arrayContaining([
          { slug: "welcome", lastSentAt: at("2026-11-01T10:00:00.000Z") },
        ])
      );
      expect(lastSent.keptSince).toBeInstanceOf(Date);
      expect(await t.nextly.emailDeliveries.overdue()).toEqual({
        overdue: 0,
        capped: false,
        warningAfterMinutes: 15,
      });

      // Checked: the reader may, a user without the grant may not.
      await expect(
        t.nextly.emailDeliveries.find({
          overrideAccess: false,
          user: { id: readerId },
        })
      ).resolves.toMatchObject({ items: expect.any(Array) });
      for (const call of [
        () =>
          t.nextly.emailDeliveries.find({
            overrideAccess: false,
            user: { id: strangerId },
          }),
        () =>
          t.nextly.emailDeliveries.findQueued({
            overrideAccess: false,
            user: { id: strangerId },
          }),
        () =>
          t.nextly.emailDeliveries.lastSent({
            overrideAccess: false,
            user: { id: strangerId },
          }),
        () =>
          t.nextly.emailDeliveries.overdue({
            overrideAccess: false,
            user: { id: strangerId },
          }),
      ]) {
        await expect(call()).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
    });

    it("queues a template name longer than any template's as having no template, on every dialect", async () => {
      const long = "x".repeat(300);
      const queued = await t.nextly.email.queueWithTemplate({
        template: long,
        to: "queued@example.com",
      });
      const { items } = await t.nextly.emailDeliveries.findQueued({});
      expect(items.find(item => item.id === queued.id)).toMatchObject({
        state: "failed",
        templateSlug: null,
      });
    });
  });
}
