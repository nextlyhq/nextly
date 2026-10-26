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

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../../config";
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

async function boot(dialect: TestDialect): Promise<TestNextly> {
  warnings = [];
  t = await createTestNextly({
    ...(dialect === "sqlite" ? {} : { dialect }),
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
        // Never answers: asked at boot, it is given up on.
        access: { read: () => new Promise<boolean>(() => {}) },
        fields,
      }),
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
  }
);
