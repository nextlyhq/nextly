/**
 * A super-admin's full-access API key holds super-admin authority until a
 * bound passes. One request asks about it at several gates: the route gate,
 * the dispatch's service gates, the scopes doors inside the dispatch build,
 * and a plugin route's service calls. Every one of them gives the answer the
 * request's first ask gave, so a request that crosses the bound neither
 * loses the authority between two of its writes nor gains it back.
 *
 * Every write here is to `notes`, whose rules refuse everyone: only
 * super-admin authority passes them, so a write that lands says the key
 * carried that authority at that gate, and a refusal says it did not.
 *
 * The clock is the monotonic one the bound is timed on. While a case
 * crosses, the request's first ask about the key's authority reads it before
 * the bound and every later ask reads it past the bound; the control reads it
 * past the bound from the first ask on.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it, vi } from "vitest";

import { defineCollection, text } from "../../config";
import { seedAllPermissions } from "../../init/seed-permissions";
import { definePlugin } from "../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import { createDynamicHandlers } from "../../routeHandler";
import { ServiceContainer } from "../../services/index";
import type { ApiKeyService } from "../../domains/auth/services/api-key-service";
import {
  SESSION_CUTOFF_SECONDS,
  resetSessionStandingForTests,
} from "../session/session-standing";

const PLUGIN = "@test/two-writes";

/** Rules only super-admin authority passes. */
const notes = defineCollection({
  slug: "notes",
  access: {
    read: () => false,
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [text({ name: "title" })],
});

/** A plugin route whose handler writes `notes` twice, as the request's key. */
const twoWrites = definePlugin({
  name: PLUGIN,
  version: "1.0.0",
  nextly: ">=0.0.1",
  contributes: {
    routes: [
      {
        method: "POST",
        path: "/write-twice",
        handler: async (_req, ctx) => {
          for (const title of ["first", "second"]) {
            await ctx.services.collections.createEntry(
              "notes",
              { title },
              {
                as: "user",
                user: ctx.user ?? undefined,
                authenticatedScope: ctx.authenticatedScope,
              }
            );
          }
          return Response.json({});
        },
      },
    ],
  },
});

/** Past the longest bound a key's authority can hold for. */
const PAST_THE_BOUND_MS = SESSION_CUTOFF_SECONDS * 1000 + 1000;

/**
 * How the clock reads to an ask about a key's authority: `crossing` before
 * the bound at the request's first ask and past it at every later one,
 * `past` past it from the first ask on, `real` as it is.
 */
let clock: "real" | "crossing" | "past" = "real";
let asksSeen = 0;

const realNow = performance.now.bind(performance);

/** Whether the clock is being read by an ask about a key's authority. */
function askingAboutAuthority(): boolean {
  return new Error().stack?.includes("scopeHoldsSuperAdmin") === true;
}

function controlClock(mode: "crossing" | "past"): void {
  clock = mode;
  asksSeen = 0;
  vi.spyOn(performance, "now").mockImplementation(() => {
    if (clock === "real" || !askingAboutAuthority()) return realNow();
    asksSeen += 1;
    if (clock === "crossing" && asksSeen === 1) return realNow();
    return realNow() + PAST_THE_BOUND_MS;
  });
}

let current: TestNextly | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  clock = "real";
  resetSessionStandingForTests();
  await current?.destroy();
  current = undefined;
});

