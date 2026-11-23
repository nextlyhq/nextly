/**
 * The preset roles reach a collection only once it is opened to them by name,
 * and a site set up before that rule keeps every grant its presets held.
 *
 * On every dialect this process can reach:
 * - a collection added with no `grants` gives Admin, Editor, Author and
 *   Viewer nothing, and a start after does not hand it to them;
 * - `grants.presets` opens it to exactly the presets named, each by its own
 *   rule, and the app's `presetGrants` opens a collection by slug;
 * - Viewer reads neither the staff accounts nor the API keys;
 * - on a site an earlier release set the grants on, the first run of this one
 *   records which presets held each collection, before any grant is set, and
 *   keeps them: no editor loses a collection, a collection that site had not
 *   opened stays closed, and `grants.presets: []` closes a kept one;
 * - the seeding warns of the collections kept only by that record, and
 *   names those nothing opens.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../config";
import { seedRolePresets } from "../../database/seeders/role-presets";
import { MetaService } from "../../domains/meta/services/meta-service";
import { seedPermissionsAndRolePresets } from "../../init/seed-permissions";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../plugins/test-nextly";
import { ServiceContainer } from "../../services/index";

const quiet = { debug() {}, info() {}, warn() {}, error() {} };

const PRESETS = ["admin", "editor", "author", "viewer"] as const;

/** The collections every case boots with. */
const COLLECTIONS = [
  // Nothing opens it.
  defineCollection({ slug: "spd-private", fields: [text({ name: "title" })] }),
  // Opened to Viewer alone.
  defineCollection({
    slug: "spd-team",
    fields: [text({ name: "title" })],
    grants: { presets: ["viewer"] },
  }),
  // Opened to none, said outright.
  defineCollection({
    slug: "spd-closed",
    fields: [text({ name: "title" })],
    grants: { presets: [] },
  }),
];

function adapterOf(handle: TestNextly): DrizzleAdapter {
  return handle.adapter as unknown as DrizzleAdapter;
}

function services(handle: TestNextly): ServiceContainer {
  return new ServiceContainer(adapterOf(handle));
}

/** The permission slugs the preset `slug` holds, sorted. */
async function held(handle: TestNextly, slug: string): Promise<string[]> {
  const role = await services(handle).roles.findRoleIdBySlug(slug);
  if (!role) throw new Error(`the ${slug} preset was not seeded`);
  return (
    await services(handle).rolePermissions.listRolePermissions(String(role.id))
  )
    .map(p => `${p.action}-${p.resource}`)
    .sort();
}

/** Of what `slug` holds, the permissions on collection `collection`. */
async function heldOn(
  handle: TestNextly,
  slug: string,
  collection: string
): Promise<string[]> {
  return (await held(handle, slug)).filter(p => p.endsWith(`-${collection}`));
}

/**
 * Leaves the presets as a release from before this rule would have: each
 * preset given its usual share of `collection`, and no grandfather record.
 */
async function asAnEarlierRelease(
  handle: TestNextly,
  collection: string
): Promise<void> {
  const container = services(handle);
  const share: Record<(typeof PRESETS)[number], string[]> = {
    admin: ["create", "read", "update", "delete"],
    editor: ["create", "read", "update", "delete"],
    author: ["create", "read", "update"],
    viewer: ["read"],
  };
  for (const preset of PRESETS) {
    const role = await container.roles.findRoleIdBySlug(preset);
    if (!role) throw new Error(`the ${preset} preset was not seeded`);
    for (const action of share[preset]) {
      await container.rolePermissions.addPermissionToRole(String(role.id), {
        action,
        resource: collection,
      });
    }
  }
  await new MetaService(adapterOf(handle), quiet).delete(
    "preset-grants-grandfathered"
  );
}

