/**
 * A collection closed to super-admin refuses its entries to a super-admin,
 * through every way in a super-admin uses, and the mark is changed in the
 * admin only with the password entered again, each change audited.
 *
 * On every dialect this process can reach:
 * - the install's super-admin is refused a closed collection over REST (list,
 *   count, one entry) and through the Direct API as that person (find, count,
 *   findByID), and a related entry of it is withheld from an open collection's
 *   read, while the open collection itself reads as before;
 * - trusted server code still reads it;
 * - `PATCH /roles/screen/closed-to-super-admin` closes a collection with the
 *   right password, and changes nothing with a wrong one or none, nor for a
 *   collection whose code sets the mark; the change it makes is written to the
 *   audit log with who, the collection, and the value before and after;
 * - the roles screen shows each collection's mark and where it is set;
 * - two first changes made at once both hold;
 * - one account gets only a few password tries a window;
 * - the configuration's mark is written to the audit log the first time a
 *   start applies it, once.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { defineCollection, relationship, text } from "../../config";
import { Nextly } from "../../direct-api/nextly";
import { MetaService } from "../../domains/meta/services/meta-service";
import { seedPermissionsAndRolePresets } from "../../init/seed-permissions";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import { createDynamicHandlers } from "../../routeHandler";
import { SUPER_ADMIN_SLUG } from "../../services/access/super-admin";
import { buildClaims } from "../jwt/claims";
import { signAccessToken } from "../jwt/sign";

const ORIGIN = "http://localhost";
const quiet = { debug() {}, info() {}, warn() {}, error() {} };
const PASSWORD = "Password123!";
const KIND = "collection-super-admin-access-changed";

/** Closed in code. */
const RECORDS = "csa-records";
/** Open, with a relationship to a closed entry. */
const NOTES = "csa-notes";
/** Open in code's silence, closed later from the admin. */
const HEALTH = "csa-health";

type Method = "GET" | "PATCH";

