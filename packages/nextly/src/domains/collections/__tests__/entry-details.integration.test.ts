/**
 * What an editor's read of an entry adds about it with `?details=1`: where
 * the site serves it, and who made and changed it.
 *
 * Who is personal data, so the property that matters is who is told. A
 * signed-in admin user who may read the entry is told a name and a kind,
 * never an email address or an id; anyone else gets the plain entry, the
 * param ignored: a visitor on a public collection, an API key, and a person
 * the read refuses (who gets the refusal and nothing in it).
 *
 * Driven through the REST route handler, so each request meets the gate a
 * real one meets.
 *
 * @module domains/collections/__tests__/entry-details.integration.test
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { resetSessionStandingForTests } from "../../../auth/session/session-standing";
import { defineCollection, text } from "../../../config";
import { container } from "../../../di/container";
import { seedPermissionsAndRolePresets } from "../../../init/seed-permissions";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import type { ApiKeyService } from "../../auth/services/api-key-service";
import type { GeneralSettingsService } from "../../../services/general-settings/general-settings-service";

const ORIGIN = "http://localhost";
/** Read by anyone, served at `/notes/<slug>`. */
const NOTES = "notes";
/** Read only by those holding its read permission; no public address. */
const LEDGER = "ledger";

type Doc = Record<string, unknown>;

