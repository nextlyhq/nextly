/**
 * The admin's routes as staff reach them, through core's request handler
 * with a real API key per role: each refused without its permission, no
 * answer carrying a secret, and each action on the audit record, on each
 * dialect.
 *
 * @module http/staff.integration.test
 */

// Read once, when the harness validates its environment; API keys are
// signed with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { STAFF_ACTIONS, type StaffAction } from "../admin-contract";
import { accountsLimitRules } from "../core/limit-rules";
import { signIn } from "../flows/sign-in";
import { accounts, sessions } from "../schema/tables";
import { resolveAccountsSettings } from "../settings";
import { accountById, writeAtVersion } from "../storage/accounts";
import { makeAccount, TEST_PASSWORD } from "../test-support/accounts";
import { bootAccounts, TEST_ORIGIN } from "../test-support/boot";
import { flowDeps } from "../test-support/flow-deps";
import { fakeAccountsCore } from "../testing";

import { STAFF_PERMISSIONS } from "./staff";

const PREFIX = ["plugins", "@nextlyhq", "plugin-accounts", "staff"];
const ADDRESS = "dana@example.com";

/** The Direct API calls the test makes staff with, as far as it uses them. */
interface StaffDirectApi {
  users: {
    create(args: {
      data: Record<string, unknown>;
    }): Promise<{ item: { id: string } }>;
  };
  permissions: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
    find(args: {
      limit: number;
    }): Promise<{ items: { id: string; slug: string }[] }>;
  };
  roles: {
    create(args: {
      data: Record<string, unknown>;
    }): Promise<{ item: { id: string } }>;
  };
}

interface ApiKeys {
  createApiKey(
    userId: string,
    input: {
      name: string;
      tokenType: string;
      roleId?: string;
      expiresIn: string;
    }
  ): Promise<{ key: string }>;
}

/** An audit row, as the adapter reads it back. */
interface AuditRow {
  kind: string;
  actorUserId: string | null;
  targetUserId: string | null;
  targetPrincipalKind: string | null;
  targetPrincipalId: string | null;
  metadata: unknown;
}

