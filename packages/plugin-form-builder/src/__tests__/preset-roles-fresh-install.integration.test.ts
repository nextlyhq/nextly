/**
 * The preset roles on a new site with the form builder, on every dialect
 * configured: each collection the plugin contributes is open to Admin,
 * Editor, Author and Viewer, each by its own rule, as it was before new
 * collections started closed to them. An Editor reads and updates a form
 * through core's request handler, and a Viewer reads it but cannot change it.
 *
 * @module __tests__/preset-roles-fresh-install.integration.test
 */

// Read once, when the harness validates its environment; sessions are signed
// with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { ServiceContainer } from "nextly";
import { buildClaims, signAccessToken } from "nextly/auth";
import { createDynamicHandlers } from "nextly/runtime";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { formBuilder } from "../plugin";

const ORIGIN = "http://localhost";
const CSRF = "c".repeat(64);
const FORMS = "forms";

/** What each preset's rule gives it on a collection, by action. */
const RULES: Record<string, (action: string) => boolean> = {
  admin: () => true,
  editor: () => true,
  author: action =>
    !["delete", "publish", "unpublish", "manage"].includes(action),
  viewer: action => action === "read",
};

type Method = "GET" | "PATCH";

/** One request through core's handler, signed in with `cookie`. */
function rest(
  method: Method,
  path: string,
  cookie: string,
  body?: unknown
): Promise<Response> {
  const headers: Record<string, string> = {
    origin: ORIGIN,
    cookie: `${cookie}; nextly_csrf=${CSRF}`,
    "x-csrf-token": CSRF,
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  return createDynamicHandlers()[method](
    new Request(`${ORIGIN}/api/${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    { params: Promise.resolve({ params: path.split("?")[0]!.split("/") }) }
  );
}

describe.each(getConfiguredTestDialects())(
  "the preset roles on a new site with the form builder (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let services: ServiceContainer;
    let formId: string;

    /**
     * The permissions the preset `slug` holds on the collections named, as
     * `<action>-<resource>`, sorted.
     */
    async function heldOn(
      slug: string,
      collections: readonly string[]
    ): Promise<string[]> {
      const role = await services.roles.findRoleIdBySlug(slug);
      if (!role) throw new Error(`the ${slug} preset was not seeded`);
      return (
        await services.rolePermissions.listRolePermissions(String(role.id))
      )
        .filter(p => collections.includes(p.resource))
        .map(p => `${p.action}-${p.resource}`)
        .sort();
    }

    /** A signed-in person holding the preset role `preset` alone. */
    async function personWith(preset: string): Promise<string> {
      const email = `${preset}@preset-roles.test`;
      const made = await t.nextly.users.create({
        email,
        password: "Password123!",
        data: { name: preset, isActive: true },
      });
      const role = await services.roles.findRoleIdBySlug(preset);
      if (!role) throw new Error(`the ${preset} preset was not seeded`);
      const assigned = await services.userRoles.assignRoleToUser(
        made.item.id,
        String(role.id)
      );
      if (!assigned.success) throw new Error("the role was not assigned");
      const token = await signAccessToken(
        buildClaims({
          userId: made.item.id,
          email,
          name: preset,
          image: null,
          roleIds: [],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET ?? ""
      );
      return `nextly_session=${token}`;
    }

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        plugins: [formBuilder().plugin],
        seedPublic: true,
      });
      services = new ServiceContainer(t.adapter);
      // The instance's first user is its super-admin.
      await t.nextly.users.create({
        email: "owner@preset-roles.test",
        password: "Password123!",
        data: { name: "Owner", isActive: true },
      });
      formId = String(
        (
          await t.nextly.create({
            collection: FORMS,
            data: {
              name: "Contact",
              slug: "contact",
              status: "published",
              fields: [{ type: "text", name: "full_name", label: "Name" }],
            },
          })
        ).item.id
      );
    }, 180_000);

    afterAll(async () => {
      await t?.destroy();
    });

    it("opens every collection the plugin contributes to each preset, by its own rule", async () => {
      const slugs = (formBuilder().plugin.contributes?.collections ?? []).map(
        collection => collection.slug
      );
      expect(slugs).toContain(FORMS);
      const stored = (
        await services.permissions.listPermissions({ limit: 100000 })
      ).data.filter(p => p.owner == null && slugs.includes(p.resource));
      for (const [preset, rule] of Object.entries(RULES)) {
        const expected = stored
          .filter(p => rule(p.action))
          .map(p => `${p.action}-${p.resource}`)
          .sort();
        const holds = await heldOn(preset, slugs);
        expect({ preset, holds }).toEqual({ preset, holds: expected });
      }
      expect(await heldOn("editor", [FORMS])).toEqual(
        expect.arrayContaining([`read-${FORMS}`, `update-${FORMS}`])
      );
      expect(await heldOn("viewer", [FORMS])).toEqual([`read-${FORMS}`]);
    });

    it("lets an Editor read and update a form, and a Viewer read it but not change it", async () => {
      const editor = await personWith("editor");
      const viewer = await personWith("viewer");
      const entry = `collections/${FORMS}/entries/${formId}`;

      const before = await rest("GET", entry, editor);
      expect(before.status).toBe(200);
      // The update names the version it was made from, as the admin's does.
      const { _rev } = (await before.json()) as { _rev?: unknown };
      const updated = await rest("PATCH", entry, editor, {
        name: "Contact us",
        _rev,
      });
      expect(updated.status).toBe(200);
      const read = await rest("GET", entry, viewer);
      expect(read.status).toBe(200);
      expect(JSON.stringify(await read.json())).toContain("Contact us");
      expect(
        (
          await rest("PATCH", entry, viewer, {
            name: "Changed",
            _overwrite: true,
          })
        ).status
      ).toBe(403);
    });
  }
);