function rest(
  method: "POST" | "PATCH",
  segments: string[],
  key: string,
  body?: unknown
): Promise<Response> {
  return createDynamicHandlers()[method](
    new Request(`http://localhost/api/${segments.join("/")}`, {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    { params: Promise.resolve({ params: segments }) }
  );
}

describe.each(getConfiguredTestDialects())(
  "a super-admin key's authority, answered once per request (%s)",
  (dialect: TestDialect) => {
    /** An install with a super-admin and their full-access key. */
    async function boot(): Promise<{ t: TestNextly; key: string }> {
      current = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        collections: [notes],
        plugins: [twoWrites],
      });
      const t = current;
      await seedAllPermissions();
      const users = (
        t.nextly as unknown as {
          users: {
            create(a: {
              email: string;
              password: string;
              data: Record<string, unknown>;
            }): Promise<{ item: { id: string | number } }>;
          };
        }
      ).users;
      // The install's first account is a super-admin already; the key's
      // maker is a second one, given the role directly.
      await users.create({
        email: "founder@example.com",
        password: "Str0ng-P@ssw0rd!",
        data: { name: "Founder", isActive: true },
      });
      const made = await users.create({
        email: "root@example.com",
        password: "Str0ng-P@ssw0rd!",
        data: { name: "Root", isActive: true },
      });
      const root = String(made.item.id);
      const services = new ServiceContainer(t.adapter);
      const superAdmin = (await services.roles.ensureSuperAdminRole()).id;
      const assigned = await services.userRoles.assignRoleToUser(
        root,
        superAdmin
      );
      if (!assigned.success) throw new Error(assigned.message);
      const keys = t.getService("apiKeyService") as unknown as ApiKeyService;
      const { key } = await keys.createApiKey(root, {
        name: "full-access key",
        tokenType: "full-access",
        expiresIn: "unlimited",
      });
      return { t, key };
    }

    /** The titles stored in `notes`, read past every rule. */
    async function titles(t: TestNextly): Promise<string[]> {
      const found = await t.nextly.find({ collection: "notes", limit: 100 });
      return (found.items as { title?: string }[])
        .map(item => item.title ?? "")
        .sort();
    }

    it("passes the route gate and then the service write it admitted", async () => {
      const { t, key } = await boot();
      controlClock("crossing");

      const res = await rest("POST", ["collections", "notes", "entries"], key, {
        title: "written",
      });

      expect(res.status).toBeLessThan(300);
      // The clock was read past the bound by every ask after the first.
      expect(asksSeen).toBe(1);
      expect(await titles(t)).toEqual(["written"]);
    });

    it("passes both writes a plugin route's handler makes", async () => {
      const { t, key } = await boot();
      controlClock("crossing");

      const res = await rest(
        "POST",
        ["plugins", ...PLUGIN.split("/"), "write-twice"],
        key
      );

      expect(res.status).toBe(200);
      expect(asksSeen).toBe(1);
      expect(await titles(t)).toEqual(["first", "second"]);
    });

    it("passes every entry of a bulk write", async () => {
      const { t, key } = await boot();
      const ids: string[] = [];
      for (const title of ["a", "b", "c"]) {
        const made = await t.nextly.create({
          collection: "notes",
          data: { title },
        });
        ids.push(String((made.item as { id: string | number }).id));
      }
      controlClock("crossing");

      const res = await rest(
        "POST",
        ["collections", "notes", "entries", "bulk-update"],
        key,
        { ids, data: { title: "bulk" } }
      );
      const body = (await res.json()) as { errors?: unknown[] };

      expect(res.status).toBe(200);
      expect(body.errors).toEqual([]);
      expect(asksSeen).toBe(1);
      expect(await titles(t)).toEqual(["bulk", "bulk", "bulk"]);
    });

    it("refuses a request that starts past the bound at its first gate, before any write", async () => {
      const { t, key } = await boot();
      controlClock("past");

      const single = await rest(
        "POST",
        ["collections", "notes", "entries"],
        key,
        { title: "refused" }
      );
      const twice = await rest(
        "POST",
        ["plugins", ...PLUGIN.split("/"), "write-twice"],
        key
      );

      expect(single.status).toBe(403);
      expect(twice.status).toBe(403);
      // The control for the cases above: the clock this file controls is
      // the one the bound is read on, so past it the key is refused.
      expect(asksSeen).toBeGreaterThan(0);
      expect(await titles(t)).toEqual([]);
    });
  }
);