describe.each(getConfiguredTestDialects())(
  "the admin's routes (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot() {
      // The running plugin reads real time, so the flows' clock starts there too.
      const core = fakeAccountsCore({
        start: new Date(),
        rules: accountsLimitRules(
          resolveAccountsSettings({ origin: TEST_ORIGIN })
        ),
      });
      const booted = await bootAccounts(dialect, { core });
      current = booted.nextly;
      const { deps } = flowDeps(booted.ctx, {}, core);
      const id = await makeAccount(deps, ADDRESS);
      const signedIn = await signIn(deps, {
        address: ADDRESS,
        password: TEST_PASSWORD,
        client: null,
      });
      if (signedIn.status !== "signed-in")
        throw new Error("expected a sign-in");

      const direct = booted.nextly.nextly as unknown as StaffDirectApi;
      // The first user is the super-admin every key is minted by; a key may
      // hold no more than its owner does.
      const owner = await direct.users.create({
        data: {
          email: "owner@example.com",
          password: "Password123!",
          name: "Owner",
          isActive: true,
        },
      });
      // The harness runs none of boot's seeding, so the plugin's permissions
      // are written here from its own declaration, under the slug the seeder
      // composes, `<action>-<resource>`.
      // One more, of another resource, for staff who hold neither.
      const unrelated = { action: "read", resource: "widgets" };
      for (const permission of [...STAFF_PERMISSIONS, unrelated])
        await direct.permissions.create({
          data: {
            name: `${permission.action} ${permission.resource}`,
            slug: `${permission.action}-${permission.resource}`,
            action: permission.action,
            resource: permission.resource,
          },
        });
      const seeded = await direct.permissions.find({ limit: 500 });

      /** A key whose role holds exactly the permissions named. */
      async function keyHolding(slugs: string[]): Promise<string> {
        const ids = slugs.map(slug => {
          const found = seeded.items.find(item => item.slug === slug);
          if (found === undefined)
            throw new Error(`${slug} is not seeded, so a role grants nothing`);
          return found.id;
        });
        const role = await direct.roles.create({
          data: {
            name: `Role ${slugs.join(" ")}`,
            slug: `r-${slugs.join("-")}`,
            permissionIds: ids,
          },
        });
        const keys = booted.nextly.getService(
          "apiKeyService"
        ) as unknown as ApiKeys;
        const { key } = await keys.createApiKey(owner.item.id, {
          name: `key ${slugs.join(" ")}`,
          tokenType: "role-based",
          roleId: role.item.id,
          expiresIn: "unlimited",
        });
        return key;
      }

      return {
        deps,
        id,
        ownerId: owner.item.id,
        keyHolding,
        adapter: booted.nextly.adapter,
        sessionToken: signedIn.session.token,
      };
    }

    /** Calls one of the routes through core's handler, with `key` when given. */
    async function call(
      method: "GET" | "POST",
      path: string[],
      key?: string
    ): Promise<Response> {
      const handlers = createDynamicHandlers();
      const request = new Request(
        `http://localhost/api/${[...PREFIX, ...path].join("/")}`,
        {
          method,
          headers: key === undefined ? {} : { authorization: `Bearer ${key}` },
        }
      );
      const context = {
        params: Promise.resolve({ params: [...PREFIX, ...path] }),
      };
      return method === "GET"
        ? handlers.GET(request, context)
        : handlers.POST(request, context);
    }

    const list = (key?: string) => call("GET", ["accounts"], key);
    const page = (id: string, key?: string) =>
      call("GET", ["accounts", id], key);
    const act = (action: StaffAction, id: string, key?: string) =>
      call("POST", ["accounts", id, action], key);

    async function auditRows(
      adapter: TestNextly["adapter"],
      kind: string
    ): Promise<AuditRow[]> {
      return adapter.select<AuditRow>("audit_log", {
        where: { and: [{ column: "kind", op: "=", value: kind }] },
      });
    }

    function metadataOf(row: AuditRow | undefined): Record<string, unknown> {
      const metadata = row?.metadata;
      if (typeof metadata === "string")
        return JSON.parse(metadata) as Record<string, unknown>;
      return (metadata ?? {}) as Record<string, unknown>;
    }

    it("refuses every route to a caller who is not signed in", async () => {
      const { id } = await boot();

      expect((await list()).status).toBe(401);
      expect((await page(id)).status).toBe(401);
      for (const action of STAFF_ACTIONS)
        expect((await act(action, id)).status).toBe(401);
    });

    it("refuses every route to staff without the plugin's permissions", async () => {
      const { id, keyHolding } = await boot();
      const key = await keyHolding(["read-widgets"]);

      expect((await list(key)).status).toBe(403);
      expect((await page(id, key)).status).toBe(403);
      for (const action of STAFF_ACTIONS)
        expect((await act(action, id, key)).status).toBe(403);
    });

    it("lets read-accounts read, and act on nothing", async () => {
      const { deps, id, keyHolding } = await boot();
      const key = await keyHolding(["read-accounts"]);

      const listed = await list(key);
      expect(listed.status).toBe(200);
      expect(listed.headers.get("cache-control")).toContain("no-store");
      expect(await listed.json()).toMatchObject({
        items: [{ id, address: ADDRESS }],
        meta: { page: 1, hasNext: false, hasPrev: false },
      });
      const shown = await page(id, key);
      expect(shown.status).toBe(200);
      expect(shown.headers.get("cache-control")).toContain("no-store");
      expect(await shown.json()).toMatchObject({
        account: { id, address: ADDRESS, liveSessions: 1 },
        canManage: false,
      });
      for (const action of STAFF_ACTIONS)
        expect((await act(action, id, key)).status).toBe(403);
      expect(await accountById(deps.db, id)).toMatchObject({
        deactivatedAt: null,
      });
    });

    it("lets manage-accounts act, without reading", async () => {
      const { deps, id, keyHolding } = await boot();
      const key = await keyHolding(["manage-accounts"]);

      expect((await list(key)).status).toBe(403);
      expect((await page(id, key)).status).toBe(403);
      const acted = await act("deactivate", id, key);
      expect(acted.status).toBe(200);
      expect(acted.headers.get("cache-control")).toContain("no-store");
      expect((await accountById(deps.db, id))?.deactivatedAt).toBeInstanceOf(
        Date
      );
    });

    it("tells the account's page whether its reader may act on it", async () => {
      const { id, keyHolding } = await boot();
      const key = await keyHolding(["read-accounts", "manage-accounts"]);

      expect(await (await page(id, key)).json()).toMatchObject({
        canManage: true,
      });
    });

    it("answers no route with a password hash or a token's hash", async () => {
      const { deps, id, keyHolding, sessionToken } = await boot();
      const key = await keyHolding(["read-accounts", "manage-accounts"]);
      const [row] = await deps.db.select(accounts).all();
      const [session] = await deps.db.select(sessions).all();
      const secrets = [
        row?.passwordHash ?? "",
        session?.tokenHash ?? "",
        sessionToken,
      ];
      expect(secrets.every(secret => secret.length > 0)).toBe(true);

      const bodies = [await (await list(key)).text()];
      bodies.push(await (await page(id, key)).text());
      for (const action of STAFF_ACTIONS)
        bodies.push(await (await act(action, id, key)).text());

      for (const body of bodies) {
        for (const secret of secrets) expect(body).not.toContain(secret);
        expect(body).not.toMatch(/hash|token|password"/i);
      }
    });

    it("records each action with the staff member and the account by its kind and id alone", async () => {
      const { deps, id, ownerId, keyHolding, adapter } = await boot();
      const key = await keyHolding(["manage-accounts"]);
      const kinds: Record<StaffAction, string> = {
        "end-sessions": "nextlyhq-plugin-accounts.staff.sessions-ended",
        "send-reset": "nextlyhq-plugin-accounts.staff.reset-link-sent",
        deactivate: "nextlyhq-plugin-accounts.staff.deactivated",
        reactivate: "nextlyhq-plugin-accounts.staff.reactivated",
        "resend-verification":
          "nextlyhq-plugin-accounts.staff.verification-resent",
        delete: "nextlyhq-plugin-accounts.staff.deleted",
      };
      // Each in an order the account can take it: verification is resent
      // to an unverified address.
      const order: StaffAction[] = [
        "end-sessions",
        "send-reset",
        "deactivate",
        "reactivate",
        "resend-verification",
        "delete",
      ];
      expect([...order].sort()).toEqual([...STAFF_ACTIONS].sort());

      for (const action of order) {
        if (action === "resend-verification") {
          const account = await accountById(deps.db, id);
          if (account === null) throw new Error("expected the account");
          await writeAtVersion(deps.db, account, { verifiedAt: null });
        }
        expect((await act(action, id, key)).status).toBe(200);
        const rows = await auditRows(adapter, kinds[action]);
        expect(rows).toHaveLength(1);
        // The account is the row's target person, never a staff user, and
        // the row carries nothing of it in metadata.
        expect(rows[0]).toMatchObject({
          actorUserId: ownerId,
          targetUserId: null,
          targetPrincipalKind: "nextlyhq-plugin-accounts:account",
        });
        expect(metadataOf(rows[0])).toEqual({});
        expect(JSON.stringify(rows[0])).not.toContain(ADDRESS);
        // Deleted, the account is reported to core, which writes its row
        // already erased: the target is a digest, never the id again.
        expect(rows[0]?.targetPrincipalId === id).toBe(action !== "delete");
      }

      // Every row about the account stays, and none names it any more.
      const all = await Promise.all(
        order.map(action => auditRows(adapter, kinds[action]))
      );
      expect(all.flat()).toHaveLength(order.length);
      expect(all.flat().filter(row => row.targetPrincipalId === id)).toEqual(
        []
      );
    });

    it("records nothing for an action that does not apply or an account that is not there", async () => {
      const { id, keyHolding, adapter } = await boot();
      const key = await keyHolding(["manage-accounts"]);

      const refused = await act("reactivate", id, key);
      expect(refused.status).toBe(409);
      expect(await refused.json()).toMatchObject({
        error: {
          code: "ACCOUNTS_NOT_APPLICABLE",
          data: { reason: "already-active" },
        },
      });
      expect(
        (await act("deactivate", "00000000-0000-4000-8000-000000000000", key))
          .status
      ).toBe(404);

      expect(
        await auditRows(adapter, "nextlyhq-plugin-accounts.staff.reactivated")
      ).toEqual([]);
      expect(
        await auditRows(adapter, "nextlyhq-plugin-accounts.staff.deactivated")
      ).toEqual([]);
    });
  }
);
