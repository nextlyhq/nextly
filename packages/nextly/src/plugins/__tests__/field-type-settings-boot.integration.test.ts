/**
 * A plugin field type's declared settings are checked where boot registers the
 * type, so a malformed list refuses boot naming the plugin, and a well-formed
 * one boots. Run through the real boot rather than the checker alone, which
 * is what shows the check is wired into registration at all.
 *
 * SQLite only: the check runs before the adapter connects, so no dialect
 * reaches it differently.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { NextlyError } from "../../errors/nextly-error";
import type { PluginDefinition } from "../plugin-context";
import { createTestNextly } from "../test-nextly";

type Booted = Awaited<ReturnType<typeof createTestNextly>>;

/** A plugin contributing one field type with the given settings. */
function ratingPlugin(settings: unknown): PluginDefinition {
  return {
    name: "@acme/rating",
    version: "1.0.0",
    nextly: "*",
    contributes: {
      fieldTypes: [
        {
          type: "star-rating",
          storage: "number",
          component: "@acme/rating/admin#Stars",
          settings,
        },
      ],
    },
  } as unknown as PluginDefinition;
}

describe("plugin field type settings at boot", () => {
  let booted: Booted | undefined;

  afterEach(async () => {
    await booted?.destroy();
    booted = undefined;
  });

  it("boots with a well-formed list", async () => {
    booted = await createTestNextly({
      plugins: [
        ratingPlugin([
          { key: "max", label: "Most stars", control: "number" },
          {
            key: "shape",
            label: "Shape",
            control: "select",
            options: [{ label: "Star", value: "star" }],
          },
        ]),
      ],
    });
    expect(booted.nextly).toBeDefined();
  });

  it.each([
    [
      "a select with no options",
      [{ key: "shape", label: "Shape", control: "select", options: [] }],
    ],
    [
      "a key used twice",
      [
        { key: "max", label: "Most stars", control: "number" },
        { key: "max", label: "Most hearts", control: "number" },
      ],
    ],
    [
      "the reserved key type",
      [{ key: "type", label: "Clash", control: "text" }],
    ],
    [
      "the reserved key name",
      [{ key: "name", label: "Clash", control: "text" }],
    ],
  ])("refuses boot for %s, naming the plugin", async (_case, settings) => {
    const boot = createTestNextly({ plugins: [ratingPlugin(settings)] });
    await expect(boot).rejects.toBeInstanceOf(NextlyError);
    await expect(boot).rejects.toMatchObject({
      code: "CONFIGURATION_ERROR",
      logContext: { plugin: "@acme/rating", fieldType: "star-rating" },
    });
  });
});
