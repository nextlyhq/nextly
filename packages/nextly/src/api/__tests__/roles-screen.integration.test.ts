/**
 * What the roles screen is told about each collection and Single.
 *
 * The screen sets one access level per entity, names it by its label, folds a
 * plugin's entities under the plugin, and marks one whose code also narrows
 * who may act on it. Each of those is asserted here through the router, on
 * every dialect, against entities that differ in exactly that respect: a
 * collection with code rules beside one without, a Single, and a plugin's
 * collection beside the app's own.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildClaims } from "../../auth/jwt/claims";
import { signAccessToken } from "../../auth/jwt/sign";
import { resetSessionStandingForTests } from "../../auth/session/session-standing";
import { defineCollection, defineSingle, text } from "../../config";
import { definePlugin } from "../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import { getHandlerConfig } from "../../route-handler/auth-handler";
import { createDynamicHandlers } from "../../routeHandler";
import { sanitizeConfig } from "../../shared/types/config";
import { registeredContentSnapshot } from "../../services/lib/registered-content-slugs";

/** The part of the Direct API these tests drive, typed where the shim is not. */
interface Direct {
  users: {
    create(a: { data: Record<string, unknown> }): Promise<{
      item: { id: string };
    }>;
  };
  permissions: {
    find(a: { limit: number }): Promise<{
      items: { id: string; slug: string }[];
    }>;
  };
  roles: {
    create(a: { data: Record<string, unknown> }): Promise<{
      item: { id: string };
    }>;
  };
}

interface ScreenEntity {
  slug: string;
  kind: "collection" | "single";
  labels: { singular: string; plural?: string };
  plugin: string | null;
  declaredRules: string[];
}

const forms = definePlugin({
  name: "@test/forms",
  version: "1.0.0",
  nextly: ">=0.0.1",
  contributes: {
    collections: [
      defineCollection({
        slug: "submissions",
        labels: { singular: "Submission", plural: "Submissions" },
        fields: [text({ name: "email" })],
      }),
    ],
  },
});

const collections = [
  defineCollection({
    slug: "articles",
    labels: { singular: "Article", plural: "Articles" },
    access: { read: () => true, publish: () => true },
    fields: [text({ name: "title" })],
  }),
  defineCollection({
    slug: "notes",
    labels: { singular: "Note", plural: "Notes" },
    fields: [text({ name: "body" })],
  }),
  // A label that reads as a timestamp, which a date-formatting pass would
  // rewrite into the installation's timezone.
  defineCollection({
    slug: "dated",
    labels: {
      singular: "2026-01-02T03:04:05.000Z",
      plural: "2026-01-02T03:04:05.000Z",
    },
    fields: [text({ name: "body" })],
  }),
];

const singles = [
  defineSingle({
    slug: "masthead",
    label: { singular: "Masthead" },
    access: { update: () => true },
    fields: [text({ name: "tagline" })],
  }),
];

/**
 * An app whose instrumentation hook boots the runtime may create its route
 * without a config. First in this file, because a route created with one keeps
 * it for the process: after that, no request here would be made without one.
 */
