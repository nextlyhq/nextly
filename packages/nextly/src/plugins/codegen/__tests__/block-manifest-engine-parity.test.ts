/**
 * Generation and registration agree about what they refuse.
 *
 * The rules have to be stated where generation runs, and core states them
 * rather than importing them: reading them from the engine would make every
 * app that installs core carry the block engine so codegen can read a bound
 * and walk a map, and it points the dependency the wrong way, since the plugin
 * layer builds on core and not the reverse.
 *
 * Restating a rule is only safe if it cannot quietly diverge. These are what
 * make that true — moving one side without the other fails here, rather than
 * shipping a generator that reports a tree clean for an app that will not
 * start. The engine is a development dependency for this file alone.
 */
import { findMigrationGaps, MAX_BLOCK_VERSION } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { definePlugin, type PluginDefinition } from "../../plugin-context";
import {
  buildBlockManifest,
  MAX_DECLARED_BLOCK_VERSION,
  PAGE_BUILDER_PLUGIN,
} from "../block-manifest";

describe("the manifest's block-version bound", () => {
  it("is the bound the engine enforces at registration", () => {
    expect(MAX_DECLARED_BLOCK_VERSION).toBe(MAX_BLOCK_VERSION);
  });
});

function consumer(): PluginDefinition {
  return definePlugin({
    name: PAGE_BUILDER_PLUGIN,
    version: "1.0.0",
    nextly: ">=0.0.0",
  });
}

function declaring(blocks: unknown[]): PluginDefinition {
  return definePlugin({
    name: "@acme/blocks",
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: { declarations: { [PAGE_BUILDER_PLUGIN]: { blocks } } },
  });
}

const step = () => ({});

const MIGRATION_CASES: { label: string; version: number; migrate?: unknown }[] =
  [
    { label: "version 1 needing no steps", version: 1 },
    { label: "version 1 with a stray step", version: 1, migrate: { 1: step } },
    { label: "version 2 with no map at all", version: 2 },
    { label: "version 2 with its one step", version: 2, migrate: { 1: step } },
    {
      label: "version 3 missing the first step",
      version: 3,
      migrate: { 2: step },
    },
    {
      label: "version 3 missing the second step",
      version: 3,
      migrate: { 1: step },
    },
    {
      label: "version 3 fully covered",
      version: 3,
      migrate: { 1: step, 2: step },
    },
    {
      label: "version 3 whose step is not a function",
      version: 3,
      migrate: { 1: step, 2: "nope" },
    },
  ];

describe("the manifest's migration-gap rule", () => {
  it.each(MIGRATION_CASES)(
    "reaches the same verdict as the engine for $label",
    ({ version, migrate }) => {
      const engineRefuses =
        findMigrationGaps(
          1,
          version,
          migrate as Parameters<typeof findMigrationGaps>[2]
        ).length > 0;

      let generationRefuses = false;
      try {
        buildBlockManifest([
          consumer(),
          declaring([
            {
              name: "acme/hero",
              version,
              description: "A hero.",
              example: { props: {} },
              migrate,
              render: () => null,
            },
          ]),
        ]);
      } catch {
        generationRefuses = true;
      }

      expect(generationRefuses).toBe(engineRefuses);
    }
  );
});
