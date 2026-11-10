/**
 * `nextly setup-token --dry-run` asks what the real command asks, with no
 * setup claim taken, and changes nothing in the install's store, on every
 * dialect: on an install without an administrator it names the replacement
 * and prints no token; once an administrator exists it names the real run's
 * refusal. The real command then does store a token, which shows the fixture
 * reaches the write the dry run skips.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, describe, expect, it } from "vitest";

import {
  SETUP_TOKEN_META_KEY,
  type SetupTokenMeta,
} from "../../../auth/setup-token/setup-token";
import { getDialectTables } from "../../../database/index";
import { generateSqliteCoreTableStatements } from "../../../database/sqlite-core-tables";
import type { MetaService } from "../../../domains/meta/services/meta-service";
import { superAdminRoleHeld } from "../../../domains/users/services/last-super-admin";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createFirstAdministrator, firstAdminSetupFor } from "../create-admin";
import { previewSetupToken, setupTokenCommand } from "../setup-token";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe.each(getConfiguredTestDialects())(
  "nextly setup-token --dry-run (%s)",
  (dialect: TestDialect) => {
    async function emptyInstall(): Promise<TestNextly> {
      current = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      if (dialect === "sqlite") {
        for (const statement of generateSqliteCoreTableStatements()) {
          await current.adapter.executeQuery(statement);
        }
      }
      return current;
    }

    const meta = (t: TestNextly) => t.getService("metaService") as MetaService;
    const hasAdministrator = (t: TestNextly) => () =>
      superAdminRoleHeld(
        t.adapter.getDrizzle() as unknown as Parameters<
          typeof superAdminRoleHeld
        >[0],
        getDialectTables()
      );

    it("names the replacement, prints no token, and stores none", async () => {
      const t = await emptyInstall();
      const before = await meta(t).getEntry(SETUP_TOKEN_META_KEY);

      const plan = await previewSetupToken({
        hasAdministrator: hasAdministrator(t),
        env: {},
      });

      expect(plan.refusals ?? []).toEqual([]);
      expect(plan.changes).toHaveLength(1);
      expect(JSON.stringify(plan)).not.toMatch(/NEXTLY_SETUP_TOKEN=/);
      expect(await meta(t).getEntry(SETUP_TOKEN_META_KEY)).toEqual(before);

      // The real command stores one.
      const real = await setupTokenCommand({
        generate: false,
        meta: meta(t) as unknown as SetupTokenMeta,
        hasAdministrator: hasAdministrator(t),
        env: {},
      });
      expect(real.ok).toBe(true);
      expect(await meta(t).getEntry(SETUP_TOKEN_META_KEY)).not.toEqual(before);
    });

    it("names the refusal once the install has an administrator", async () => {
      const t = await emptyInstall();
      await createFirstAdministrator(
        firstAdminSetupFor(
          t.adapter as unknown as DrizzleAdapter,
          meta(t) as unknown as SetupTokenMeta
        ),
        {
          email: "ada@example.com",
          name: "Ada",
          password: "Correct-Horse-Battery-9",
        }
      );

      const plan = await previewSetupToken({
        hasAdministrator: hasAdministrator(t),
        env: {},
      });

      expect(plan.changes).toEqual([]);
      expect(plan.refusals?.length).toBe(1);
    });
  }
);
