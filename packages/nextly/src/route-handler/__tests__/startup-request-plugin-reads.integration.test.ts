/**
 * A plugin page's declared startup reads, answered by the startup request
 * against the real routes, on every dialect.
 *
 * The page declares a read of its plugin's own route; the startup request
 * names it, as the admin does for that page, beside a part the reader may
 * read and one of the plugin's routes the reader may not. The declared read
 * is answered exactly as a request of its own is, through the plugin's route
 * and its permission check; the route the reader may not call is refused on
 * its own, and the other parts are answered.
 */
import { afterEach, describe, expect, it } from "vitest";

import { userWhoMay } from "../../__tests__/fixtures/permission-holders";
import { buildClaims } from "../../auth/jwt/claims";
import { signAccessToken } from "../../auth/jwt/sign";
import { defineCollection, text } from "../../config";
import { definePlugin } from "../../plugins/plugin-context";
import { carriedStartupRead } from "../../plugins/startup-reads";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../plugins/test-nextly";
import { createDynamicHandlers } from "../../routeHandler";

// Integration files share fixed system-table names, so this file keeps its
// own collection slug and reader.
const NOTES = "startup_read_notes";
const READER = "startup-read-reader";
const ORIGIN = "http://localhost";
const PLUGIN = "@test/startup-reads";
const ME = "/me";

const PAGE = {
  path: "greeting",
  component: "@test/startup-reads/admin#Greeting",
  startupReads: [{ path: "/greeting" }],
} as const;

const plugin = definePlugin({
  name: PLUGIN,
  version: "1.0.0",
  nextly: ">=0.0.1",
  contributes: {
    admin: { pages: [PAGE] },
    routes: [
      {
        method: "GET",
        path: "/greeting",
        requiredPermission: `read-${NOTES}`,
        handler: () => Response.json({ message: "Hello from the plugin" }),
      },
      {
        method: "GET",
        path: "/ledger",
        requiredPermission: `update-${NOTES}`,
        handler: () => Response.json({ total: 42 }),
      },
    ],
  },
});

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** The reader's session cookie. */
async function cookie(): Promise<string> {
  const token = await signAccessToken(
    buildClaims({
      userId: READER,
      email: `${READER}@example.test`,
      name: READER,
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET ?? ""
  );
  return `nextly_session=${token}`;
}

/** A GET of `path` within the admin API, as the reader. */
async function get(path: string): Promise<Response> {
  const url = new URL(`${ORIGIN}/admin/api${path}`);
  const params = url.pathname
    .slice("/admin/api/".length)
    .split("/")
    .filter(Boolean);
  return createDynamicHandlers().GET(
    new Request(url, { headers: { origin: ORIGIN, cookie: await cookie() } }),
    { params: Promise.resolve({ params }) }
  );
}

describe.each(getConfiguredTestDialects())(
  "a plugin page's startup reads (%s)",
  dialect => {
    it("are answered as the plugin's own route answers them, each with its own permission check", async () => {
      current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({ slug: NOTES, fields: [text({ name: "title" })] }),
        ],
        plugins: [plugin],
      });
      await userWhoMay(current, READER, "read", [NOTES]);

      // The path the admin names for the page: the one its read asks for.
      const greeting = carriedStartupRead(PLUGIN, PAGE.startupReads[0]) ?? "";
      expect(greeting).toBe(`/plugins/${PLUGIN}/greeting`);
      const ledger = `/plugins/${PLUGIN}/ledger`;

      const query = [ME, greeting, ledger]
        .map(path => `path=${encodeURIComponent(path)}`)
        .join("&");
      const response = await get(`/startup?${query}`);
      expect(response.status).toBe(200);
      const { parts } = (await response.json()) as {
        parts: { path: string; status: number; body: unknown }[];
      };
      const part = (path: string) => parts.find(each => each.path === path);

      // The declared read, exactly as a request of its own answers it.
      const own = await get(greeting);
      expect(own.status).toBe(200);
      expect(part(greeting)?.status).toBe(200);
      expect(part(greeting)?.body).toEqual(await own.json());

      // The plugin's route the reader may not call: its own refusal, alone.
      expect(part(ledger)?.status).toBe(403);
      expect(part(ledger)?.body).toMatchObject({
        error: { code: "FORBIDDEN" },
      });
      expect(part(ME)?.status).toBe(200);
      expect(part(ME)?.body).toMatchObject({ id: READER });
    }, 300_000);
  }
);
