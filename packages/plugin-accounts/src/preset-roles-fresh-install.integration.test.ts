/**
 * The preset roles on a new site with accounts, on every dialect configured.
 * The plugin keeps people's accounts in tables of its own, not in a
 * collection, so nothing it contributes is a collection a preset role could
 * be opened to. Its two permissions are declared for Admin alone: Admin holds
 * both, Editor, Author and Viewer hold neither, and a Viewer is refused the
 * staff list of accounts an Admin reads.
 *
 * @module preset-roles-fresh-install.integration.test
 */

// Read once, when the harness validates its environment; API keys are
// signed with it.
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
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { STAFF_PERMISSIONS } from "./http/staff";
import { accounts } from "./plugin";
import { TEST_ORIGIN } from "./test-support/boot";

const PRESETS = ["admin", "editor", "author", "viewer"] as const;

/** The staff list of accounts, as core's handler routes it. */
const LIST = ["plugins", "@nextlyhq", "plugin-accounts", "staff", "accounts"];

/** The Direct API call the test makes staff with, as far as it uses it. */
interface StaffDirectApi {
  users: {
    create(args: {
      data: Record<string, unknown>;
    }): Promise<{ item: { id: string } }>;
  };
}

interface ApiKeys {
  createApiKey(
    userId: string,
    input: { name: string; tokenType: string; expiresIn: string }
  ): Promise<{ key: string }>;
}

describe.each(getConfiguredTestDialects())(
  "the preset roles on a new site with accounts (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot() {
      const plugin = accounts({ origin: TEST_ORIGIN });
      current = await createTestNextly({
        dialect,
        plugins: [plugin],
        seedPublic: true,
      });
      return { plugin, nextly: current };
    }

    /**
     * A staff member who holds the preset `preset` and nothing else, and a
     * key that acts as them. The first user made is the super-admin, so one
     * is made before any staff member.
     */
    async function staffHolding(
      nextly: TestNextly,
      preset: (typeof PRESETS)[number]
    ): Promise<string> {
      const direct = nextly.nextly as unknown as StaffDirectApi;
      const services = new ServiceContainer(nextly.adapter);
      const person = await direct.users.create({
        data: {
          email: `${preset}@example.com`,
          password: "Password123!",
          name: preset,
          isActive: true,
        },
      });
      const role = await services.roles.findRoleIdBySlug(preset);
      if (!role) throw new Error(`the ${preset} preset was not seeded`);
      const assigned = await services.userRoles.assignRoleToUser(
        person.item.id,
        String(role.id)
      );
      if (!assigned.success) throw new Error(assigned.message);
      const keys = nextly.getService("apiKeyService") as unknown as ApiKeys;
      // A full-access key holds what the person who made it holds.
      const { key } = await keys.createApiKey(person.item.id, {
        name: `${preset} key`,
        tokenType: "full-access",
        expiresIn: "unlimited",
      });
      return key;
    }

    /** The staff list of accounts, called through core's handler with `key`. */
    async function list(key: string): Promise<Response> {
      const handlers = createDynamicHandlers();
      return handlers.GET(
        new Request(`http://localhost/api/${LIST.join("/")}`, {
          headers: { authorization: `Bearer ${key}` },
        }),
        { params: Promise.resolve({ params: LIST }) }
      );
    }

    it("gives the accounts permissions to Admin alone of the presets, and no accounts collection to any", async () => {
      const { plugin, nextly } = await boot();
      expect(plugin.contributes?.collections ?? []).toEqual([]);

      const services = new ServiceContainer(nextly.adapter);
      // Every stored permission on accounts is one the plugin owns: none is a
      // collection's, which a preset role could be opened to.
      const resource = STAFF_PERMISSIONS[0]!.resource;
      const stored = (
        await services.permissions.listPermissions({ limit: 100000 })
      ).data.filter(p => p.resource === resource);
      expect(stored.map(p => `${p.action}-${p.resource}`).sort()).toEqual([
        `manage-${resource}`,
        `read-${resource}`,
      ]);
      expect(stored.every(p => p.owner === plugin.name)).toBe(true);

      for (const preset of PRESETS) {
        const role = await services.roles.findRoleIdBySlug(preset);
        if (!role) throw new Error(`the ${preset} preset was not seeded`);
        const held = (
          await services.rolePermissions.listRolePermissions(String(role.id))
        )
          .filter(p => p.resource === resource)
          .map(p => `${p.action}-${p.resource}`)
          .sort();
        expect({ preset, held }).toEqual({
          preset,
          held:
            preset === "admin"
              ? [`manage-${resource}`, `read-${resource}`]
              : [],
        });
      }
    });

    it("refuses a Viewer the staff list of accounts, and lets an Admin read it", async () => {
      const { nextly } = await boot();
      const direct = nextly.nextly as unknown as StaffDirectApi;
      await direct.users.create({
        data: {
          email: "owner@example.com",
          password: "Password123!",
          name: "Owner",
          isActive: true,
        },
      });

      const viewer = await staffHolding(nextly, "viewer");
      const admin = await staffHolding(nextly, "admin");

      expect((await list(viewer)).status).toBe(403);
      const listed = await list(admin);
      expect(listed.status).toBe(200);
      expect(await listed.json()).toMatchObject({ items: [] });
    });
  }
);
