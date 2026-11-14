/**
 * A plugin route that declares nothing is refused for every caller.
 *
 * A route declaring neither `requiredPermission`, `public`, `principal` nor
 * `siteWide: false` asked only that its caller be signed in, so a role-less
 * account or an API key with no grants could reach a handler that acts on
 * the whole site. It is now refused at the door for everyone, the install's
 * super admin included, and its handler never runs. A route declaring
 * `siteWide: false` still admits any signed-in caller: the control that the
 * refusal is about the missing declaration, not about who calls.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { createDynamicHandlers } from "../../../routeHandler";
import type { AuthUser } from "../../../types/auth";
import { definePlugin } from "../../plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../test-nextly";

const PLUGIN = "@test/undeclared-route";

/** How many times each handler ran. */
const reached = { undeclared: 0, own: 0 };

const plugin = definePlugin({
  name: PLUGIN,
  version: "1.0.0",
  nextly: ">=0.0.1",
  contributes: {
    routes: [
      {
        method: "GET",
        path: "/undeclared",
        handler: () => {
          reached.undeclared++;
          return Response.json({ reached: true });
        },
      },
      {
        method: "GET",
        path: "/own",
        siteWide: false,
        handler: () => {
          reached.own++;
          return Response.json({ reached: true });
        },
      },
    ],
  },
});

function get(
  sub: "undeclared" | "own",
  headers: Record<string, string> = {}
): Promise<Response> {
  const handlers = createDynamicHandlers();
  return handlers.GET(
    new Request(`http://localhost/api/plugins/${PLUGIN}/${sub}`, {
      headers,
    }),
    {
      params: Promise.resolve({
        params: ["plugins", ...PLUGIN.split("/"), sub],
      }),
    }
  );
}

describe.each(getConfiguredTestDialects())(
  "a plugin route that declares nothing (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly | undefined;

    afterEach(async () => {
      await t?.destroy();
      t = undefined;
      reached.undeclared = 0;
      reached.own = 0;
    });

    async function person(name: string): Promise<AuthUser> {
      const email = `${name}-${String(Date.now())}@example.com`;
      const made = await t!.nextly.users.create({
        email,
        password: "Password123!",
        data: { name, isActive: true },
      });
      return { id: String(made.item.id) as AuthUser["id"], email, name };
    }

    async function sessionOf(user: AuthUser): Promise<Record<string, string>> {
      const token = await signAccessToken(
        buildClaims({
          userId: user.id,
          email: user.email,
          name: user.name ?? "",
          image: null,
          roleIds: [],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET ?? ""
      );
      return { cookie: `nextly_session=${token}` };
    }

    async function fullAccessKey(owner: AuthUser): Promise<string> {
      const apiKeys = t!.getService("apiKeyService") as unknown as {
        createApiKey: (
          userId: string,
          input: { name: string; tokenType: string; expiresIn: string }
        ) => Promise<{ key: string }>;
      };
      const { key } = await apiKeys.createApiKey(owner.id, {
        name: "full access",
        tokenType: "full-access",
        expiresIn: "never",
      });
      return key;
    }

    it("is refused for the super admin, a role-less account and a key, and its handler never runs", async () => {
      t = await createTestNextly({ dialect, plugins: [plugin] });
      // The install's first user is its super admin.
      const owner = await person("owner");
      const roleless = await person("roleless");
      const key = await fullAccessKey(owner);

      for (const headers of [
        await sessionOf(owner),
        await sessionOf(roleless),
        { authorization: `Bearer ${key}` },
      ]) {
        const res = await get("undeclared", headers);
        expect(res.status).toBe(403);
      }
      expect((await get("undeclared")).status).toBe(403);
      expect(reached.undeclared).toBe(0);
    });

    it("admits any signed-in caller to a route that declares siteWide: false", async () => {
      t = await createTestNextly({ dialect, plugins: [plugin] });
      await person("owner");
      const roleless = await person("roleless");
      const res = await get("own", await sessionOf(roleless));
      expect(res.status).toBe(200);
      expect(reached.own).toBe(1);
      // Not signed in: still refused, as any secure route refuses.
      expect((await get("own")).status).toBe(401);
    });
  }
);