describe("a route created without a config", () => {
  let t: TestNextly;

  beforeAll(async () => {
    t = await createTestNextly({ collections, singles, plugins: [forms] });
  });

  afterAll(async () => {
    resetSessionStandingForTests();
    await t?.destroy();
  });

  it("still names the plugin, from the plugins the runtime booted with", async () => {
    // POPULATION CONTROL: no route has been handed a config.
    expect(getHandlerConfig()).toBeNull();
    // The install's first account holds super-admin, which passes the gate.
    const owner = await (
      t.nextly as unknown as {
        users: {
          create(a: { data: Record<string, unknown> }): Promise<{
            item: { id: string };
          }>;
        };
      }
    ).users.create({
      data: {
        email: "owner@example.com",
        password: "Password123!",
        name: "owner",
        isActive: true,
      },
    });
    const token = await signAccessToken(
      buildClaims({
        userId: owner.item.id,
        email: "owner@example.com",
        name: "owner",
        image: null,
        roleIds: [],
        sessionEpoch: 0,
      }),
      process.env.NEXTLY_SECRET!
    );
    const path = ["roles", "screen"];
    const res = await createDynamicHandlers().GET(
      new Request(`http://localhost/api/${path.join("/")}`, {
        headers: { cookie: `nextly_session=${token}` },
      }),
      { params: Promise.resolve({ params: path }) }
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const items = ((await res.json()) as { items: ScreenEntity[] }).items;
    expect(items.find(e => e.slug === "submissions")?.plugin).toBe(
      "@test/forms"
    );
  });
});

describe.each(getConfiguredTestDialects())(
  "what the roles screen is told (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let direct: Direct;
    let readerHeaders: Record<string, string>;
    let strangerHeaders: Record<string, string>;

    async function account(email: string, roles: string[] = []) {
      const created = await direct.users.create({
        data: {
          email,
          password: "Password123!",
          name: email,
          isActive: true,
          ...(roles.length > 0 ? { roles } : {}),
        },
      });
      return created.item.id;
    }

    async function session(userId: string, roleIds: string[]) {
      const token = await signAccessToken(
        buildClaims({
          userId,
          email: `${userId}@example.com`,
          name: userId,
          image: null,
          roleIds,
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET!
      );
      return { cookie: `nextly_session=${token}` };
    }

    function screen(headers: Record<string, string>) {
      const path = ["roles", "screen"];
      // Handed the app's config, as a mounted route usually is.
      return createDynamicHandlers({
        config: sanitizeConfig({ collections, singles, plugins: [forms] }),
      }).GET(
        new Request(`http://localhost/api/${path.join("/")}`, { headers }),
        { params: Promise.resolve({ params: path }) }
      );
    }

    async function entities(): Promise<ScreenEntity[]> {
      const res = await screen(readerHeaders);
      expect(res.status, await res.clone().text()).toBe(200);
      return ((await res.json()) as { items: ScreenEntity[] }).items;
    }

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        collections,
        singles,
        plugins: [forms],
      });
      direct = t.nextly as unknown as Direct;
      const seeder = t.getService("permissionSeedService") as unknown as {
        seedSystemPermissions: () => Promise<unknown>;
      };
      await seeder.seedSystemPermissions();
      // A timezone other than UTC, so a pass that rewrote timestamps by value
      // would change a label that reads as one.
      await (
        t.getService("generalSettingsService") as unknown as {
          updateSettings(data: { timezone: string }): Promise<unknown>;
        }
      ).updateSettings({ timezone: "Asia/Karachi" });

      // The install's first account holds super-admin, so it is made first
      // and not used: the two below are judged by their own roles.
      await account("owner@example.com");
      const seeded = await direct.permissions.find({ limit: 1000 });
      const readRoles = seeded.items.find(p => p.slug === "read-roles");
      expect(readRoles, "`read-roles` must be seeded").toBeDefined();
      const readerRole = (
        await direct.roles.create({
          data: {
            name: "role-readers",
            slug: "role-readers",
            permissionIds: [readRoles!.id],
          },
        })
      ).item.id;
      const readerId = await account("reader@example.com", [readerRole]);
      readerHeaders = await session(readerId, [readerRole]);
      const strangerId = await account("stranger@example.com");
      strangerHeaders = await session(strangerId, []);
    });

    afterAll(async () => {
      resetSessionStandingForTests();
      await t?.destroy();
    });

    it("refuses a caller who may not read roles", async () => {
      const res = await screen(strangerHeaders);
      expect(res.status).toBe(403);
    });

    it("lists exactly the registered collections and Singles", async () => {
      // The list is the registered content, not a second enumeration of it.
      const { kinds } = await registeredContentSnapshot();
      const listed = await entities();
      expect(listed.map(entity => entity.slug)).toEqual(
        [...kinds.keys()].sort()
      );
      expect(new Set(listed.map(entity => entity.kind))).toEqual(
        new Set(["collection", "single"])
      );
    });

    it("names each entity by its label", async () => {
      const bySlug = new Map((await entities()).map(e => [e.slug, e]));
      expect(bySlug.get("articles")?.labels).toEqual({
        singular: "Article",
        plural: "Articles",
      });
      expect(bySlug.get("masthead")?.labels).toEqual({ singular: "Masthead" });
      // As registered, not reformatted as a date.
      expect(bySlug.get("dated")?.labels).toEqual({
        singular: "2026-01-02T03:04:05.000Z",
        plural: "2026-01-02T03:04:05.000Z",
      });
    });

    it("names the operations whose code declares a rule, and only those", async () => {
      const bySlug = new Map((await entities()).map(e => [e.slug, e]));
      expect(bySlug.get("articles")?.declaredRules).toEqual([
        "read",
        "publish",
      ]);
      // The control: a collection with no code rule declares none.
      expect(bySlug.get("notes")?.declaredRules).toEqual([]);
      expect(bySlug.get("masthead")).toMatchObject({
        kind: "single",
        declaredRules: ["update"],
      });
    });

    it("names the plugin that contributes an entity, and none for the app's own", async () => {
      const bySlug = new Map((await entities()).map(e => [e.slug, e]));
      expect(bySlug.get("submissions")?.plugin).toBe("@test/forms");
      expect(bySlug.get("notes")?.plugin).toBeNull();
      expect(bySlug.get("masthead")?.plugin).toBeNull();
    });
  }
);
