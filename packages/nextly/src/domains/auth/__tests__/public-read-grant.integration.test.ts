/**
 * The Public role is granted read where code says anyone may read.
 *
 * Boot seeding asks each collection's and Single's read rule about a visitor,
 * once per entity: where it answers exactly `true` (a plain `true`, or a
 * function returning `true`), Public is granted that read. It is always
 * granted `read-media` and never `read-users`. An entity is asked once, so a
 * read an owner takes away again is not granted back. What a visitor could
 * read before and Public does not hold, a rule that failed when asked, and a
 * write a rule opens to anyone are listed at every boot until Public holds
 * them.
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../../config";
import { getDialectTables } from "../../../database";
import { seedPermissionsAndRolePresets } from "../../../init/seed-permissions";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { Logger } from "../../../services/shared";
import { ServiceContainer } from "../../../services/index";
import { PUBLIC_ROLE_SLUG } from "../services/public-role";

let t: TestNextly | undefined;
afterEach(async () => {
  await t?.destroy();
  t = undefined;
  counted = () => false;
});

/** Every warning boot seeding logged, as one string each. */
let warnings: string[] = [];

const logger: Logger = {
  debug() {},
  info() {},
  warn(message: unknown) {
    warnings.push(String(message));
  },
  error() {},
} as Logger;

const fields = [text({ name: "title" })];

/** What the `counted` collection's read rule does when asked. */
let counted: () => boolean = () => false;

/** The site's languages, for a boot that has them. */
type Languages = NonNullable<
  NonNullable<Parameters<typeof createTestNextly>[0]>["localization"]
>;

async function boot(
  dialect: TestDialect,
  localization?: Languages
): Promise<TestNextly> {
  warnings = [];
  t = await createTestNextly({
    ...(dialect === "sqlite" ? {} : { dialect }),
    ...(localization ? { localization } : {}),
    logger,
    collections: [
      defineCollection({ slug: "open", access: { read: true }, fields }),
      defineCollection({
        slug: "openfn",
        access: { read: () => true },
        fields,
      }),
      defineCollection({
        slug: "openasync",
        access: { read: async () => true },
        fields,
      }),
      defineCollection({ slug: "closed", access: { read: false }, fields }),
      defineCollection({ slug: "ruleless", fields }),
      defineCollection({
        slug: "throwing",
        access: {
          read: () => {
            throw new Error("needs a request");
          },
        },
        fields,
      }),
      defineCollection({
        slug: "silent",
        // Never answers: asked at boot, it is given up on, its read and its
        // create together.
        access: {
          read: () => new Promise<boolean>(() => {}),
          create: () => new Promise<boolean>(() => {}),
        },
        fields,
      }),
      // Stored per language, on a site that has languages, and read by a
      // visitor in English only.
      ...(localization
        ? [
            defineCollection({
              slug: "english",
              localized: true,
              access: { read: ({ locale }) => locale === "en" },
              fields,
            }),
            // Read by a visitor only where a read names no one language: a
            // read of every translation.
            defineCollection({
              slug: "everylang",
              localized: true,
              access: { read: ({ locale }) => locale === undefined },
              fields,
            }),
            // Creatable by a visitor only where English is read with every
            // language beside it, as duplicating an entry asks its create.
            defineCollection({
              slug: "duplicable",
              localized: true,
              access: {
                create: ({ locale, locales }) =>
                  locale === "en" && locales.length > 1,
              },
              fields,
            }),
            // Stored once for every language; its rule counts its askings.
            defineCollection({
              slug: "counted",
              access: { read: () => counted() },
              fields,
            }),
            // Read by a visitor only in German with no fallback, as
            // `?locale=de&fallback-locale=none` asks.
            defineCollection({
              slug: "germanonly",
              localized: true,
              access: {
                read: ({ locale, locales }) =>
                  locale === "de" && locales.length === 1,
              },
              fields,
            }),
            // Read by a visitor only in a translation overview of English,
            // which is told English and every other language too.
            defineCollection({
              slug: "overview",
              localized: true,
              access: {
                read: ({ locale, locales }) =>
                  locale === "en" && locales.length > 1,
              },
              fields,
            }),
          ]
        : []),
      defineCollection({
        slug: "guestbook",
        access: { read: true, create: true },
        fields,
      }),
    ],
    singles: [
      defineSingle({ slug: "banner", access: { read: true }, fields }),
      defineSingle({ slug: "notice", fields }),
    ],
  });
  return t;
}

