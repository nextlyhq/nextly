import { describe, expect, it } from "vitest";

import { defineCollection, text } from "../../config";
import type { NextlyServiceConfig } from "../../di/register";
import { buildDesiredSnapshotFromConfig } from "../../domains/schema/migrate-create/generate";
import type { FieldConfig } from "../../collections/fields/types";
import { definePlugin } from "../plugin-context";

import { applyPluginSchemaContributions } from "./apply-contributions";

/**
 * D52 participation guard. The schema-snapshot cache short-circuits the runtime
 * push when the desired-schema snapshot is unchanged. Because the fold adds
 * plugin `contributes` entities to the config BEFORE the snapshot is built, a
 * plugin's schema is part of the cache key: identical plugin schema → identical
 * snapshot (cache hit), a changed contributed field → a different snapshot
 * (cache miss / re-push).
 */
type SnapshotEntities = Parameters<typeof buildDesiredSnapshotFromConfig>[0];

const snapshotForPluginFields = (fields: FieldConfig[]) => {
  const plugin = definePlugin({
    name: "@t/widgets",
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: {
      collections: [defineCollection({ slug: "p2_widgets", fields })],
    },
  });
  const config = {
    collections: [],
    singles: [],
    components: [],
  } as unknown as NextlyServiceConfig;

  const merged = applyPluginSchemaContributions(config, [plugin]);
  return buildDesiredSnapshotFromConfig(
    (merged.collections ?? []) as unknown as SnapshotEntities,
    (merged.singles ?? []) as unknown as SnapshotEntities,
    (merged.components ?? []) as unknown as SnapshotEntities,
    "sqlite"
  );
};

describe("plugin entities participate in the schema-snapshot cache key (D52)", () => {
  it("identical contributed schema yields an equal snapshot (cache hit)", () => {
    const a = snapshotForPluginFields([text({ name: "title" })]);
    const b = snapshotForPluginFields([text({ name: "title" })]);
    expect(b).toEqual(a);
    // The config has zero code collections, so a non-empty tables array proves
    // the plugin's contributed collection is represented in the snapshot.
    expect((a as { tables: unknown[] }).tables.length).toBeGreaterThan(0);
  });

  it("a change to a contributed field yields a different snapshot (cache miss)", () => {
    const a = snapshotForPluginFields([text({ name: "title" })]);
    const changed = snapshotForPluginFields([
      text({ name: "title" }),
      text({ name: "subtitle" }),
    ]);
    expect(changed).not.toEqual(a);
  });
});
