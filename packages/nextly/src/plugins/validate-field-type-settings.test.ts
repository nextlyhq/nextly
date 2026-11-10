import { describe, expect, it } from "vitest";

import { NextlyError } from "../errors/nextly-error";

import type { PluginDefinition } from "./plugin-context";
import { RESERVED_PLUGIN_OPTION_KEYS } from "./plugin-options";
import { assertFieldTypeSettings } from "./validate-field-type-settings";

function asPlugins(defs: unknown[]): PluginDefinition[] {
  return defs as PluginDefinition[];
}

/** A plugin contributing one field type with the given settings. */
function plugin(settings: unknown, extra: Record<string, unknown> = {}) {
  return {
    name: "@acme/rating",
    version: "1.0.0",
    nextly: "*",
    ...extra,
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
  };
}

/** The error a refused declaration throws, so its message can be read. */
function refusal(settings: unknown): NextlyError {
  try {
    assertFieldTypeSettings(asPlugins([plugin(settings)]));
  } catch (error) {
    if (error instanceof NextlyError) return error;
    throw error;
  }
  throw new Error("assertFieldTypeSettings accepted the declaration");
}

const max = { key: "max", label: "Most stars", control: "number" } as const;

describe("assertFieldTypeSettings", () => {
  it("accepts a well-formed list of every control", () => {
    expect(() =>
      assertFieldTypeSettings(
        asPlugins([
          plugin([
            max,
            {
              key: "half",
              label: "Half stars",
              control: "boolean",
              tab: "display",
            },
            {
              key: "caption",
              label: "Caption",
              control: "text",
              help: "Shown under the stars.",
            },
            {
              key: "shape",
              label: "Shape",
              control: "select",
              options: [
                { label: "Star", value: "star" },
                { label: "Heart", value: "heart" },
              ],
            },
          ]),
        ])
      )
    ).not.toThrow();
  });

  it("accepts a type that declares no settings", () => {
    expect(() =>
      assertFieldTypeSettings(asPlugins([plugin(undefined)]))
    ).not.toThrow();
  });

  it("refuses a select with no options, naming the plugin, the type and the setting", () => {
    const error = refusal([
      { key: "shape", label: "Shape", control: "select", options: [] },
    ]);
    expect(error.code).toBe("CONFIGURATION_ERROR");
    expect(error.publicMessage).toBe("Plugin configuration is invalid.");
    expect(error.logMessage).toMatch(/"@acme\/rating"/);
    expect(error.logMessage).toMatch(/"star-rating"/);
    expect(error.logMessage).toMatch(/at least one option/);
    expect(error.logContext).toMatchObject({ key: "shape" });
  });

  it("refuses a select that declares no options at all", () => {
    const error = refusal([
      { key: "shape", label: "Shape", control: "select" },
    ]);
    expect(error.logContext).toMatchObject({ key: "shape" });
  });

  it("refuses a key used twice", () => {
    const error = refusal([max, { ...max, label: "Most hearts" }]);
    expect(error.logMessage).toMatch(/"max" a second time/);
    expect(error.logContext).toMatchObject({ index: 1, key: "max" });
  });

  // Every key core reserves inside `pluginOptions`, read from the set the
  // manifest and option folding enforce, so a key core adds is covered here too.
  it.each([...RESERVED_PLUGIN_OPTION_KEYS])(
    "refuses the reserved key %s",
    key => {
      const error = refusal([{ key, label: "Clash", control: "text" }]);
      expect(error.logMessage).toMatch(new RegExp(`reserved key "${key}"`));
    }
  );

  it("refuses an option value offered twice", () => {
    const error = refusal([
      {
        key: "shape",
        label: "Shape",
        control: "select",
        options: [
          { label: "Star", value: "star" },
          { label: "Also star", value: "star" },
        ],
      },
    ]);
    expect(error.logMessage).toMatch(/"star" twice/);
  });

  it("refuses a key that is not one name", () => {
    const error = refusal([
      { key: "max stars", label: "Most", control: "number" },
    ]);
    expect(error.logMessage).toMatch(/letters, digits and _/);
  });

  it("refuses an unknown control", () => {
    const error = refusal([{ key: "max", label: "Most", control: "slider" }]);
    expect(error.logContext).toMatchObject({ key: "max" });
  });

  it("refuses a list that is not a list", () => {
    const error = refusal({ max });
    expect(error.logMessage).toMatch(/not in a list/);
  });

  it("checks a disabled plugin's types too, whose fields still open", () => {
    expect(() =>
      assertFieldTypeSettings(
        asPlugins([plugin([max, max], { enabled: false })])
      )
    ).toThrow(NextlyError);
  });
});
