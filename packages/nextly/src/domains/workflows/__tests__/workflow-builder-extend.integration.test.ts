/**
 * A boot refused for its workflows writes nothing, including the Builder
 * reconcile's writes: a plugin field extended onto a Builder-owned collection
 * or component is not materialized for a configuration the boot refuses. And
 * a field a plugin extends onto a Builder-owned component is judged as part
 * of that component, as the runtime will read it.
 *
 * SQLite only: the order of the boot's steps is the same on every dialect,
 * and the Builder seed helpers build SQLite tables.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, fieldGroup, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import { clearServices } from "../../../di/register";
import { ensureFirstRunSetup } from "../../../init/first-run";
import type { PluginDefinition } from "../../../plugins/plugin-context";
import {
  seedBuilderCollection,
  seedBuilderComponent,
} from "../../../plugins/__tests__/seed-builder-entity";
import type { Logger } from "../../../services/shared";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { reviewWorkflow } from "../preset";

const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

type Adapter = Awaited<ReturnType<typeof createAdapter>>;

let current: TestNextly | undefined;
let inspector: Adapter | undefined;
let dir: string | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
  await inspector?.disconnect();
  inspector = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

/** One field a plugin's `extend` adds. */
type ExtendedField = NonNullable<
  NonNullable<PluginDefinition["contributes"]>["extend"]
>[number]["fields"][number];

/** A plugin that extends `target` with one field. */
const extendPlugin = (
  target: string,
  field: ExtendedField
): PluginDefinition => ({
  name: "@t/extend",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: { extend: [{ target, fields: [field] }] },
});

/**
 * An adapter on this test's database file. On a file, not in memory: a
 * refused boot disconnects the adapter it was given, and a second adapter on
 * the same file reads what the boot left.
 */
async function adapterOnFile(): Promise<Adapter> {
  dir ??= mkdtempSync(join(tmpdir(), "nextly-workflow-builder-"));
  process.env.DB_DIALECT = "sqlite";
  return createAdapter({
    type: "sqlite",
    url: `file:${join(dir, "test.db")}`,
  } as Parameters<typeof createAdapter>[0]);
}

/** What the refused boot left, read through a connection of the test's own. */
async function leftBehind(): Promise<Adapter> {
  inspector = await adapterOnFile();
  return inspector;
}

async function columnsOf(adapter: Adapter, table: string): Promise<string[]> {
  const rows = await adapter.executeQuery<{ name: string }>(
    `PRAGMA table_info(${table})`
  );
  return rows.map(row => row.name);
}

async function storedFieldNames(
  adapter: Adapter,
  table: "dynamic_collections" | "dynamic_components",
  slug: string
): Promise<string[]> {
  const rows = await adapter.executeQuery<{ fields: string }>(
    `SELECT fields FROM ${table} WHERE slug='${slug}'`
  );
  return (JSON.parse(rows[0].fields) as { name: string }[]).map(f => f.name);
}

describe("a boot refused for its workflows, beside a Builder reconcile (sqlite)", () => {
  it("adds no plugin field to a Builder collection", async () => {
    const adapter = await adapterOnFile();
    await ensureFirstRunSetup({ adapter, logger: silentLogger });
    await seedBuilderCollection(adapter, {
      slug: "articles",
      fields: [{ name: "body", type: "text", source: "ui" }],
    });

    const boot = createTestNextly({
      adapter,
      plugins: [extendPlugin("articles", { name: "meta_title", type: "text" })],
      collections: [
        defineCollection({
          slug: "notes",
          status: true,
          workflow: reviewWorkflow(),
          fields: [text({ name: "title" })],
        }),
      ],
    });
    await expect(boot).rejects.toMatchObject({
      publicData: {
        errors: [{ path: "collections.notes.workflow" }],
      },
    });

    const after = await leftBehind();
    expect(await columnsOf(after, "dc_articles")).not.toContain("meta_title");
    expect(
      await storedFieldNames(after, "dynamic_collections", "articles")
    ).not.toContain("meta_title");
  });

  it("judges a password field a plugin extends onto a Builder component, and writes nothing", async () => {
    // Components seed through the registry service, which only a boot wires.
    const seeding = await adapterOnFile();
    current = await createTestNextly({ adapter: seeding });
    await seedBuilderComponent(seeding, {
      slug: "hero",
      fields: [{ name: "body", type: "text", source: "ui" }],
    });
    await current.destroy();
    current = undefined;
    clearServices();

    const boot = createTestNextly({
      adapter: await adapterOnFile(),
      plugins: [extendPlugin("hero", { name: "secret", type: "password" })],
      collections: [
        defineCollection({
          slug: "members",
          status: true,
          versions: { drafts: true },
          workflow: reviewWorkflow(),
          fields: [
            text({ name: "title" }),
            fieldGroup({ name: "banner", component: "hero" }),
          ],
        }),
      ],
    });
    await expect(boot).rejects.toMatchObject({
      publicData: {
        errors: [
          {
            path: "collections.members.workflow",
            message:
              "`review` cannot be attached to `members`: its component `hero` has a password field, so it cannot keep a draft beside the live version.",
          },
        ],
      },
    });

    const after = await leftBehind();
    expect(await columnsOf(after, "comp_hero")).not.toContain("secret");
    expect(
      await storedFieldNames(after, "dynamic_components", "hero")
    ).not.toContain("secret");
  });
});
