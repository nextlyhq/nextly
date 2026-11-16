/**
 * The admin's startup request against the real routes, on every dialect.
 *
 * A reader who may read one collection, and not the site's settings, names
 * several paths at once. The settings part is refused with its own route's
 * refusal; every other part is answered, each exactly as a request of its own
 * to that path is, so a screen that takes its answer from the startup request
 * reads what it would have read anyway.
 */
import { afterEach, describe, expect, it } from "vitest";

import { userWhoMay } from "../../__tests__/fixtures/permission-holders";
import { buildClaims } from "../../auth/jwt/claims";
import { signAccessToken } from "../../auth/jwt/sign";
import { defineCollection, text } from "../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../plugins/test-nextly";
import { createDynamicHandlers } from "../../routeHandler";

// Integration files share fixed system-table names, so this file keeps its
// own collection slug.
const NOTES = "startup_req_notes";
const READER = "startup-req-reader";
const ORIGIN = "http://localhost";

const SETTINGS = "/general-settings";
const ME = "/me";
const SESSION = "/auth/session";
const NAV = "/collections?limit=100&page=1&sortBy=name&sortOrder=asc";

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
  "the startup request (%s)",
  dialect => {
    it("answers each part as its own route does, and refuses only the part the reader may not read", async () => {
      current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({ slug: NOTES, fields: [text({ name: "title" })] }),
        ],
      });
      await userWhoMay(current, READER, "read", [NOTES]);

      const query = [SETTINGS, ME, SESSION, NAV]
        .map(path => `path=${encodeURIComponent(path)}`)
        .join("&");
      const response = await get(`/startup?${query}`);
      expect(response.status).toBe(200);
      const { parts } = (await response.json()) as {
        parts: { path: string; status: number; body: unknown }[];
      };
      const part = (path: string) => parts.find(each => each.path === path);

      // The one part the reader may not read: its own route's refusal.
      expect(part(SETTINGS)?.status).toBe(403);
      expect(part(SETTINGS)?.body).toMatchObject({
        error: { code: "FORBIDDEN" },
      });

      // Every other part, exactly as a request of its own answers it.
      for (const path of [ME, NAV]) {
        const own = await get(path);
        expect(part(path)?.status, path).toBe(own.status);
        expect(part(path)?.body, path).toEqual(await own.json());
      }
      // The session's access token is signed afresh on every request, so the
      // session is compared by the person it names.
      const ownSession = (await (await get(SESSION)).json()) as {
        user: unknown;
      };
      expect(part(SESSION)?.status).toBe(200);
      expect(part(SESSION)?.body).toMatchObject({
        user: ownSession.user,
        accessToken: expect.any(String),
      });
      expect(part(ME)?.body).toMatchObject({ id: READER });
      expect(
        (
          part(NAV)?.body as { items: { slug?: string; name?: string }[] }
        ).items.map(item => item.slug ?? item.name)
      ).toContain(NOTES);
    }, 300_000);
  }
);