const services = (nextly: TestNextly) => new ServiceContainer(nextly.adapter);

/** The permission slugs the Public role holds directly. */
async function publicHolds(nextly: TestNextly): Promise<string[]> {
  const found = await services(nextly).roles.findRoleIdBySlug(PUBLIC_ROLE_SLUG);
  if (!found) throw new Error("no Public role");
  const held = await services(nextly).rolePermissions.listRolePermissions(
    found.id
  );
  return held.map(p => `${p.action}-${p.resource}`).sort();
}

/**
 * Removes a permission and every grant of it, as pruning a collection and
 * cleaning up after it does.
 */
async function removePermission(
  nextly: TestNextly,
  action: string,
  resource: string
) {
  const { permissions, rolePermissions } = getDialectTables();
  const db = nextly.adapter.getDrizzle() as unknown as {
    select: (c: unknown) => {
      from: (t: unknown) => {
        where: (c: unknown) => Promise<Array<{ id: string }>>;
      };
    };
    delete: (table: unknown) => { where: (c: unknown) => Promise<unknown> };
  };
  const [row] = await db
    .select({ id: permissions.id })
    .from(permissions)
    .where(
      and(eq(permissions.action, action), eq(permissions.resource, resource))
    );
  await db
    .delete(rolePermissions)
    .where(eq(rolePermissions.permissionId, row.id));
  await db.delete(permissions).where(eq(permissions.id, row.id));
}

/** The one startup listing logged, or `undefined` where none was. */
const listing = () => warnings.find(message => message.includes("Public role"));

