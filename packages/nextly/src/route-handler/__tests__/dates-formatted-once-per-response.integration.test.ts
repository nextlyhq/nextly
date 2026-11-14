/**
 * Every admin answer's dates are rendered in the configured timezone once,
 * through the real catch-all handler, on every dialect.
 *
 * Some handlers can be mounted on a route of their own (`/singles`, a Single,
 * `/general-settings`), so they format their answer themselves; the admin's
 * catch-all route formats every answer it passes on. An answer from such a
 * handler was therefore parsed, rewritten and serialized twice, and asked
 * for the configured timezone twice. The catch-all now passes on an answer
 * its handler formatted as it is. Counted here by the timezone lookups each
 * request makes, and checked to still carry the timezone's offset.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { superAdminUser } from "../../__tests__/fixtures/permission-holders";
import { buildClaims } from "../../auth/jwt/claims";
import { signAccessToken } from "../../auth/jwt/sign";
import { defineSingle, text } from "../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../plugins/test-nextly";
import { createDynamicHandlers } from "../../routeHandler";
import type { GeneralSettingsService } from "../../services/general-settings/general-settings-service";

const ORIGIN = "http://localhost";
const ADMIN = "dates-once-admin";

let current: TestNextly | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await current?.destroy();
  current = undefined;
});

describe.each(getConfiguredTestDialects())(
  "dates formatted once per answer (%s)",
  dialect => {
    it("asks for the timezone once per answer, and still renders it", async () => {
      const t = (current = await createTestNextly({
        dialect,
        singles: [
          defineSingle({ slug: "home", fields: [text({ name: "heading" })] }),
        ],
      }));
      await superAdminUser(t, ADMIN);
      const settings = t.getService(
        "generalSettingsService"
      ) as GeneralSettingsService;
      await settings.updateSettings({ timezone: "America/New_York" });
      const token = await signAccessToken(
        buildClaims({
          userId: ADMIN,
          email: `${ADMIN}@example.test`,
          name: ADMIN,
          image: null,
          roleIds: [],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET ?? ""
      );
      const send = async (path: string) => {
        const url = new URL(`${ORIGIN}/admin/api${path}`);
        const response = await createDynamicHandlers().GET(
          new Request(url, {
            headers: { origin: ORIGIN, cookie: `nextly_session=${token}` },
          }),
          {
            params: Promise.resolve({
              params: url.pathname
                .slice("/admin/api/".length)
                .split("/")
                .filter(Boolean),
            }),
          }
        );
        expect(response.status, path).toBe(200);
        return response.text();
      };
      const lookups = vi.spyOn(settings, "getTimezone");

      for (const path of ["/singles?limit=100&page=1", "/general-settings"]) {
        lookups.mockClear();
        const body = await send(path);
        expect(lookups, path).toHaveBeenCalledTimes(1);
        // Formatted, once: a timestamp carries New York's offset.
        expect(body, path).toMatch(/T\d{2}:\d{2}:\d{2}(\.\d+)?-0[45]:00/);
      }
    });
  }
);
