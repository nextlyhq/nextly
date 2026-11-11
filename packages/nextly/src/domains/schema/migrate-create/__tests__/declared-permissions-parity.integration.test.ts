/**
 * The permissions a migration snapshot records are the ones a boot seeds, on every configured
 * dialect: the same config goes through both paths, the boot's seeding into the permissions
 * table and `migrate:create`'s record (`declaredPermissionsOf`), and each permission the record
 * holds is a row the seeder wrote, with the same name, description, group and danger flag, and
 * no seeded row of those owners is missing from the record.
 *
 * What separates a correct record from a drifted one is any difference at all: a second spelling
 * of an entity's permissions, a workflow action named another way, a plugin's group defaulted
 * differently, each shows as a row on one side only.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../../../config";
import { definePlugin } from "../../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { reviewWorkflow } from "../../../workflows/preset";
import {
  declaredPermissionsOf,
  type RecordedPermission,
} from "../declared-permissions";

const PLUGIN = "@acme/parity";

let instance: TestNextly | undefined;

afterEach(async () => {
  await instance?.destroy();
  instance = undefined;
});

const collections = [
  defineCollection({
    slug: "dpp_posts",
    fields: [text({ name: "title" })],
    // A workflow is attached only to a collection that keeps drafts.
    status: true,
    versions: { drafts: true },
    workflow: reviewWorkflow(),
  }),
];
const singles = [
  defineSingle({ slug: "dpp_settings", fields: [text({ name: "tagline" })] }),
];
const plugins = [
  definePlugin({
    name: PLUGIN,
    version: "1.0.0",
    nextly: ">=0.0.1",
    contributes: {
      permissions: [
        { action: "export", resource: "dpp-reports", group: "Reports" },
        {
          action: "purge",
          resource: "dpp-reports",
          label: "Purge reports",
          description: "Deletes every report",
          danger: true,
        },
      ],
    },
  }),
];

type Row = RecordedPermission & { slug: string };

/** Every permission the record holds, flattened, by slug. */
function recordedRows(): Row[] {
  const record = declaredPermissionsOf(
    { collections, singles, plugins } as Parameters<
      typeof declaredPermissionsOf
    >[0],
    { collections, singles }
  );
  return [
    ...Object.values(record.collections),
    ...Object.values(record.singles),
    ...Object.values(record.plugins),
    record.app,
  ]
    .flatMap(bySlug => Object.entries(bySlug))
    .map(([slug, p]) => ({ slug, ...p }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

/** The rows the boot seeded for those owners: the test's entities and its plugin. */
async function seededRows(t: TestNextly): Promise<Row[]> {
  const rows = await (t.adapter as unknown as DrizzleAdapter).executeQuery<{
    slug: string;
    action: string;
    resource: string;
    name: string;
    description: string | null;
    permission_group: string | null;
    danger: unknown;
    owner: string | null;
  }>(
    "SELECT slug, action, resource, name, description, permission_group, danger, owner FROM permissions"
  );
  return rows
    .filter(
      row =>
        row.owner === PLUGIN ||
        row.resource === "dpp_posts" ||
        row.resource === "dpp_settings"
    )
    .map(row => ({
      slug: row.slug,
      action: row.action,
      resource: row.resource,
      name: row.name,
      description: row.description,
      group: row.permission_group,
      danger: Boolean(Number(row.danger)),
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

describe.each(getConfiguredTestDialects())(
  "a snapshot's permissions are the ones a boot seeds (%s)",
  dialect => {
    it("records exactly what the seeder writes for each entity, workflow and plugin", async () => {
      instance = await createTestNextly({
        dialect,
        collections,
        singles,
        plugins,
        seedPublic: true,
      });

      const seeded = await seededRows(instance);
      // The fixture reaches every kind the record holds, so the comparison is not of two empties.
      expect(seeded.map(row => row.slug)).toEqual(
        expect.arrayContaining([
          "read-dpp_posts",
          "publish-without-review-dpp_posts",
          "update-dpp_settings",
          "export-dpp-reports",
          "purge-dpp-reports",
        ])
      );
      expect(recordedRows()).toEqual(seeded);
    });
  }
);
