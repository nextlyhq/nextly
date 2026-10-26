/**
 * A plugin may declare permissions for the Public role on its own
 * collections (`contributes.publicGrants`), so a visitor can, for example,
 * submit a form.
 *
 * Boot seeding grants each declared permission once and records it, so an
 * owner who takes it away keeps it away, and an install that already had the
 * permission before the plugin declared it is granted it once. A host's rename
 * of the collection is followed. A grant on a collection the plugin does not
 * contribute, or of an action other than read or create, is refused and
 * logged, and nothing is granted for it.
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import { seedPermissionsAndRolePresets } from "../../../init/seed-permissions";
import { definePlugin } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { ServiceContainer } from "../../../services/index";
import type { Logger } from "../../../services/shared";
import { PUBLIC_ROLE_SLUG } from "../services/public-role";

let t: TestNextly | undefined;
afterEach(async () => {
  await t?.destroy();
  t = undefined;
});

/** Every warning and error boot seeding logged, as one string each. */
let logged: { warn: string[]; error: string[] } = { warn: [], error: [] };

const logger: Logger = {
  debug() {},
  info() {},
  warn(message: unknown) {
    logged.warn.push(String(message));
  },
  error(message: unknown) {
    logged.error.push(String(message));
  },
} as Logger;

const fields = [text({ name: "title" })];

/**
 * Declared as a plugin written without types would declare it: `delete` is
 * not an action a plugin may grant.
 */
const untyped: Array<{ collection: string; action: "read" | "create" }> =
  JSON.parse('[{ "collection": "tickets", "action": "delete" }]');

/** A plugin contributing `tickets`, which visitors may create in. */
function ticketsPlugin(rename?: Record<string, string>) {
  const plugin = definePlugin({
    name: "@test/tickets",
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: {
      collections: [
        defineCollection({
          slug: "tickets",
          access: { create: true },
          fields,
        }),
      ],
      publicGrants: [
        { collection: "tickets", action: "create" },
        // The host's collection, which this plugin does not contribute.
        { collection: "posts", action: "read" },
        ...untyped,
      ],
    },
  });
  return rename && plugin.rename ? plugin.rename(rename) : plugin;
}

async function boot(
  dialect: TestDialect,
  rename?: Record<string, string>
): Promise<TestNextly> {
  logged = { warn: [], error: [] };
  t = await createTestNextly({
    ...(dialect === "sqlite" ? {} : { dialect }),
    logger,
    collections: [defineCollection({ slug: "posts", fields })],
    plugins: [ticketsPlugin(rename)],
  });
  return t;
}

const services = (nextly: TestNextly) => new ServiceContainer(nextly.adapter);

async function publicRoleId(nextly: TestNextly): Promise<string> {
  const found = await services(nextly).roles.findRoleIdBySlug(PUBLIC_ROLE_SLUG);
  if (!found) throw new Error("no Public role");
  return found.id;
}

/** The permission slugs the Public role holds directly. */
async function publicHolds(nextly: TestNextly): Promise<string[]> {
  const held = await services(nextly).rolePermissions.listRolePermissions(
    await publicRoleId(nextly)
  );
  return held.map(p => `${p.action}-${p.resource}`).sort();
}

/** Takes `permission` off the Public role, as an owner would. */
async function takeAway(nextly: TestNextly, permission: string) {
  const id = await publicRoleId(nextly);
  const held = await services(nextly).rolePermissions.listRolePermissions(id);
  await services(nextly).roles.updateRole(id, {
    permissionIds: held
      .filter(p => `${p.action}-${p.resource}` !== permission)
      .map(p => p.id),
  });
}

describe.each(getConfiguredTestDialects())(
  "the Public role's grants a plugin declares (%s)",
  dialect => {
    it("grants what a plugin declares on its own collection, and nothing else", async () => {
      const nextly = await boot(dialect);
      await seedPermissionsAndRolePresets();

      const held = await publicHolds(nextly);
      expect(held).toContain("create-tickets");
      expect(held).not.toContain("read-posts");
      expect(held).not.toContain("delete-tickets");
      // Both refusals are named, with the plugin that declared them.
      const refused = logged.error.filter(m => m.includes("@test/tickets"));
      expect(refused).toHaveLength(2);
      expect(refused.join("\n")).toMatch(/read "posts"/);
      expect(refused.join("\n")).toMatch(/delete "tickets"/);
      // What Public now holds is no longer listed as missing.
      expect(logged.warn.join("\n")).not.toContain("create-tickets");
    });

    it("does not grant back what an owner took away", async () => {
      const nextly = await boot(dialect);
      await seedPermissionsAndRolePresets();
      await takeAway(nextly, "create-tickets");

      await seedPermissionsAndRolePresets();

      expect(await publicHolds(nextly)).not.toContain("create-tickets");
    });

    it("grants it once on an install that had the permission before", async () => {
      const nextly = await boot(dialect);
      await seedPermissionsAndRolePresets();
      // An install from before the plugin declared it: the permission exists,
      // Public does not hold it, and nothing records a grant.
      await takeAway(nextly, "create-tickets");
      const {
        data: [permission],
      } = await services(nextly).permissions.listPermissions({
        action: "create",
        resource: "tickets",
      });
      const meta = nextly.getService("metaService");
      const recorded = (await meta.get<string[]>("public-role-granted")) ?? [];
      await meta.set(
        "public-role-granted",
        recorded.filter(id => id !== String(permission.id))
      );

      await seedPermissionsAndRolePresets();
      expect(await publicHolds(nextly)).toContain("create-tickets");

      await takeAway(nextly, "create-tickets");
      await seedPermissionsAndRolePresets();
      expect(await publicHolds(nextly)).not.toContain("create-tickets");
    });

    it("follows a host's rename of the collection", async () => {
      const nextly = await boot(dialect, { tickets: "issues" });
      await seedPermissionsAndRolePresets();

      const held = await publicHolds(nextly);
      expect(held).toContain("create-issues");
      expect(held).not.toContain("create-tickets");
    });
  }
);
