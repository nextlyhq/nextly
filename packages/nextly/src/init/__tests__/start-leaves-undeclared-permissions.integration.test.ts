/**
 * A start never marks a permission orphaned, in production or in development, on every dialect
 * this process can reach.
 *
 * A first start declares a plugin's permission and an app permission and seeds both. The next
 * start runs a build that declares neither: the plugin is gone from the configuration and the app
 * no longer lists its permission. That start still seeds (its system and entity permissions, the
 * presets), and leaves both permissions as they were: live, with the owner they had. A permission
 * leaves only through `nextly migrate`, when the recorded migration that drops it applies.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, describe, expect, it, vi } from "vitest";

import { definePlugin } from "../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import { _resetEnvCache } from "../../shared/lib/env";
import { seedPermissionsAndRolePresets } from "../seed-permissions";

/**
 * Disabled, so a production start does not ask for its install record; a
 * disabled plugin's permissions are seeded as an enabled one's are.
 */
const PLUGIN = definePlugin({
  name: "@test/slu-forms",
  version: "1.0.0",
  nextly: ">=0.0.0",
  enabled: false,
  contributes: {
    permissions: [{ action: "export", resource: "slu-submissions" }],
  },
});

/** The app's own permission, as `permissions` in the config declares it. */
const APP_PERMISSION = { action: "audit", resource: "slu-reports" };

const MODES = ["production", "development"] as const;

const cases = getConfiguredTestDialects().flatMap(dialect =>
  MODES.map(mode => [dialect, mode] as const)
);

describe.each(cases)(
  "a start leaves an undeclared permission unorphaned (%s, %s)",
  (dialect: TestDialect, mode: (typeof MODES)[number]) => {
    let handle: TestNextly | undefined;

    afterEach(async () => {
      await handle?.destroy();
      handle = undefined;
      vi.unstubAllEnvs();
      _resetEnvCache();
    });

    /** The permission's row, as stored. */
    async function row(
      booted: TestNextly,
      permission: { action: string; resource: string }
    ): Promise<{ owner: string | null; orphaned: boolean }> {
      const rows = await (booted.adapter as unknown as DrizzleAdapter).select<{
        owner: unknown;
        orphanedAt: unknown;
      }>("permissions", {
        where: {
          and: [
            { column: "action", op: "=", value: permission.action },
            { column: "resource", op: "=", value: permission.resource },
          ],
        },
      });
      expect(rows).toHaveLength(1);
      return {
        owner: rows[0].owner == null ? null : String(rows[0].owner),
        orphaned: rows[0].orphanedAt != null,
      };
    }

    it("for a plugin's permission and an app permission the build no longer declares", async () => {
      vi.stubEnv("NODE_ENV", mode);
      // A production start validates its secret and its address before it
      // opens the database.
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
      vi.stubEnv(
        "NEXTLY_SECRET",
        process.env.NEXTLY_SECRET ??
          "test-secret-must-be-at-least-32-characters-long!!"
      );
      _resetEnvCache();
      handle = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        plugins: [PLUGIN],
      });
      const config = handle.getService("config");
      config.permissions = [APP_PERMISSION];

      // The first start declares both and seeds them: the control that the
      // start's seeding reaches these rows at all.
      await seedPermissionsAndRolePresets();
      expect(await row(handle, PLUGIN.contributes!.permissions![0])).toEqual({
        owner: "@test/slu-forms",
        orphaned: false,
      });
      expect(await row(handle, APP_PERMISSION)).toEqual({
        owner: "app",
        orphaned: false,
      });

      // The next start runs a build that declares neither.
      config.plugins?.splice(0);
      config.permissions = [];
      await seedPermissionsAndRolePresets();

      expect(await row(handle, PLUGIN.contributes!.permissions![0])).toEqual({
        owner: "@test/slu-forms",
        orphaned: false,
      });
      expect(await row(handle, APP_PERMISSION)).toEqual({
        owner: "app",
        orphaned: false,
      });
    }, 120_000);
  }
);
