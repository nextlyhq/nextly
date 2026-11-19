/**
 * Finding what was sent to one exact address: through the REST catch-all as
 * real users with real roles, and through the Direct API.
 *
 * The address is turned into its keyed digests under the current and the
 * previous secrets and matched against the delivery log and the queued
 * email's recipients; records made under a secret no longer configured are
 * not found, and the answer says so. The address is never stored, logged or
 * returned: the search is recorded in the activity log by who made it and
 * how many it found, and nothing else.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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
import type { ActivityLogService } from "../../../services/dashboard/activity-log-service";
import { allResources } from "../../../services/dashboard/readable-resources";
import { ServiceContainer } from "../../../services/index";
import type { Logger } from "../../../services/shared";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { ActivityEntry } from "../delivery-activity";
import { recipientDigests } from "../delivery-record";
import type { EmailDeliveryService } from "../services/email-delivery-service";

const ORIGIN = "http://localhost";
const REFUSED = [401, 403];

const ADA = "ada@example.com";
const GRACE = "grace@example.com";
const SECRET_B = "second-secret-at-least-32-characters-long!!";
const SECRET_C = "third-secret-at-least-32-characters-long!!!";

type Headers = Record<string, string>;

/** Every line logged while the tests run, as text. */
const logged: string[] = [];

function textOf(value: unknown): string {
  if (value instanceof Error) return `${value.message} ${value.stack ?? ""}`;
  try {
    return typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const capture =
  () =>
  (...args: unknown[]): void => {
    logged.push(args.map(textOf).join(" "));
  };

/** A logger that keeps every line, for the log capture. */
const capturingLogger: Logger = {
  debug: capture(),
  info: capture(),
  warn: capture(),
  error: capture(),
};

/**
 * Capture what the console and the process's own streams are handed until
 * the returned function restores them.
 */
function captureOutput(): () => void {
  const spies = [
    ...(["log", "info", "warn", "error", "debug"] as const).map(level =>
      vi.spyOn(console, level).mockImplementation(capture())
    ),
    ...[process.stdout, process.stderr].map(stream =>
      vi.spyOn(stream, "write").mockImplementation((chunk: unknown) => {
        logged.push(
          typeof chunk === "string"
            ? chunk
            : Buffer.from(chunk as Uint8Array).toString()
        );
        return true;
      })
    ),
  ];
  return () => {
    for (const spy of spies) spy.mockRestore();
  };
}

/** `address` as plain text, or any digest of it, in `text`. */
function expectNoAddress(text: string, address: string): void {
  expect(text.toLowerCase()).not.toContain(address.toLowerCase());
  for (const digest of recipientDigests(address)) {
    expect(text).not.toContain(digest);
  }
}

/** Run `body` with the install's secret `current`, `previous` retired. */
async function withSecrets<T>(
  current: string,
  previous: Array<string | undefined>,
  body: () => Promise<T>
): Promise<T> {
  const original = process.env.NEXTLY_SECRET;
  const prior = process.env.NEXTLY_SECRET_PREVIOUS;
  try {
    process.env.NEXTLY_SECRET = current;
    process.env.NEXTLY_SECRET_PREVIOUS = JSON.stringify(previous);
    _resetEnvCache();
    return await body();
  } finally {
    process.env.NEXTLY_SECRET = original;
    if (prior === undefined) delete process.env.NEXTLY_SECRET_PREVIOUS;
    else process.env.NEXTLY_SECRET_PREVIOUS = prior;
    _resetEnvCache();
  }
}

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
      email: `${name}@search.test`,
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
    email: `${name}@search.test`,
    password: "Password123!",
    data: { name, isActive: true },
  });
  const id = String((made.item as { id: string | number }).id);
  await services.userRoles.assignRoleToUser(id, roleId);
  return { headers: await tokenFor(id, name, [roleId]), id };
}

