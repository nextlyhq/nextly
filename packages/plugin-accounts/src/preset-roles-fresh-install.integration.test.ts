/**
 * The preset roles on a new site with accounts, on every dialect configured.
 * The plugin keeps people's accounts in tables of its own, not in a
 * collection, so nothing it contributes is a collection a preset role could
 * be opened to: Editor and Author hold nothing on accounts, and the plugin's
 * two permissions stay as the plugin declares them, reached only through the
 * roles a site grants them to and the presets' own rules.
 *
 * @module preset-roles-fresh-install.integration.test
 */
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { ServiceContainer } from "nextly";
import { afterEach, describe, expect, it } from "vitest";

import { STAFF_PERMISSIONS } from "./http/staff";
import { accounts } from "./plugin";
import { TEST_ORIGIN } from "./test-support/boot";

describe.each(getConfiguredTestDialects())(
  "the preset roles on a new site with accounts (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    it("opens no accounts collection to a preset role, and leaves Editor and Author without accounts", async () => {
      const plugin = accounts({ origin: TEST_ORIGIN });
      expect(plugin.contributes?.collections ?? []).toEqual([]);
      // Declared without `presets`: the presets' own rules decide, as before.
      expect(STAFF_PERMISSIONS.map(p => p.presets)).toEqual([
        undefined,
        undefined,
      ]);

      current = await createTestNextly({
        dialect,
        plugins: [plugin],
        seedPublic: true,
      });
      const services = new ServiceContainer(current.adapter);
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
      for (const preset of ["editor", "author"]) {
        const role = await services.roles.findRoleIdBySlug(preset);
        if (!role) throw new Error(`the ${preset} preset was not seeded`);
        const held = await services.rolePermissions.listRolePermissions(
          String(role.id)
        );
        expect({
          preset,
          held: held.filter(p => p.resource === resource),
        }).toEqual({ preset, held: [] });
      }
    });
  }
);
