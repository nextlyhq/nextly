/**
 * The doors that refuse a visitor before any access decision.
 *
 * A plugin route that is not public, the schema builder's collection list and
 * a document lock claim each ask for a signed-in caller first, so a visitor
 * (no session, no key) is answered 401 there whatever the Public role holds
 * and whatever the target's rule says. The access table leaves the visitor
 * out of those doors, since a row there would test this gate rather than the
 * one answer; this pins the gate itself.
 *
 * Each request is the one the table's door makes. The Public role holds the
 * permission each one names and the target's rule answers `true`, so a door
 * that judged the visitor by the decision would let it through: the 401 is the
 * sign-in gate's. A super-admin's session making the same request is answered
 * without a 401, so a request that could not succeed for anyone does not pass
 * for a refused visitor.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as listCollectionsSchema } from "../../api/collections-schema";
import { defineCollection, text } from "../../config";
import { container } from "../../di/container";
import type {
  DocumentLockService,
  DocumentRef,
} from "../../domains/document-lock";
import { PUBLIC_ROLE_SLUG } from "../../domains/auth/services/public-role";
import { seedPermissionsAndRolePresets } from "../../init/seed-permissions";
import { definePlugin } from "../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import { createDynamicHandlers } from "../../routeHandler";
import { ServiceContainer } from "../../services/index";
import { buildClaims } from "../jwt/claims";
import { signAccessToken } from "../jwt/sign";

import { refusalOf } from "./access-every-way-in/refusals";

const ORIGIN = "http://localhost";
const NOTES = "gated_notes";
const PLUGIN = "signedin";

/**
 * A collection anyone may read and update by its rule, so a refusal of the
 * visitor cannot be the rule's.
 */
const notes = defineCollection({
  slug: NOTES,
  access: { read: () => true, update: () => true },
  fields: [text({ name: "title" })],
});

/** A plugin route that is not public, gated by a permission Public holds. */
const gatedPlugin = definePlugin({
  name: PLUGIN,
  version: "1.0.0",
  nextly: ">=0.0.1",
  contributes: {
    routes: [
      {
        method: "GET",
        path: "/gate",
        requiredPermission: `read-${NOTES}`,
        handler: () => Response.json({ ok: true }),
      },
    ],
  },
});

type Method = "GET" | "POST";

/** A request through the REST catch-all, as the table's doors send one. */
function request(
  method: Method,
  segments: string[],
  headers: Record<string, string>,
  body?: unknown
): Promise<Response> {
  const req = new Request(`${ORIGIN}/api/${segments.join("/")}`, {
    method,
    headers: {
      origin: ORIGIN,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return createDynamicHandlers()[method](req, {
    params: Promise.resolve({ params: segments }),
  });
}

/** The schema builder's collection list, as the table's `schema` door asks it. */
function schemaList(headers: Record<string, string>): Promise<Response> {
  return listCollectionsSchema(
    new Request(`${ORIGIN}/api/collections/schema?limit=500`, { headers })
  );
}

/** A visitor sends no session cookie and no key. */
const VISITOR: Record<string, string> = {};

describe.each(getConfiguredTestDialects())(
  "a visitor is refused before the decision (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let superAdmin: Record<string, string>;
    let ref: DocumentRef;

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        collections: [notes],
        plugins: [gatedPlugin],
      });
      // The boot's seeding: permissions, the Public role, and its read of
      // `gated_notes`, whose read rule answers `true`.
      await seedPermissionsAndRolePresets();

      // The first user made is the super-admin.
      const made = await t.nextly.users.create({
        email: "root@visitor-gate.test",
        password: "Password123!",
        data: { name: "root", isActive: true },
      });
      const rootId = String((made.item as { id: string | number }).id);
      const roleId = (
        await new ServiceContainer(t.adapter).roles.ensureSuperAdminRole()
      ).id;
      const token = await signAccessToken(
        buildClaims({
          userId: rootId,
          email: "root@visitor-gate.test",
          name: "root",
          image: null,
          roleIds: [roleId],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET ?? ""
      );
      superAdmin = { cookie: `nextly_session=${token}` };

      // Public also holds the update a lock claim is judged as.
      const publicRole = (await t.nextly.roles.find({ limit: 100 })).items.find(
        found => found.slug === PUBLIC_ROLE_SLUG
      );
      if (!publicRole) throw new Error("boot seeding made no Public role");
      const publicId = String(publicRole.id);
      const held = await t.nextly.roles.getPermissions({ id: publicId });
      const update = (await t.nextly.permissions.find({ limit: 1000 })).items
        .filter(permission => permission.slug === `update-${NOTES}`)
        .map(permission => String(permission.id));
      await t.nextly.roles.setPermissions({
        roleId: publicId,
        permissionIds: [...held.map(p => String(p.id)), ...update],
      });

      const entry = await t.nextly.create({
        collection: NOTES,
        data: { title: "probe" },
      });
      ref = {
        scopeKind: "collection",
        slug: NOTES,
        entryId: String((entry.item as { id: string | number }).id),
      };
    });

    afterAll(async () => {
      await t?.destroy();
    });

    it("holds, for the Public role, every permission the requests below name", async () => {
      // The precondition that makes each 401 the sign-in gate's: a door that
      // judged a visitor by the Public role would let it through.
      const publicRole = (await t.nextly.roles.find({ limit: 100 })).items.find(
        found => found.slug === PUBLIC_ROLE_SLUG
      );
      const slugs = (
        await t.nextly.roles.getPermissions({ id: String(publicRole?.id) })
      ).map(permission => permission.slug);
      expect(slugs).toEqual(
        expect.arrayContaining([`read-${NOTES}`, `update-${NOTES}`])
      );
    });

    describe("a plugin route that is not public", () => {
      const segments = ["plugins", PLUGIN, "gate"];

      it("answers a super-admin's session", async () => {
        const res = await request("GET", segments, superAdmin);
        expect(res.status).toBe(200);
      });

      it("refuses a visitor 401, asking for a credential", async () => {
        const refusal = await refusalOf(
          await request("GET", segments, VISITOR)
        );
        expect(refusal).toMatchObject({ status: 401, code: "AUTH_REQUIRED" });
      });
    });

    describe("the schema builder's collection list", () => {
      it("lists the collection to a super-admin's session", async () => {
        const res = await schemaList(superAdmin);
        expect(res.status).toBe(200);
        const body = (await res.json()) as { items: { slug: string }[] };
        expect(body.items.map(item => item.slug)).toContain(NOTES);
      });

      it("refuses a visitor 401, asking for a credential", async () => {
        const refusal = await refusalOf(await schemaList(VISITOR));
        expect(refusal).toMatchObject({ status: 401, code: "AUTH_REQUIRED" });
      });
    });

    describe("a document lock claim", () => {
      it("is acquired by a super-admin's session", async () => {
        const res = await request("POST", ["document-lock"], superAdmin, ref);
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          item?: { status?: unknown; claimToken?: unknown };
        };
        expect(body.item?.status).toBe("acquired");
        // Given back, so the visitor's claim below meets an unheld lock.
        const claimToken = body.item?.claimToken;
        if (typeof claimToken !== "string") {
          throw new Error("an acquired claim carried no token");
        }
        await container
          .get<DocumentLockService>("documentLockService")
          .release(ref, claimToken);
      });

      it("refuses a visitor 401, asking for a credential", async () => {
        const refusal = await refusalOf(
          await request("POST", ["document-lock"], VISITOR, ref)
        );
        expect(refusal).toMatchObject({ status: 401, code: "AUTH_REQUIRED" });
      });
    });
  }
);
