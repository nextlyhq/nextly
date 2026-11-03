/**
 * A REST request whose route gate asks a rule that could not run is answered
 * with that: 503, `RULE_COULD_NOT_RUN` naming the collection, the retry hint
 * and the request's id, private to the session.
 *
 * The route gate runs before the dispatcher, outside its error mapping. The
 * plausible broken implementation lets the gate's error escape the handler,
 * so the framework answers its own bare 500 with no code, no retry hint and
 * no request id; the older one reads the rule's failure as its refusal, a
 * 403. The control is the same request with the rule answering, which the
 * caller's grant lets through.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { poolWaitTimeoutError } from "@nextlyhq/adapter-drizzle/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildClaims } from "../../auth/jwt/claims";
import { signAccessToken } from "../../auth/jwt/sign";
import { resetSessionStandingForTests } from "../../auth/session/session-standing";
import { defineCollection, text } from "../../config";
import { Nextly } from "../../direct-api/nextly";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import { createDynamicHandlers } from "../../routeHandler";

const NOTES = "gatenotes";

describe.each(getConfiguredTestDialects())(
  "a route gate whose rule could not run (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let cookie = "";
    // Armed after setup, so seeding and the trusted writes never ask it.
    const probe = { armed: false };

    function get(path: string[]): Promise<Response> {
      const handlers = createDynamicHandlers() as unknown as Record<
        string,
        (request: Request, context: unknown) => Promise<Response>
      >;
      return handlers.GET!(
        new Request(`http://localhost/api/${path.join("/")}`, {
          method: "GET",
          headers: { cookie },
        }),
        { params: Promise.resolve({ params: path }) }
      );
    }

    beforeAll(async () => {
      t = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: NOTES,
            access: {
              // The rule's own query waited out the pool's bound, as the
              // adapter reports it.
              read: () => {
                if (probe.armed) throw poolWaitTimeoutError(15_000);
                return true;
              },
            },
            fields: [text({ name: "title" })],
          }),
        ],
      } as never);
      const trusted = new Nextly();
      const seeder = t.getService("permissionSeedService") as unknown as {
        seedSystemPermissions: () => Promise<unknown>;
        seedAllCollectionPermissions: () => Promise<unknown>;
      };
      await seeder.seedSystemPermissions();
      await seeder.seedAllCollectionPermissions();
      await trusted.users.create({
        email: "owner@example.com",
        password: "Password123!",
        data: { name: "Owner", isActive: true },
      });
      const perms = await trusted.permissions.find({ limit: 1000 });
      const readNotes = perms.items.find(p => p.slug === `read-${NOTES}`);
      expect(readNotes, `read-${NOTES} must be seeded`).toBeDefined();
      const roleId = (
        await trusted.roles.create({
          data: {
            name: "readers",
            slug: "readers",
            permissionIds: [readNotes!.id],
          },
        })
      ).item.id;
      const reader = (
        await trusted.users.create({
          email: "reader@example.com",
          password: "Password123!",
          data: { name: "Reader", isActive: true, roles: [roleId] },
        })
      ).item as { id: string };
      await trusted.create({
        collection: NOTES,
        data: { title: "A note" },
      } as never);
      const token = await signAccessToken(
        buildClaims({
          userId: String(reader.id),
          email: "reader@example.com",
          name: "Reader",
          image: null,
          roleIds: [roleId],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET!
      );
      cookie = `nextly_session=${token}`;
    }, 180_000);

    afterAll(async () => {
      resetSessionStandingForTests();
      await t?.destroy();
    });

    it("lets the reader list the entries while the rule answers", async () => {
      probe.armed = false;
      const response = await get(["collections", NOTES, "entries"]);
      expect(response.status, await response.clone().text()).toBe(200);
    });

    it("answers 503 naming the collection, with the retry hint and the request id", async () => {
      probe.armed = true;
      try {
        const response = await get(["collections", NOTES, "entries"]);
        const body = (await response.json()) as {
          error?: { code?: string; requestId?: string; data?: unknown };
        };
        expect(response.status, JSON.stringify(body)).toBe(503);
        expect(body.error?.code).toBe("RULE_COULD_NOT_RUN");
        expect(body.error?.data).toMatchObject({ subject: NOTES });
        expect(response.headers.get("retry-after")).not.toBeNull();
        expect(response.headers.get("x-request-id")).toBe(
          body.error?.requestId
        );
        expect(response.headers.get("cache-control")).toMatch(/private/);
      } finally {
        probe.armed = false;
      }
    });
  }
);