describe.each(getConfiguredTestDialects())(
  "the Public role's read, granted where code says anyone (%s)",
  dialect => {
    it("grants read where the read rule answers true, read-media, and never read-users", async () => {
      const nextly = await boot(dialect);
      await seedPermissionsAndRolePresets();

      expect(await publicHolds(nextly)).toEqual(
        [
          "read-banner",
          "read-guestbook",
          "read-media",
          "read-open",
          "read-openasync",
          "read-openfn",
        ].sort()
      );
    });

    it("does not grant back a read an owner took away", async () => {
      const nextly = await boot(dialect);
      await seedPermissionsAndRolePresets();
      const id = (await services(nextly).roles.findRoleIdBySlug(
        PUBLIC_ROLE_SLUG
      ))!.id;
      const held =
        await services(nextly).rolePermissions.listRolePermissions(id);
      await services(nextly).roles.updateRole(id, {
        permissionIds: held
          .filter(p => !(p.action === "read" && p.resource === "open"))
          .map(p => p.id),
      });

      await seedPermissionsAndRolePresets();

      expect(await publicHolds(nextly)).not.toContain("read-open");
      expect(await publicHolds(nextly)).toContain("read-openfn");
    });

    it("lists what visitors lose, the rules that failed, and the writes a rule opens", async () => {
      await boot(dialect);
      await seedPermissionsAndRolePresets();

      const said = listing();
      expect(said).toBeDefined();
      // What a visitor read with no rule, and Public does not hold.
      expect(said).toContain("ruleless");
      expect(said).toContain("notice");
      // Rules that failed or gave no answer when asked about a visitor.
      expect(said).toContain("throwing");
      expect(said).toContain("silent");
      // A write a rule lets anyone make, which needs Public's permission.
      expect(said).toMatch(/create.*guestbook|guestbook.*create/);
      // Never what Public now reads, or a rule that refuses visitors.
      expect(said).not.toMatch(/\bopen\b/);
      expect(said).not.toContain("closed");
    });

    it("lists only once per boot, and keeps listing until Public holds it", async () => {
      await boot(dialect);
      await seedPermissionsAndRolePresets();
      expect(warnings.filter(m => m.includes("Public role"))).toHaveLength(1);

      warnings = [];
      await seedPermissionsAndRolePresets();
      expect(listing()).toContain("ruleless");
    });

    it("asks a rule in each language a visitor may read in, and in all at once", async () => {
      const nextly = await boot(dialect, {
        locales: ["en", "de"],
        defaultLocale: "en",
      });
      await seedPermissionsAndRolePresets();

      expect(await publicHolds(nextly)).toContain("read-english");
      expect(await publicHolds(nextly)).toContain("read-everylang");
      expect(await publicHolds(nextly)).toContain("read-overview");
      expect(await publicHolds(nextly)).toContain("read-germanonly");
      // A write a rule opens in a read's languages is named too.
      expect(listing()).toContain("create-duplicable");
    });

    it("has an owner's addition of a Public permission wait for a grant in progress, and add it once", async () => {
      const nextly = await boot(dialect);
      await seedPermissionsAndRolePresets();
      const id = (await services(nextly).roles.findRoleIdBySlug(
        PUBLIC_ROLE_SLUG
      ))!.id;
      let entered!: () => void;
      const inside = new Promise<void>(resolve => (entered = resolve));
      let release!: () => void;
      const released = new Promise<void>(resolve => (release = resolve));
      const grant = services(nextly).rolePermissions.addRolePermissionsOnce(
        id,
        [],
        async () => {
          entered();
          await released;
          return [];
        }
      );
      await inside;

      const permissions = services(nextly).rolePermissions;
      let added = false;
      const addition = permissions
        .addPermissionToRole(id, { action: "read", resource: "closed" })
        .then(() => {
          added = true;
        });
      await new Promise(resolve => setTimeout(resolve, 500));
      const addedWhileGranting = added;
      release();
      await Promise.all([grant, addition]);
      // Added again, it is held once and nothing fails.
      await permissions.addPermissionToRole(id, {
        action: "read",
        resource: "closed",
      });

      expect(addedWhileGranting).toBe(false);
      expect(
        (await publicHolds(nextly)).filter(p => p === "read-closed")
      ).toHaveLength(1);
    });

    it("has an owner's removal of a Public permission wait for a grant in progress", async () => {
      const nextly = await boot(dialect);
      await seedPermissionsAndRolePresets();
      const id = (await services(nextly).roles.findRoleIdBySlug(
        PUBLIC_ROLE_SLUG
      ))!.id;
      let entered!: () => void;
      const inside = new Promise<void>(resolve => (entered = resolve));
      let release!: () => void;
      const released = new Promise<void>(resolve => (release = resolve));
      const grant = services(nextly).rolePermissions.addRolePermissionsOnce(
        id,
        [],
        async () => {
          entered();
          await released;
          return [];
        }
      );
      await inside;

      let removed = false;
      const removal = services(nextly)
        .rolePermissions.removePermissionFromRole(id, {
          action: "read",
          resource: "open",
        })
        .then(() => {
          removed = true;
        });
      await new Promise(resolve => setTimeout(resolve, 500));
      const removedWhileGranting = removed;
      release();
      await Promise.all([grant, removal]);

      expect(removedWhileGranting).toBe(false);
      expect(await publicHolds(nextly)).not.toContain("read-open");
    });

    it("grants afresh to a Public role made again", async () => {
      const nextly = await boot(dialect);
      await seedPermissionsAndRolePresets();
      const old = (await services(nextly).roles.findRoleIdBySlug(
        PUBLIC_ROLE_SLUG
      ))!.id;
      const { roles: rolesTable, rolePermissions } = getDialectTables();
      const db = nextly.adapter.getDrizzle() as unknown as {
        delete: (t: unknown) => { where: (c: unknown) => Promise<unknown> };
      };
      await db.delete(rolePermissions).where(eq(rolePermissions.roleId, old));
      await db.delete(rolesTable).where(eq(rolesTable.id, old));

      await seedPermissionsAndRolePresets();

      const made = (await services(nextly).roles.findRoleIdBySlug(
        PUBLIC_ROLE_SLUG
      ))!.id;
      expect(made).not.toBe(old);
      expect(await publicHolds(nextly)).toContain("read-media");
      expect(await publicHolds(nextly)).toContain("read-open");
    });

    it("has an owner's save of Public's permissions wait for a grant in progress", async () => {
      const nextly = await boot(dialect);
      await seedPermissionsAndRolePresets();
      const id = (await services(nextly).roles.findRoleIdBySlug(
        PUBLIC_ROLE_SLUG
      ))!.id;
      const held =
        await services(nextly).rolePermissions.listRolePermissions(id);
      let entered!: () => void;
      const inside = new Promise<void>(resolve => (entered = resolve));
      let release!: () => void;
      const released = new Promise<void>(resolve => (release = resolve));
      const grant = services(nextly).rolePermissions.addRolePermissionsOnce(
        id,
        [],
        async () => {
          entered();
          await released;
          return [];
        }
      );
      await inside;

      let saved = false;
      const save = services(nextly)
        .roles.updateRole(id, {
          permissionIds: held.slice(1).map(p => p.id),
        })
        .then(() => {
          saved = true;
        });
      await new Promise(resolve => setTimeout(resolve, 500));
      const savedWhileGranting = saved;
      release();
      await Promise.all([grant, save]);

      expect(savedWhileGranting).toBe(false);
      expect(saved).toBe(true);
    });

    it("claims a read Public holds already without adding it twice", async () => {
      const nextly = await boot(dialect);
      await seedPermissionsAndRolePresets();
      // An install whose owner gave Public `read-media` and whose record of
      // grants is gone: `read-open` is still to be granted.
      const meta = nextly.getService("metaService");
      await meta.delete("public-role-granted");
      const id = (await services(nextly).roles.findRoleIdBySlug(
        PUBLIC_ROLE_SLUG
      ))!.id;
      const held =
        await services(nextly).rolePermissions.listRolePermissions(id);
      await services(nextly).roles.updateRole(id, {
        permissionIds: held
          .filter(p => !(p.action === "read" && p.resource === "open"))
          .map(p => p.id),
      });

      await seedPermissionsAndRolePresets();

      expect(await publicHolds(nextly)).toContain("read-open");
      expect(await publicHolds(nextly)).toContain("read-media");
    });

    it("commits what is claimed with the grant, and rolls both back together", async () => {
      const nextly = await boot(dialect);
      await seedPermissionsAndRolePresets();
      const id = (await services(nextly).roles.findRoleIdBySlug(
        PUBLIC_ROLE_SLUG
      ))!.id;
      const grants = services(nextly).rolePermissions;
      const meta = nextly.getService("metaService");
      const readClosed = String(
        (
          await services(nextly).permissions.listPermissions({
            action: "read",
            resource: "closed",
          })
        ).data[0].id
      );
      const closed = [{ id: readClosed, action: "read", resource: "closed" }];

      await expect(
        grants.addRolePermissionsOnce(id, closed, async (_ids, executor) => {
          await meta.insertIfAbsent("claimed-with-grant", ["read"], executor);
          throw new Error("stopped before the grant");
        })
      ).rejects.toThrow("stopped before the grant");
      expect(await meta.get("claimed-with-grant")).toBeNull();
      expect(await publicHolds(nextly)).not.toContain("read-closed");

      await grants.addRolePermissionsOnce(
        id,
        closed,
        async (_ids, executor) => {
          await meta.insertIfAbsent("claimed-with-grant", ["read"], executor);
          return [readClosed];
        }
      );
      expect(await meta.get("claimed-with-grant")).toEqual(["read"]);
      expect(await publicHolds(nextly)).toContain("read-closed");
    });

    it("leaves out a permission that no longer grants what it was wanted for", async () => {
      const nextly = await boot(dialect);
      await seedPermissionsAndRolePresets();
      const id = (await services(nextly).roles.findRoleIdBySlug(
        PUBLIC_ROLE_SLUG
      ))!.id;
      const readClosed = String(
        (
          await services(nextly).permissions.listPermissions({
            action: "read",
            resource: "closed",
          })
        ).data[0].id
      );

      // Wanted as `delete-closed`, which the row it names does not grant.
      const added = await services(
        nextly
      ).rolePermissions.addRolePermissionsOnce(
        id,
        [{ id: readClosed, action: "delete", resource: "closed" }],
        async ids => ids
      );

      expect(added).toEqual([]);
      expect(await publicHolds(nextly)).not.toContain("read-closed");
    });

    it("asks a rule once where every request context comes to the same", async () => {
      let asked = 0;
      counted = () => {
        asked++;
        return false;
      };
      await boot(dialect, { locales: ["en", "de"], defaultLocale: "en" });
      await seedPermissionsAndRolePresets();

      // `counted` is stored once for every language, so each read context
      // tells its rule every language, and it is asked once.
      expect(asked).toBe(1);
    });

    it("waits for the Public role to be made before granting", async () => {
      const nextly = await boot(dialect);
      await seedPermissionsAndRolePresets();
      // An upgrade where the site's own role holds the slug, and another
      // boot has claimed making the Public role but not moved it yet.
      const roles = services(nextly).roles;
      const readMedia = (
        await services(nextly).permissions.listPermissions({
          action: "read",
          resource: "media",
        })
      ).data[0].id;
      const own = await roles.createRole({
        name: "Ours",
        slug: "ours",
        permissionIds: [String(readMedia)],
      });
      const { roles: rolesTable } = getDialectTables();
      const db = nextly.adapter.getDrizzle() as unknown as {
        delete: (t: unknown) => { where: (c: unknown) => Promise<unknown> };
        update: (t: unknown) => {
          set: (v: unknown) => { where: (c: unknown) => Promise<unknown> };
        };
      };
      await db
        .delete(rolesTable)
        .where(
          eq(
            rolesTable.id,
            (await roles.findRoleIdBySlug(PUBLIC_ROLE_SLUG))!.id
          )
        );
      await db
        .update(rolesTable)
        .set({ slug: PUBLIC_ROLE_SLUG })
        .where(eq(rolesTable.id, own.id));
      const meta = nextly.getService("metaService");
      await meta.delete("public-role-granted");
      await meta.set("public-role-created", {
        claim: "another boot",
        at: new Date().toISOString(),
      });

      await seedPermissionsAndRolePresets();

      const ownHolds = await services(
        nextly
      ).rolePermissions.listRolePermissions(own.id);
      expect(ownHolds.map(p => `${p.action}-${p.resource}`)).toEqual([
        "read-media",
      ]);
    });

    it("grants a read again to a collection made anew under the same slug", async () => {
      const nextly = await boot(dialect);
      await seedPermissionsAndRolePresets();
      // The collection's permissions are removed with it, and made again for
      // the one that takes its slug.
      await removePermission(nextly, "read", "open");

      await seedPermissionsAndRolePresets();

      expect(await publicHolds(nextly)).toContain("read-open");
    });

    it("waits for a target's read and write rules together", async () => {
      await boot(dialect);
      const started = Date.now();
      await seedPermissionsAndRolePresets();
      // `silent` never answers its read or its create: asked one after the
      // other, the two deadlines alone would take four seconds.
      expect(Date.now() - started).toBeLessThan(3500);
    });
  }
);
