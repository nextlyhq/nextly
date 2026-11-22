/**
 * What an editor's read of a Single adds about it with `?details=1`: who
 * changed it last and when, and where the site serves it. The same answer,
 * under the same rule, as an entry's read gives.
 *
 * Who is personal data, so the property that matters is who is told. A
 * signed-in admin user who may read the Single is told a name and a kind,
 * never an email address or an id; anyone else gets the plain Single, the
 * param ignored: a visitor on a Single anyone may read, an API key, and a
 * person the read refuses (who gets the refusal and nothing in it).
 *
 * Driven through the REST route handler, so each request meets the gate a
 * real one meets.
 *
 * @module domains/singles/__tests__/single-details.integration.test
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { resetSessionStandingForTests } from "../../../auth/session/session-standing";
import { defineSingle, text } from "../../../config";
import { container } from "../../../di/container";
import { seedPermissionsAndRolePresets } from "../../../init/seed-permissions";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import type { GeneralSettingsService } from "../../../services/general-settings/general-settings-service";
import type { ApiKeyService } from "../../auth/services/api-key-service";

const ORIGIN = "http://localhost";
/** Read by anyone, served at `/contact`. */
const CONTACT = "contact-details";
/** Read only by those holding its read permission; no public address. */
const LEDGER = "ledger-settings";

type Doc = Record<string, unknown>;

describe.each(getConfiguredTestDialects())(
  "an editor's read of a Single tells who changed it and where it is served (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let ana: { id: string; roleId: string };
    let ben: { id: string; roleId: string };
    let carl: { id: string; roleId: string };
    let anaKey: string;

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
      method: "GET" | "PATCH",
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

    /** The Single a GET answers, and its status, as raw text too. */
    async function read(headers: Record<string, string>, path: string) {
      const res = await send(headers, "GET", path);
      const raw = await res.text();
      return { status: res.status, raw, doc: JSON.parse(raw) as Doc };
    }

    const detailsOf = (doc: Doc) => doc._details as Doc | undefined;

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        singles: [
          defineSingle({
            slug: CONTACT,
            access: { read: () => true },
            publicAddress: "/contact",
            fields: [text({ name: "phone" })],
          }),
          defineSingle({
            slug: LEDGER,
            fields: [text({ name: "currency" })],
          }),
        ],
      });
      // Permissions, and the Public role's read of the contact details,
      // whose rule answers a visitor yes.
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
      const writes = [CONTACT, LEDGER].flatMap(slug => [
        `read-${slug}`,
        `update-${slug}`,
      ]);
      ana = await person("ana", writes);
      ben = await person("ben", writes);
      // May read the contact details, not the ledger.
      carl = await person("carl", [`read-${CONTACT}`]);

      const saved = await send(
        await session(ana),
        "PATCH",
        `singles/${CONTACT}`,
        { phone: "555-0100", _overwrite: true }
      );
      expect(saved.status, await saved.clone().text()).toBeLessThan(300);
      // A moment later, as a database may keep change times to the second.
      await new Promise(resolve => setTimeout(resolve, 1_100));
      const changed = await send(
        await session(ben),
        "PATCH",
        `singles/${CONTACT}`,
        { phone: "555-0199", _overwrite: true }
      );
      expect(changed.status, await changed.clone().text()).toBeLessThan(300);

      const ledger = await send(
        await session(ana),
        "PATCH",
        `singles/${LEDGER}`,
        { currency: "EUR", _overwrite: true }
      );
      expect(ledger.status, await ledger.clone().text()).toBeLessThan(300);

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

    it("names who changed it last and when, by name and never by email or id", async () => {
      const { status, raw, doc } = await read(
        await session(carl),
        `singles/${CONTACT}?details=1`
      );
      expect(status).toBe(200);
      expect(detailsOf(doc)).toMatchObject({
        updatedBy: { kind: "person", name: "ben" },
      });
      expect(Object.keys(detailsOf(doc) ?? {}).sort()).toEqual([
        "address",
        "createdBy",
        "updatedAt",
        "updatedBy",
      ]);
      expect(Number.isNaN(Date.parse(String(detailsOf(doc)?.updatedAt)))).toBe(
        false
      );
      for (const secret of [
        "ana@example.com",
        "ben@example.com",
        ana.id,
        ben.id,
      ]) {
        expect(raw).not.toContain(secret);
      }
    });

    it("gives the site's address and the Single's path", async () => {
      const { doc } = await read(
        await session(carl),
        `singles/${CONTACT}?details=1`
      );
      expect(detailsOf(doc)?.address).toEqual({
        site: "https://ridgeline.example/",
        path: "/contact",
      });
    });

    it("gives no address for a Single the site does not serve", async () => {
      const { doc } = await read(
        await session(ana),
        `singles/${LEDGER}?details=1`
      );
      expect(detailsOf(doc)).toMatchObject({
        address: null,
        updatedBy: { kind: "person", name: "ana" },
      });
    });

    it("tells a reader the read refuses nothing, details or not", async () => {
      const { status, raw } = await read(
        await session(carl),
        `singles/${LEDGER}?details=1`
      );
      expect(status).toBeGreaterThanOrEqual(400);
      expect(raw).not.toContain("_details");
      expect(raw).not.toContain('"ana"');
    });

    it("gives a visitor the plain Single, the param ignored", async () => {
      const { status, raw, doc } = await read(
        {},
        `singles/${CONTACT}?details=1`
      );
      expect(status).toBe(200);
      expect(doc).toMatchObject({ phone: "555-0199" });
      expect(raw).not.toContain("_details");
    });

    it("gives an API key the plain Single, the param ignored", async () => {
      const { status, raw, doc } = await read(
        { authorization: `Bearer ${anaKey}` },
        `singles/${CONTACT}?details=1`
      );
      expect(status).toBe(200);
      expect(doc).toMatchObject({ phone: "555-0199" });
      expect(raw).not.toContain("_details");
    });

    it("names a person as nobody once their account is gone", async () => {
      await t.adapter.delete("users", {
        and: [{ column: "id", op: "=", value: ben.id }],
      });
      const { doc } = await read(
        await session(carl),
        `singles/${CONTACT}?details=1`
      );
      expect(detailsOf(doc)).toMatchObject({
        updatedBy: { kind: "person", name: null, gone: true },
      });
    });

    it("adds nothing to a read that does not ask", async () => {
      const { raw } = await read(await session(carl), `singles/${CONTACT}`);
      expect(raw).not.toContain("_details");
    });
  }
);
