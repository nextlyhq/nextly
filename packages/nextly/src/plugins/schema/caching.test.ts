import { dequal } from "dequal";
import { describe, expect, it } from "vitest";

import type { FieldConfig } from "../../collections/fields/types";
import { defineCollection, text } from "../../config";
import type { NextlyServiceConfig } from "../../di/register";
import { buildDesiredSnapshotFromConfig } from "../../domains/schema/migrate-create/generate";
import {
  clearCachedSnapshot,
  getCachedSnapshot,
  setCachedSnapshot,
} from "../../init/schema-snapshot-cache";
import { definePlugin } from "../plugin-context";

import { applyPluginSchemaContributions } from "./apply-contributions";

/**
 * D52 cache participation. The runtime short-circuits the schema push when the
 * freshly-built desired snapshot `dequal`-matches the cached one. Because the
 * fold adds plugin `contributes` entities to the config BEFORE the snapshot is
 * built, a plugin's schema is part of the cache key: an identical reboot is a
 * cache hit (push skipped); a changed contributed field is a miss (re-push).
 *
 * NOTE: the end-to-end "boot twice, assert no DDL" approach is intentionally
 * NOT used — `createTestNextly` clears this cache on every boot (each boot is a
 * distinct in-memory DB, see test-nextly.ts), so a cross-boot hit cannot occur
 * there. We instead drive the cache functions + `dequal` (the exact comparator
 * `pushschema-pipeline` uses to short-circuit) on plugin-derived snapshots.
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

describe("plugin entities participate in the schema-snapshot cache", () => {
  it("a reboot with identical plugin schema is a cache hit (dequal match → push skipped)", () => {
    clearCachedSnapshot();
    const firstBoot = snapshotForPluginFields([text({ name: "title" })]);
    setCachedSnapshot(firstBoot); // first boot populates the cache

    const secondBoot = snapshotForPluginFields([text({ name: "title" })]);
    expect(dequal(getCachedSnapshot(), secondBoot)).toBe(true);

    // The config has zero code collections, so a non-empty tables array proves
    // the plugin's contributed collection is actually in the cached snapshot.
    expect((firstBoot as { tables: unknown[] }).tables.length).toBeGreaterThan(
      0
    );
  });

  it("a reboot after a contributed-field change is a cache miss (re-push)", () => {
    clearCachedSnapshot();
    setCachedSnapshot(snapshotForPluginFields([text({ name: "title" })]));

    const changedBoot = snapshotForPluginFields([
      text({ name: "title" }),
      text({ name: "subtitle" }),
    ]);
    expect(dequal(getCachedSnapshot(), changedBoot)).toBe(false);
  });
});