/** One request through the REST catch-all, as the admin sends it. */
function rest(
  method: Method,
  path: string,
  cookie: string,
  body?: unknown
): Promise<Response> {
  const req = new Request(`${ORIGIN}/api/${path}`, {
    method,
    headers: {
      origin: ORIGIN,
      cookie,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return createDynamicHandlers()[method](req, {
    params: Promise.resolve({ params: path.split("?")[0].split("/") }),
  });
}

/** What a call answered: its value, or that it was refused. */
async function outcome<T>(
  run: () => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await run() };
  } catch {
    return { ok: false };
  }
}

describe.each(getConfiguredTestDialects())(
  "collections closed to super-admin (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let trusted: Nextly;
    let ownerId: string;
    let owner: string;
    let recordId: string;

    /** The audit rows of this kind, in no particular order. */
    async function auditRows(): Promise<
      Array<{ actor: string | null; metadata: Record<string, unknown> }>
    > {
      const rows = await (t.adapter as unknown as DrizzleAdapter).select<{
        actorUserId?: unknown;
        actor_user_id?: unknown;
        metadata: unknown;
        createdAt?: unknown;
        created_at?: unknown;
      }>("audit_log", {
        where: { and: [{ column: "kind", op: "=", value: KIND }] },
      });
      return rows.map(row => ({
        actor:
          (row.actorUserId ?? row.actor_user_id) == null
            ? null
            : String(row.actorUserId ?? row.actor_user_id),
        metadata:
          typeof row.metadata === "string"
            ? (JSON.parse(row.metadata) as Record<string, unknown>)
            : (row.metadata as Record<string, unknown>),
      }));
    }

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        collections: [
          defineCollection({
            slug: RECORDS,
            closedToSuperAdmin: true,
            fields: [text({ name: "title" })],
          }),
          defineCollection({
            slug: NOTES,
            fields: [
              text({ name: "title" }),
              relationship({ name: "record", relationTo: RECORDS }),
            ],
          }),
          defineCollection({ slug: HEALTH, fields: [text({ name: "title" })] }),
        ],
      });
      await seedPermissionsAndRolePresets();
      trusted = new Nextly();
      // The install's first account holds super-admin.
      const made = await trusted.users.create({
        email: "owner@closed.test",
        password: PASSWORD,
        data: { name: "Owner", isActive: true },
      });
      ownerId = String((made.item as { id: string }).id);
      const roles = await trusted.roles.find({ limit: 1000 });
      const superAdminRoleId = roles.items.find(
        r => r.slug === SUPER_ADMIN_SLUG
      )!.id;
      const token = await signAccessToken(
        buildClaims({
          userId: ownerId,
          email: "owner@closed.test",
          name: "Owner",
          image: null,
          roleIds: [String(superAdminRoleId)],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET ?? ""
      );
      owner = `nextly_session=${token}`;

      const record = await trusted.create({
        collection: RECORDS,
        data: { title: "made-up record" },
      });
      recordId = String((record.item as { id: string }).id);
      await trusted.create({
        collection: NOTES,
        data: { title: "made-up note", record: recordId },
      });
      await trusted.create({
        collection: HEALTH,
        data: { title: "made-up health row" },
      });
    }, 120_000);

    afterAll(async () => {
      await t?.destroy();
    });

    it("refuses the super-admin a closed collection over REST, and serves an open one", async () => {
      const base = `collections/${RECORDS}/entries`;
      for (const path of [base, `${base}/count`, `${base}/${recordId}`]) {
        const res = await rest("GET", path, owner);
        expect([401, 403, 404], `${path} answered ${res.status}`).toContain(
          res.status
        );
        expect(await res.text()).not.toContain("made-up record");
      }
      const open = await rest("GET", `collections/${NOTES}/entries`, owner);
      expect(open.status).toBe(200);
    });

    it("refuses the super-admin a closed collection through the Direct API, as themselves", async () => {
      const asOwner = new Nextly({
        overrideAccess: false,
        user: { id: ownerId },
      });
      const list = await outcome(() => asOwner.find({ collection: RECORDS }));
      if (list.ok) expect(list.value.items).toEqual([]);
      const counted = await outcome(() =>
        asOwner.count({ collection: RECORDS })
      );
      if (counted.ok) expect(counted.value.total).toBe(0);
      const one = await outcome(() =>
        asOwner.findByID({ collection: RECORDS, id: recordId })
      );
      if (one.ok) expect(one.value).toBeNull();
      expect([list.ok, counted.ok, one.ok]).not.toEqual([true, true, true]);

      // The open collection reads, and its related closed entry is withheld.
      const notes = await asOwner.find({ collection: NOTES, depth: 1 });
      expect(notes.items).toHaveLength(1);
      expect(JSON.stringify(notes.items)).not.toContain("made-up record");

      // Trusted server code is not a caller, and reads it.
      const read = await trusted.find({ collection: RECORDS });
      expect(read.items).toHaveLength(1);
    });

    it("shows each collection's mark and where it is set on the roles screen", async () => {
      const res = await rest("GET", "roles/screen", owner);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        items: Array<{ slug: string; closedToSuperAdmin?: unknown }>;
      };
      const mark = (slug: string) =>
        body.items.find(item => item.slug === slug)?.closedToSuperAdmin;
      expect(mark(RECORDS)).toEqual({ closed: true, setIn: "code" });
      expect(mark(HEALTH)).toEqual({ closed: false, setIn: null });
    });

    it("changes nothing without the right password, nor where the code sets the mark", async () => {
      const path = "roles/screen/closed-to-super-admin";
      const wrong = await rest("PATCH", path, owner, {
        collection: HEALTH,
        closed: true,
        password: "not the password",
      });
      expect([401, 403]).toContain(wrong.status);
      const none = await rest("PATCH", path, owner, {
        collection: HEALTH,
        closed: true,
      });
      expect(none.status).toBe(400);
      const inCode = await rest("PATCH", path, owner, {
        collection: RECORDS,
        closed: false,
        password: PASSWORD,
      });
      expect(inCode.status).toBe(409);

      expect(
        (await rest("GET", `collections/${HEALTH}/entries`, owner)).status
      ).toBe(200);
      expect(
        (await auditRows()).filter(r => r.metadata.source === "admin")
      ).toEqual([]);
    });

    it("closes a collection with the password, refusing the super-admin at once, and audits who and what", async () => {
      const res = await rest(
        "PATCH",
        "roles/screen/closed-to-super-admin",
        owner,
        { collection: HEALTH, closed: true, password: PASSWORD }
      );
      expect(res.status, await res.clone().text()).toBe(200);

      const after = await rest("GET", `collections/${HEALTH}/entries`, owner);
      expect([401, 403, 404]).toContain(after.status);

      const admin = (await auditRows()).filter(
        r => r.metadata.source === "admin"
      );
      expect(admin).toEqual([
        {
          actor: ownerId,
          metadata: {
            collection: HEALTH,
            before: "open",
            after: "closed",
            source: "admin",
          },
        },
      ]);

      // Opened again, the next change is audited too.
      const reopened = await rest(
        "PATCH",
        "roles/screen/closed-to-super-admin",
        owner,
        { collection: HEALTH, closed: false, password: PASSWORD }
      );
      expect(reopened.status).toBe(200);
      expect(
        (await rest("GET", `collections/${HEALTH}/entries`, owner)).status
      ).toBe(200);
      // One row for each change; the table keeps no order a read can rely on.
      expect(
        (await auditRows())
          .filter(r => r.metadata.source === "admin")
          .map(r => `${String(r.metadata.before)}>${String(r.metadata.after)}`)
          .sort()
      ).toEqual(["closed>open", "open>closed"]);
    });

    it("keeps both of two first changes made at once", async () => {
      // No row of admin marks yet, as on a site that never closed one.
      await new MetaService(
        t.adapter as unknown as DrizzleAdapter,
        quiet
      ).delete("collections-closed-to-super-admin");
      const path = "roles/screen/closed-to-super-admin";
      const both = await Promise.all(
        [HEALTH, NOTES].map(collection =>
          rest("PATCH", path, owner, {
            collection,
            closed: true,
            password: PASSWORD,
          })
        )
      );
      expect(both.map(res => res.status)).toEqual([200, 200]);
      const screen = (await (
        await rest("GET", "roles/screen", owner)
      ).json()) as {
        items: Array<{
          slug: string;
          closedToSuperAdmin?: { closed: boolean };
        }>;
      };
      const closed = (slug: string) =>
        screen.items.find(item => item.slug === slug)?.closedToSuperAdmin
          ?.closed;
      expect([closed(HEALTH), closed(NOTES)]).toEqual([true, true]);
      for (const collection of [HEALTH, NOTES]) {
        const reopened = await rest("PATCH", path, owner, {
          collection,
          closed: false,
          password: PASSWORD,
        });
        expect(reopened.status).toBe(200);
      }
    });

    it("stops taking password tries from one account after a few in a window", async () => {
      const path = "roles/screen/closed-to-super-admin";
      const statuses: number[] = [];
      for (let i = 0; i < 12; i++) {
        const res = await rest("PATCH", path, owner, {
          collection: HEALTH,
          closed: true,
          password: `guess ${i}`,
        });
        statuses.push(res.status);
      }
      expect(statuses).toContain(429);
      // Once refused, even the right password waits, and nothing changed.
      const right = await rest("PATCH", path, owner, {
        collection: HEALTH,
        closed: true,
        password: PASSWORD,
      });
      expect(right.status).toBe(429);
      expect(
        (await rest("GET", `collections/${HEALTH}/entries`, owner)).status
      ).toBe(200);
    });

    it("audits the configuration's mark once, the first time a start applies it", async () => {
      const fromCode = () =>
        auditRows().then(rows =>
          rows.filter(r => r.metadata.source === "code")
        );
      expect(await fromCode()).toEqual([
        {
          actor: null,
          metadata: {
            collection: RECORDS,
            before: "open",
            after: "closed",
            source: "code",
          },
        },
      ]);
      await seedPermissionsAndRolePresets();
      expect(await fromCode()).toHaveLength(1);
    });
  }
);
