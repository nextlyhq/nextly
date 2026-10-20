// The setup token against a real database: two instances starting at once
// against one empty install print one token between them, and setups racing
// with that token leave exactly one administrator.

import { afterEach, describe, expect, it } from "vitest";

import { generateSqliteCoreTableStatements } from "../../../database/sqlite-core-tables";
import { ServiceContainer } from "../../../services/index";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { buildAuthRouterDeps } from "../../handlers/deps-bridge";
import { handleSetup } from "../../handlers/setup";
import {
  ensureSetupTokenAtBoot,
  readSetupTokenRecord,
  verifySetupToken,
  type SetupTokenMeta,
} from "../setup-token";

const ORIGIN = "http://localhost:3000";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
  if (dialect === "sqlite") {
    for (const statement of generateSqliteCoreTableStatements()) {
      await current.adapter.executeQuery(statement);
    }
  }
  return current;
}

function setupRequest(email: string, setupToken: string): Request {
  return new Request(`${ORIGIN}/admin/api/auth/setup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
      cookie: "nextly_csrf=tok",
    },
    body: JSON.stringify({
      csrfToken: "tok",
      email,
      name: "Owner",
      password: "Str0ng-P@ssw0rd!",
      setupToken,
    }),
  });
}

describe.each(getConfiguredTestDialects())(
  "the setup token (%s)",
  (dialect: TestDialect) => {
    it("is printed once between two instances starting at once against one empty install", async () => {
      const t = await boot(dialect);
      const meta = t.getService("metaService") as unknown as SetupTokenMeta;
      const deps = buildAuthRouterDeps(
        t.getService as unknown as (name: string) => unknown
      );
      const starts = await Promise.all(
        [1, 2].map(() =>
          ensureSetupTokenAtBoot({
            meta,
            hasAdministrator: deps.hasAdministrator,
            env: {},
          })
        )
      );
      const printed = starts.filter(s => s.kind === "printed");
      expect(printed).toHaveLength(1);
      expect(starts.filter(s => s.kind === "already-issued")).toHaveLength(1);
      const token = /TOKEN (\S+) /.exec(
        printed[0].kind === "printed" ? printed[0].line : ""
      )?.[1];
      expect(
        await verifySetupToken({
          presented: token,
          readRecord: () => readSetupTokenRecord(meta),
          env: {},
        })
      ).toBe("valid");
    });

    it("creates exactly one administrator when setups with the token race", async () => {
      const t = await boot(dialect);
      const meta = t.getService("metaService") as unknown as SetupTokenMeta;
      const bridged = buildAuthRouterDeps(
        t.getService as unknown as (name: string) => unknown
      );
      // Production's gate, through the real token store and claim.
      const deps = {
        ...bridged,
        setupToken: { ...bridged.setupToken, required: true },
      };
      const start = await ensureSetupTokenAtBoot({
        meta,
        hasAdministrator: deps.hasAdministrator,
        env: {},
      });
      const token =
        /TOKEN (\S+) /.exec(start.kind === "printed" ? start.line : "")?.[1] ??
        "";

      const responses = await Promise.all(
        ["one@example.com", "two@example.com", "three@example.com"].map(email =>
          handleSetup(setupRequest(email, token), deps)
        )
      );
      expect(responses.map(r => r.status).sort()).toEqual([201, 403, 403]);

      const services = new ServiceContainer(t.adapter);
      const { id: superAdmin } = await services.roles.ensureSuperAdminRole();
      const winner = (await responses.find(r => r.status === 201)?.json()) as {
        user: { id: string };
      };
      expect(
        await services.userRoles.listUserRoles(String(winner.user.id))
      ).toContain(superAdmin);
      expect(await deps.hasAdministrator()).toBe(true);
      // Spent with the administrator's creation.
      expect(await readSetupTokenRecord(meta)).toBeNull();
    });
  }
);