describe.each(getConfiguredTestDialects())(
  "an editor's read of an entry tells where it is served and who made and changed it (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let ana: { id: string; roleId: string };
    let ben: { id: string; roleId: string };
    let carl: { id: string; roleId: string };
    let anaKey: string;
    let noteId: string;
    let ledgerId: string;

    async function session(user: { id: string; roleId: string }) {
      const token = await signAccessToken(
        buildClaims({
          userId: user.id,
          email: `${user.id}@example.com`,
          name: user.id,
          image: null,
          roleIds: [user.roleId],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET!
      );
      return { cookie: `nextly_session=${token}` };
    }

    function send(
      headers: Record<string, string>,
      method: "GET" | "POST" | "PATCH",
      path: string,
      body?: unknown
    ): Promise<Response> {
      const [route, search = ""] = path.split("?");
      const handlers = createDynamicHandlers();
      return handlers[method](
        new Request(`${ORIGIN}/api/${route}${search ? `?${search}` : ""}`, {
          method,
          headers: {
            origin: ORIGIN,
            ...headers,
            ...(body ? { "content-type": "application/json" } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
        { params: Promise.resolve({ params: route!.split("/") }) }
      );
    }

    /** The entry a GET answers, and its status, as raw text too. */
    async function read(headers: Record<string, string>, path: string) {
      const res = await send(headers, "GET", path);
      const raw = await res.text();
      return { status: res.status, raw, doc: JSON.parse(raw) as Doc };
    }

    const detailsOf = (doc: Doc) => doc._details as Doc | undefined;

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        collections: [
          defineCollection({
            slug: NOTES,
            access: { read: () => true },
            publicAddress: "/notes/{slug}",
            fields: [text({ name: "title" }), text({ name: "slug" })],
          }),
          defineCollection({
            slug: LEDGER,
            fields: [text({ name: "title" }), text({ name: "slug" })],
          }),
        ],
      });
      // Permissions, and the Public role's read of `notes`, whose rule
      // answers a visitor yes.
      await seedPermissionsAndRolePresets();

      const direct = t.nextly as unknown as {
        users: {
          create(a: {
            email: string;
            password: string;
            data: Record<string, unknown>;
          }): Promise<{ item: { id: string } }>;
        };
        permissions: {
          find(a: { limit: number }): Promise<{
            items: { id: string; slug: string }[];
          }>;
        };
        roles: {
          create(a: { data: Record<string, unknown> }): Promise<{
            item: { id: string };
          }>;
        };
      };
      const seeded = await direct.permissions.find({ limit: 1000 });
      const idOf = (slug: string) =>
        seeded.items.find(p => p.slug === slug)!.id;
      const person = async (name: string, permissions: string[]) => {
        const roleId = (
          await direct.roles.create({
            data: { name, slug: name, permissionIds: permissions.map(idOf) },
          })
        ).item.id;
        const id = (
          await direct.users.create({
            email: `${name}@example.com`,
            password: "Password123!",
            data: { name, isActive: true, roles: [roleId] },
          })
        ).item.id;
        return { id, roleId };
      };
      const writes = [NOTES, LEDGER].flatMap(slug => [
        `create-${slug}`,
        `read-${slug}`,
        `update-${slug}`,
      ]);
      ana = await person("ana", writes);
      ben = await person("ben", writes);
      // May read the notes, not the ledger.
      carl = await person("carl", [`read-${NOTES}`]);

      const created = await send(
        await session(ana),
        "POST",
        `collections/${NOTES}/entries`,
        {
          title: "Pricing",
          slug: "pricing",
        }
      );
      expect(created.status, await created.clone().text()).toBeLessThan(300);
      noteId = String(((await created.json()) as { item?: Doc }).item?.id);
      const changed = await send(
        await session(ben),
        "PATCH",
        `collections/${NOTES}/entries/${noteId}`,
        { title: "Prices", _overwrite: true }
      );
      expect(changed.status, await changed.clone().text()).toBeLessThan(300);

      const ledger = await send(
        await session(ana),
        "POST",
        `collections/${LEDGER}/entries`,
        {
          title: "Q3",
          slug: "q3",
        }
      );
      expect(ledger.status).toBeLessThan(300);
      ledgerId = String(((await ledger.json()) as { item?: Doc }).item?.id);

      const keys = t.getService("apiKeyService") as unknown as ApiKeyService;
      anaKey = (
        await keys.createApiKey(ana.id, {
          name: "ana reads",
          tokenType: "read-only",
          expiresIn: "7d",
        })
      ).key;

      await container
        .get<GeneralSettingsService>("generalSettingsService")
        .updateSettings({ siteUrl: "https://ridgeline.example" });
    }, 180_000);

    afterAll(async () => {
      resetSessionStandingForTests();
      await t?.destroy();
    });

    it("names who made it and who changed it last, by name and never by email or id", async () => {
      const { status, raw, doc } = await read(
        await session(carl),
        `collections/${NOTES}/entries/${noteId}?details=1`
      );
      expect(status).toBe(200);
      expect(detailsOf(doc)).toMatchObject({
        createdBy: { kind: "person", name: "ana" },
        updatedBy: { kind: "person", name: "ben" },
      });
      expect(typeof detailsOf(doc)?.updatedAt).toBe("string");
      for (const secret of [
        "ana@example.com",
        "ben@example.com",
        ana.id,
        ben.id,
      ]) {
        expect(raw).not.toContain(secret);
      }
    });

    it("gives the site's address and the entry's path, with the slug's place in it", async () => {
      const { doc } = await read(
        await session(carl),
        `collections/${NOTES}/entries/${noteId}?details=1`
      );
      expect(detailsOf(doc)?.address).toEqual({
        site: "https://ridgeline.example/",
        path: "/notes/pricing",
        aroundSlug: { before: "/notes/", after: "" },
      });
    });

    it("gives no address for a type the site does not serve", async () => {
      const { doc } = await read(
        await session(ana),
        `collections/${LEDGER}/entries/${ledgerId}?details=1`
      );
      expect(detailsOf(doc)).toMatchObject({
        address: null,
        createdBy: { kind: "person", name: "ana" },
      });
    });

    it("names a person as their account names them now, and as nobody once it is gone", async () => {
      await t.adapter.update(
        "users",
        { name: "Ana Ruiz" },
        { and: [{ column: "id", op: "=", value: ana.id }] }
      );
      await t.adapter.delete("users", {
        and: [{ column: "id", op: "=", value: ben.id }],
      });
      const { doc } = await read(
        await session(carl),
        `collections/${NOTES}/entries/${noteId}?details=1`
      );
      expect(detailsOf(doc)).toMatchObject({
        createdBy: { kind: "person", name: "Ana Ruiz" },
        updatedBy: { kind: "person", name: null, gone: true },
      });
    });

    it("tells a reader the read refuses nothing, details or not", async () => {
      const { status, raw } = await read(
        await session(carl),
        `collections/${LEDGER}/entries/${ledgerId}?details=1`
      );
      expect(status).toBeGreaterThanOrEqual(400);
      expect(raw).not.toContain("_details");
      expect(raw).not.toContain("Ana Ruiz");
    });

    it("gives a visitor the plain entry, the param ignored", async () => {
      const { status, raw, doc } = await read(
        {},
        `collections/${NOTES}/entries/${noteId}?details=1`
      );
      expect(status).toBe(200);
      expect(doc).toMatchObject({ title: "Prices" });
      expect(raw).not.toContain("_details");
    });

    it("gives an API key the plain entry, the param ignored", async () => {
      const { status, raw, doc } = await read(
        { authorization: `Bearer ${anaKey}` },
        `collections/${NOTES}/entries/${noteId}?details=1`
      );
      expect(status).toBe(200);
      expect(doc).toMatchObject({ title: "Prices" });
      expect(raw).not.toContain("_details");
    });

    it("tells an account with no name from one that is gone", async () => {
      await t.adapter.update(
        "users",
        { name: "" },
        { and: [{ column: "id", op: "=", value: ana.id }] }
      );
      const { doc } = await read(
        await session(carl),
        `collections/${NOTES}/entries/${noteId}?details=1`
      );
      const createdBy = detailsOf(doc)?.createdBy as Doc;
      expect(createdBy).toEqual({ kind: "person", name: null });
    });

    it("adds nothing to a read that does not ask", async () => {
      const { raw } = await read(
        await session(carl),
        `collections/${NOTES}/entries/${noteId}`
      );
      expect(raw).not.toContain("_details");
    });
  }
);
