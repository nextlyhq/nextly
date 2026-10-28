/**
 * A plugin gate that asks for a retired `manage-` permission.
 *
 * `manage-<resource>` on media, settings, email providers and email templates
 * is retired: `nextly upgrade` gives each role holding one the plain read,
 * create, update and delete there instead. A plugin written before that may
 * still ask for it, by a route's `requiredPermission` or by
 * `ctx.caller.can("manage", resource)`. Either is answered by the plain four:
 * a caller holding all four passes, and one holding three of them does not.
 * Nor does a role not yet converted, still holding only the retired
 * permission: it counts for nothing until `nextly upgrade` has stored the
 * plain four in its place. Each plugin asking it is told once which
 * permission to ask instead.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  plantRetiredManagePermissions,
  plantRole,
} from "../../../domains/auth/__tests__/retired-manage-rows";
import { seedPermissionsAndRolePresets } from "../../../init/seed-permissions";
import { setNextlyLogger } from "../../../observability/logger";
import { createDynamicHandlers } from "../../../routeHandler";
import { ServiceContainer } from "../../../services/index";
import { definePlugin } from "../../plugin-context";
import { createTestNextly, type TestNextly } from "../../test-nextly";
import type { PluginRoute } from "../route-types";

// Two plugins, one asking by `requiredPermission` and one by `can()`, so
// each way of asking is seen to warn on its own.
const GATE_PLUGIN = "@test/manage-gate";
const CAN_PLUGIN = "@test/manage-can";
const RETIRED = [
  "media",
  "settings",
  "email-providers",
  "email-templates",
] as const;

const gateAsker = definePlugin({
  name: GATE_PLUGIN,
  version: "1.0.0",
  nextly: ">=0.0.1",
  contributes: {
    routes: RETIRED.map(
      (resource): PluginRoute => ({
        method: "POST",
        path: `/${resource}`,
        requiredPermission: `manage-${resource}`,
        handler: () => Response.json({ reached: true }),
      })
    ),
  },
});

const canAsker = definePlugin({
  name: CAN_PLUGIN,
  version: "1.0.0",
  nextly: ">=0.0.1",
  contributes: {
    routes: RETIRED.map(
      (resource): PluginRoute => ({
        method: "POST",
        path: `/${resource}`,
        handler: async (_req, ctx) =>
          Response.json({ may: await ctx.caller!.can("manage", resource) }),
      })
    ),
  },
});

function post(plugin: string, sub: string, key: string): Promise<Response> {
  const params = ["plugins", ...plugin.split("/"), sub];
  return createDynamicHandlers().POST(
    new Request(`http://localhost/api/plugins/${plugin}/${sub}`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}` },
    }),
    { params: Promise.resolve({ params }) }
  );
}

describe("a plugin gate asking for a retired manage permission", () => {
  let t: TestNextly;
  let ownerId: string;
  const warned: string[] = [];

  /** A role-based key whose role holds exactly `slugs`, stored as given. */
  async function keyHolding(slugs: string[]): Promise<string> {
    const services = new ServiceContainer(t.adapter);
    const { data } = await services.permissions.listPermissions({
      limit: 1000,
    });
    const ids = new Map(data.map(p => [`${p.action}-${p.resource}`, p.id]));
    // Stored through the adapter, as an earlier release stored a role, since
    // every writer now stores a retired permission as the plain four.
    const roleId = await plantRole(
      t.adapter,
      `holder-${randomUUID()}`,
      slugs.map(slug => String(ids.get(slug)))
    );
    const apiKeys = t.getService("apiKeyService") as unknown as {
      createApiKey: (
        userId: string,
        input: {
          name: string;
          tokenType: string;
          roleId?: string;
          expiresIn: string;
        }
      ) => Promise<{ key: string }>;
    };
    const { key } = await apiKeys.createApiKey(ownerId, {
      name: `key ${roleId}`,
      tokenType: "role-based",
      roleId,
      expiresIn: "never",
    });
    return key;
  }

  beforeAll(async () => {
    t = await createTestNextly({
      collections: [],
      plugins: [gateAsker, canAsker],
    });
    await seedPermissionsAndRolePresets();
    // An install upgraded from a release that seeded the retired ones.
    await plantRetiredManagePermissions(t.adapter);
    // The first user made is the super-admin, who may mint any key.
    const owner = await t.nextly.users.create({
      email: "owner@manage-asker.test",
      password: "Password123!",
      data: { name: "Owner", isActive: true },
    });
    ownerId = String((owner.item as { id: string | number }).id);
    setNextlyLogger({
      error: () => undefined,
      warn: payload =>
        warned.push(
          typeof payload === "string" ? payload : JSON.stringify(payload)
        ),
      info: () => undefined,
      debug: () => undefined,
    });
  });

  afterAll(async () => {
    setNextlyLogger(undefined);
    await t?.destroy();
  });

  describe.each(RETIRED)("on %s", resource => {
    const plain = ["read", "create", "update", "delete"].map(
      action => `${action}-${resource}`
    );

    it("lets through a caller holding the plain four, at the route and by can()", async () => {
      const key = await keyHolding(plain);
      expect((await post(GATE_PLUGIN, resource, key)).status).toBe(200);
      expect(await (await post(CAN_PLUGIN, resource, key)).json()).toEqual({
        may: true,
      });
    });

    it("refuses a caller holding three of them, at the route and by can()", async () => {
      const key = await keyHolding(plain.slice(0, 3));
      expect((await post(GATE_PLUGIN, resource, key)).status).toBe(403);
      expect(await (await post(CAN_PLUGIN, resource, key)).json()).toEqual({
        may: false,
      });
    });

    it("refuses a role not yet converted, holding only the retired permission", async () => {
      const key = await keyHolding([`manage-${resource}`]);
      expect((await post(GATE_PLUGIN, resource, key)).status).toBe(403);
      expect(await (await post(CAN_PLUGIN, resource, key)).json()).toEqual({
        may: false,
      });
    });

    it.each([GATE_PLUGIN, CAN_PLUGIN])(
      "tells %s once which permission to ask instead",
      plugin => {
        const told = warned.filter(
          line =>
            line.includes(`"plugin":"${plugin}"`) &&
            line.includes(`"manage-${resource}"`)
        );
        expect(told).toHaveLength(1);
      }
    );
  });
});