/** One request through the REST catch-all, as the admin sends it. */
function call(
  method: "GET" | "POST",
  path: string,
  headers: Headers,
  body?: unknown
): Promise<Response> {
  const [pathname] = path.split("?");
  const segments = pathname.split("/").filter(Boolean);
  const req = new Request(`${ORIGIN}/api/${path}`, {
    method,
    headers: {
      origin: ORIGIN,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    ...(body === undefined
      ? {}
      : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
  return createDynamicHandlers()[method](req, {
    params: Promise.resolve({ params: segments }),
  });
}

/** A search through REST: its status, body and text. */
async function search(
  headers: Headers,
  body: unknown,
  path = "email-deliveries/search"
): Promise<{ status: number; body: Record<string, unknown>; text: string }> {
  const response = await call("POST", path, headers, body);
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  return { status: response.status, body: parsed, text };
}

type Item = Record<string, unknown>;
const itemsOf = (body: Record<string, unknown>) =>
  (body.items ?? (body.data as Item)?.items) as Item[];

for (const dialect of getConfiguredTestDialects()) {
  describe(`the search by address — ${dialect}`, () => {
    let t: TestNextly;
    let deliveries: EmailDeliveryService;
    let reader: Headers;
    let readerId: string;
    let manager: Headers;
    let stranger: Headers;
    let strangerId: string;
    let selfRegistered: Headers;
    let adaQueuedId: string;
    let graceQueuedId: string;

    /** The id of the delivery recorded with `messageId`. */
    async function deliveryId(messageId: string): Promise<string> {
      const table = loadedDialect(dialect).tables.emailDeliveries;
      const db = t.adapter.getDrizzle() as never as {
        select(fields: unknown): {
          from(table: unknown): {
            where(condition: unknown): Promise<Array<{ id: string }>>;
          };
        };
      };
      const rows = await db
        .select({ id: table.id })
        .from(table)
        .where(eq(table.messageId as never, messageId));
      expect(rows).toHaveLength(1);
      return rows[0].id;
    }

    /** Every activity-log row filed under the search's namespace. */
    async function searchEntries(): Promise<Array<Record<string, unknown>>> {
      const table = loadedDialect(dialect).tables.activityLog;
      const db = t.adapter.getDrizzle() as never as {
        select(): {
          from(table: unknown): {
            where(condition: unknown): Promise<Array<Record<string, unknown>>>;
          };
        };
      };
      return db
        .select()
        .from(table)
        .where(eq(table.collection as never, "email-deliveries"));
    }

    beforeAll(async () => {
      t = await createTestNextly({ dialect, logger: capturingLogger });
      try {
        const services = new ServiceContainer(t.adapter);
        await seedAllPermissions();
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
            email: "self@search.test",
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

        await t.nextly.emailProviders.create({
          data: {
            name: "Log",
            type: "log",
            fromEmail: "from@example.com",
            configuration: {},
            isDefault: true,
          },
        });

        deliveries = t.getService(
          "emailDeliveryService"
        ) as unknown as EmailDeliveryService;
        // Ada as the admin's form wrote her, and Grace, each sent once
        // without the queue and queued once.
        await deliveries.record({
          to: "Ada Lovelace <ada@example.com>",
          providerType: "log",
          templateSlug: "welcome",
          status: "sent",
          messageId: "m-ada",
        });
        await deliveries.record({
          to: GRACE,
          providerType: "log",
          templateSlug: "welcome",
          status: "sent",
          messageId: "m-grace",
        });
        adaQueuedId = (
          await t.nextly.email.queue({
            to: ADA,
            subject: "For Ada",
            html: "<p>Ada</p>",
          })
        ).id;
        graceQueuedId = (
          await t.nextly.email.queue({
            to: GRACE,
            subject: "For Grace",
            html: "<p>Grace</p>",
          })
        ).id;
      } catch (error) {
        await t?.destroy();
        throw error;
      }
    }, 120_000);

    afterAll(async () => {
      await t?.destroy();
    });

    it("finds an exact address's deliveries and queued emails, however it is written, and nothing else", async () => {
      const found = await search(reader, { address: "  ADA@Example.com " });
      expect(found.status, found.text).toBe(200);
      const items = itemsOf(found.body);
      expect(
        items.map(item => `${String(item.kind)}:${String(item.id)}`).sort()
      ).toEqual(
        [
          `delivery:${await deliveryId("m-ada")}`,
          `queued:${adaQueuedId}`,
        ].sort()
      );
      expect(items.map(item => item.id)).not.toContain(graceQueuedId);
      expect(found.body.notice).toEqual(
        expect.stringContaining("can't be found")
      );
      expectNoAddress(found.text, ADA);
      expect(found.text.toLowerCase()).not.toContain("lovelace");

      // The merged Activity's filters narrow it: only the delivery was sent
      // from a template.
      const sent = await search(reader, { address: ADA, template: "welcome" });
      expect(sent.status, sent.text).toBe(200);
      expect(itemsOf(sent.body).map(item => item.kind)).toEqual(["delivery"]);

      // An address nothing was sent to finds nothing, and says the same.
      const none = await search(reader, { address: "nobody@example.com" });
      expect(none.status, none.text).toBe(200);
      expect(itemsOf(none.body)).toEqual([]);
      expect(none.body.notice).toEqual(found.body.notice);
    });

    it("finds a recipient a send filter added to a queued email, through its delivery", async () => {
      const added = "added@example.com";
      const queued = await t.nextly.email.queue({
        to: "first@example.com",
        subject: "Filtered",
        html: "<p>x</p>",
      });
      await deliveries.record({
        to: added,
        providerType: "log",
        status: "sent",
        messageId: "m-added",
        queuedId: queued.id,
      });
      const found = await t.nextly.emailDeliveries.search({
        address: added,
        user: { id: readerId },
      });
      expect(found.items.map(item => `${item.kind}:${item.id}`)).toEqual([
        `queued:${queued.id}`,
      ]);
    });

    it("pages a search by cursor, without repeating or skipping one", async () => {
      const first = await search(reader, { address: ADA, limit: 1 });
      expect(first.status, first.text).toBe(200);
      const meta = first.body.meta as Record<string, unknown>;
      expect(meta.hasNext).toBe(true);
      const second = await search(reader, {
        address: ADA,
        limit: 1,
        before: meta.nextBefore,
      });
      expect(second.status, second.text).toBe(200);
      const ids = [...itemsOf(first.body), ...itemsOf(second.body)].map(
        item => item.id
      );
      expect(new Set(ids).size).toBe(2);
      expect((second.body.meta as Record<string, unknown>).hasNext).toBe(false);
    });

    it("takes the address from the body alone, and refuses one it cannot read without repeating it", async () => {
      const inUrl = await search(
        reader,
        { address: ADA },
        `email-deliveries/search?address=${encodeURIComponent(ADA)}`
      );
      expect(inUrl.status, inUrl.text).toBe(400);
      expectNoAddress(inUrl.text, ADA);

      for (const body of [
        {},
        { address: "" },
        { address: "ada" },
        { address: "ada@" },
        { address: `${"a".repeat(400)}@example.com` },
        { address: 42 },
        "not json",
      ]) {
        const refused = await search(reader, body);
        expect(refused.status, `${JSON.stringify(body)} ${refused.text}`).toBe(
          400
        );
        expect(refused.text).not.toContain("ada@");
      }

      // A GET names no search: the address is never in a URL.
      const viaGet = await call("GET", "email-deliveries/search", reader);
      expect(viaGet.status).not.toBe(200);
    });

    it("refuses a search to a manager without the read grant, a user with no email grant, a self-registered account and no one, recording none", async () => {
      const before = (await searchEntries()).length;
      for (const headers of [manager, stranger, selfRegistered, {}]) {
        const refused = await search(headers, { address: ADA });
        expect(REFUSED, refused.text).toContain(refused.status);
        expectNoAddress(refused.text, ADA);
      }
      expect((await searchEntries()).length).toBe(before);
    });

    it("records each search in the activity log, by whom and how many it found, without the address", async () => {
      const before = await searchEntries();
      const found = await search(reader, { address: ADA });
      expect(found.status, found.text).toBe(200);
      const count = itemsOf(found.body).length;

      const after = await searchEntries();
      expect(after).toHaveLength(before.length + 1);
      const known = new Set(before.map(row => row.id));
      const entry = after.find(row => !known.has(row.id));
      expect(entry).toMatchObject({
        action: "read",
        collection: "email-deliveries",
        userId: readerId,
        actorType: "user",
        subjectKind: "settings",
      });
      const metadata =
        typeof entry?.metadata === "string"
          ? (JSON.parse(entry.metadata) as Record<string, unknown>)
          : (entry?.metadata as Record<string, unknown>);
      expect(metadata).toEqual({ found: count });
      expectNoAddress(JSON.stringify(entry), ADA);
      expect(JSON.stringify(entry).toLowerCase()).not.toContain("lovelace");

      // The feed reads it as a search, and still without the address.
      const activity = t.getService(
        "activityLogService"
      ) as unknown as ActivityLogService;
      const feed = await activity.getRecentActivity({
        userId: readerId,
        scope: allResources(),
        caller: { user: { id: readerId, roles: [] } },
      });
      const read = feed.activities.find(row => row.id === entry?.id);
      expect(read).toMatchObject({
        action: "read",
        collection: "email-deliveries",
      });
      expectNoAddress(JSON.stringify(feed), ADA);
    });

    it("logs nothing of the address, found, refused or invalid", async () => {
      const restore = captureOutput();
      logged.length = 0;
      try {
        await search(reader, { address: ADA });
        await search(reader, { address: ADA, before: "not-a-cursor" });
        await search(reader, { address: ADA, status: "nonsense" });
        await search(stranger, { address: ADA });
        await search(
          reader,
          { address: ADA },
          `email-deliveries/search?address=${encodeURIComponent(ADA)}`
        );
        await t.nextly.emailDeliveries.search({
          address: ADA,
          user: { id: readerId },
        });
        await expect(
          t.nextly.emailDeliveries.search({
            address: ADA,
            overrideAccess: false,
            user: { id: strangerId },
          })
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      } finally {
        restore();
      }
      expectNoAddress(logged.join("\n"), ADA);
    });

    it("keeps the address's digests out of a failed search's error and logs", async () => {
      // A driver's error quotes its statement's parameters: here, the
      // digests the search asked with.
      const quoting = () =>
        new Error(
          `Failed query: select ... params: ${recipientDigests(ADA).join(",")}`
        );
      const list = vi.spyOn(deliveries, "list");
      const restore = captureOutput();
      logged.length = 0;
      try {
        list.mockRejectedValueOnce(quoting());
        const failed = await search(reader, { address: ADA });
        expect(failed.status, failed.text).toBe(500);
        expectNoAddress(failed.text, ADA);

        list.mockRejectedValueOnce(quoting());
        const thrown = await t.nextly.emailDeliveries
          .search({ address: ADA, user: { id: readerId } })
          .then(
            () => undefined,
            (error: unknown) => error
          );
        expect(thrown).toMatchObject({ code: "INTERNAL_ERROR" });
        const chain: string[] = [];
        for (
          let current: unknown = thrown;
          current instanceof Error;
          current = current.cause
        ) {
          chain.push(current.message, current.stack ?? "", textOf(current));
        }
        expectNoAddress(chain.join("\n"), ADA);
      } finally {
        restore();
        list.mockRestore();
      }
      expectNoAddress(logged.join("\n"), ADA);
    });

    it("answers no search it could not record", async () => {
      const activity = t.getService(
        "activityLogService"
      ) as unknown as ActivityLogService;
      const write = vi
        .spyOn(activity, "logActivityInTx")
        .mockRejectedValueOnce(new Error("The activity log is unavailable."));
      const before = (await searchEntries()).length;
      try {
        const refused = await search(reader, { address: ADA });
        expect(refused.status, refused.text).toBe(500);
        expect(itemsOf(refused.body)).toBeUndefined();
        expect(write).toHaveBeenCalled();
      } finally {
        write.mockRestore();
      }
      expect(await searchEntries()).toHaveLength(before);
    });

    it("finds an address the send path takes, a quoted local part included", async () => {
      const quoted = '"Joe Smith"@example.com';
      await deliveries.record({
        to: quoted,
        providerType: "log",
        templateSlug: "quoted",
        status: "sent",
        messageId: "m-quoted",
      });
      const found = await search(reader, { address: quoted });
      expect(found.status, found.text).toBe(200);
      expect(itemsOf(found.body).map(item => item.id)).toEqual([
        await deliveryId("m-quoted"),
      ]);
    });

    it.skipIf(dialect === "sqlite")(
      "reads both halves on one snapshot, so an email pruned between them is listed once",
      async () => {
        // SQLite runs one transaction at a time, and the writes that settle
        // and prune queued email are transactions: none lands between the
        // two halves there.
        const address = "pruned@example.com";
        const queued = await t.nextly.email.queue({
          to: address,
          subject: "Pruned",
          html: "<p>x</p>",
        });
        await deliveries.record({
          to: address,
          providerType: "log",
          status: "sent",
          messageId: "m-pruned",
          queuedId: queued.id,
        });
        const queue = loadedDialect(dialect).tables.emailQueue;
        const db = t.adapter.getDrizzle() as never as {
          delete(table: unknown): {
            where(condition: unknown): Promise<unknown>;
          };
        };
        const original = deliveries.list.bind(deliveries);
        const list = vi
          .spyOn(deliveries, "list")
          .mockImplementationOnce(async options => {
            // The queue half has been read: the prune commits now, on a
            // connection of its own.
            await db.delete(queue).where(eq(queue.id as never, queued.id));
            return original(options);
          });
        try {
          const found = await t.nextly.emailDeliveries.search({
            address,
            user: { id: readerId },
          });
          expect(found.items.map(item => `${item.kind}:${item.id}`)).toEqual([
            `queued:${queued.id}`,
          ]);
        } finally {
          list.mockRestore();
        }
      }
    );

    it("offers the search on the Direct API, checked as REST checks it and recorded as the caller", async () => {
      const page = await t.nextly.emailDeliveries.search({
        address: ADA,
        user: { id: readerId },
      });
      expect(page.items.map(item => item.kind).sort()).toEqual([
        "delivery",
        "queued",
      ]);
      expect(page.notice).toEqual(expect.stringContaining("can't be found"));
      expectNoAddress(JSON.stringify(page), ADA);

      const before = (await searchEntries()).length;
      const checked = await t.nextly.emailDeliveries.search({
        address: ADA,
        overrideAccess: false,
        user: { id: readerId },
      });
      expect(checked.items).toHaveLength(page.items.length);
      const after = await searchEntries();
      expect(after).toHaveLength(before + 1);
      expect(after.map(row => row.userId)).toContain(readerId);

      await expect(
        t.nextly.emailDeliveries.search({
          address: ADA,
          overrideAccess: false,
          user: { id: strangerId },
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await searchEntries()).toHaveLength(before + 1);
      await expect(
        t.nextly.emailDeliveries.search({
          address: "ada",
          user: { id: readerId },
        })
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

      // A search no entry could name is refused before it reads anything:
      // a trusted call naming nobody, and a key the Direct API knows no id of.
      for (const unnamed of [
        { address: ADA },
        {
          address: ADA,
          actor: {
            actorType: "apiKey" as const,
            permissions: ["read-email-deliveries"],
          },
        },
      ]) {
        await expect(
          t.nextly.emailDeliveries.search(unnamed)
        ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      }
      expect(await searchEntries()).toHaveLength(before + 1);
    });

    it("finds records across one rotation, under the current and the previous secret", async () => {
      const address = "rotated-once@example.com";
      const original = process.env.NEXTLY_SECRET;
      await deliveries.record({
        to: address,
        providerType: "log",
        templateSlug: "before-rotation",
        status: "sent",
        messageId: "m-once-a",
      });
      const queuedBefore = await t.nextly.email.queue({
        to: address,
        subject: "Before",
        html: "<p>x</p>",
      });
      await withSecrets(SECRET_B, [original], async () => {
        await deliveries.record({
          to: address,
          providerType: "log",
          templateSlug: "after-rotation",
          status: "sent",
          messageId: "m-once-b",
        });
        const found = await t.nextly.emailDeliveries.search({
          address,
          user: { id: readerId },
        });
        const slugs = (entry: ActivityEntry) =>
          typeof entry.template === "object" ? entry.template.slug : null;
        expect(
          found.items
            .filter(entry => entry.kind === "delivery")
            .map(slugs)
            .sort()
        ).toEqual(["after-rotation", "before-rotation"]);
        expect(
          found.items
            .filter(entry => entry.kind === "queued")
            .map(entry => entry.id)
        ).toEqual([queuedBefore.id]);
      });
    });

    it("finds nothing older than the previous secret across two rotations, and says why", async () => {
      const address = "rotated-twice@example.com";
      const original = process.env.NEXTLY_SECRET;
      await deliveries.record({
        to: address,
        providerType: "log",
        templateSlug: "secret-a",
        status: "sent",
        messageId: "m-twice-a",
      });
      await withSecrets(SECRET_B, [original], async () => {
        await deliveries.record({
          to: address,
          providerType: "log",
          templateSlug: "secret-b",
          status: "sent",
          messageId: "m-twice-b",
        });
      });
      await withSecrets(SECRET_C, [SECRET_B], async () => {
        await deliveries.record({
          to: address,
          providerType: "log",
          templateSlug: "secret-c",
          status: "sent",
          messageId: "m-twice-c",
        });
        const found = await t.nextly.emailDeliveries.search({
          address,
          user: { id: readerId },
        });
        expect(
          found.items
            .map(entry =>
              typeof entry.template === "object" ? entry.template.slug : null
            )
            .sort()
        ).toEqual(["secret-b", "secret-c"]);
        // The oldest is still there, out of the search's reach.
        expect(await deliveryId("m-twice-a")).toEqual(expect.any(String));
        expect(found.notice).toMatch(/older|before/i);
        expect(found.notice).toContain("can't be found");
      });
    });
  });
}