describe.each(getConfiguredTestDialects())(
  "the preset roles and new collections (%s)",
  dialect => {
    let handle: TestNextly | undefined;

    afterEach(async () => {
      await handle?.destroy();
      handle = undefined;
    });

    async function boot(): Promise<TestNextly> {
      handle = await createTestNextly({
        ...(dialect === "sqlite"
          ? {}
          : { dialect: dialect as "postgresql" | "mysql" }),
        collections: COLLECTIONS,
      });
      await seedPermissionsAndRolePresets();
      return handle;
    }

    it("gives no preset a collection nothing opens, start after start", async () => {
      const h = await boot();
      // The permissions exist: the presets are kept from them, not missing them.
      const stored = await services(h).permissions.listPermissions({
        limit: 100000,
      });
      expect(stored.data.map(p => `${p.action}-${p.resource}`)).toContain(
        "read-spd-private"
      );
      for (const preset of PRESETS) {
        expect(await heldOn(h, preset, "spd-private"), preset).toEqual([]);
        expect(await heldOn(h, preset, "spd-closed"), preset).toEqual([]);
      }
      // A second start's seeding does not hand it to them either.
      await seedRolePresets(adapterOf(h), quiet, { collections: COLLECTIONS });
      for (const preset of PRESETS) {
        expect(await heldOn(h, preset, "spd-private"), preset).toEqual([]);
      }
    });

    it("opens a collection to exactly the presets its grants name, each by its own rule", async () => {
      const h = await boot();
      expect(await heldOn(h, "viewer", "spd-team")).toEqual(["read-spd-team"]);
      for (const preset of ["admin", "editor", "author"]) {
        expect(await heldOn(h, preset, "spd-team"), preset).toEqual([]);
      }
    });

    it("opens a collection named in the app's presetGrants, over its own grants", async () => {
      const h = await boot();
      await seedRolePresets(adapterOf(h), quiet, {
        collections: COLLECTIONS,
        presetGrants: { "spd-private": ["author"], "spd-team": [] },
      });
      expect(await heldOn(h, "author", "spd-private")).toEqual([
        "create-spd-private",
        "read-spd-private",
        "update-spd-private",
      ]);
      expect(await heldOn(h, "viewer", "spd-team")).toEqual([]);
    });

    it("keeps Viewer from the staff accounts and the API keys, and Admin's read of them as it was", async () => {
      const h = await boot();
      const viewer = await held(h, "viewer");
      expect(viewer).not.toContain("read-users");
      expect(viewer).not.toContain("read-api-keys");
      expect(viewer).toContain("read-media");
      expect(await held(h, "admin")).toContain("read-users");
    });

    it("keeps an earlier release's preset grants, closes what that site had not opened, and says which", async () => {
      const h = await boot();
      // An earlier release gave the presets their share of these two, and
      // nothing of spd-private.
      await asAnEarlierRelease(h, "spd-team");
      await asAnEarlierRelease(h, "spd-closed");
      const warnings: string[] = [];
      const infos: string[] = [];
      const logger = {
        ...quiet,
        warn: (m: string) => warnings.push(m),
        info: (m: string) => infos.push(m),
      };
      // The first run of this release, with a collection the configuration
      // does not speak for: spd-team loses its own grants line to show the
      // record alone keeps it.
      const declared = {
        collections: COLLECTIONS.map(c =>
          c.slug === "spd-team" ? { slug: c.slug } : c
        ),
      };
      await seedRolePresets(adapterOf(h), logger, declared);

      // Each kept preset holds what its own rule grants: the editor its
      // publishing too, as the earlier release's editor did.
      expect(await heldOn(h, "editor", "spd-team")).toEqual(
        expect.arrayContaining([
          "create-spd-team",
          "delete-spd-team",
          "read-spd-team",
          "update-spd-team",
        ])
      );
      expect(await heldOn(h, "author", "spd-team")).toEqual([
        "create-spd-team",
        "read-spd-team",
        "update-spd-team",
      ]);
      expect(await heldOn(h, "viewer", "spd-team")).toEqual(["read-spd-team"]);
      // `presets: []` closes a kept collection; one the site had not opened
      // stays closed.
      for (const preset of PRESETS) {
        expect(await heldOn(h, preset, "spd-closed"), preset).toEqual([]);
        expect(await heldOn(h, preset, "spd-private"), preset).toEqual([]);
      }
      // Kept only by the record: a warning. Opened by nothing: information.
      const warned = warnings.join("\n");
      const told = infos.join("\n");
      expect(warned).toMatch(/"spd-team": admin, author, editor, viewer/);
      expect(warned).not.toMatch(/"spd-private"|"spd-closed"/);
      expect(told).toMatch(/"spd-private"/);
      expect(told).not.toMatch(/"spd-closed"|"spd-team"/);

      // The record is written once: a later run keeps it whatever the presets
      // hold by then.
      await seedRolePresets(adapterOf(h), quiet, declared);
      expect(await heldOn(h, "editor", "spd-team")).toContain(
        "delete-spd-team"
      );
    });
  }
);
