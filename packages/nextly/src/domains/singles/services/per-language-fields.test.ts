/**
 * Publishing every language judges a field per language when its component is
 * translated, however the definition spells its reference.
 */
import { describe, expect, it } from "vitest";

import type { FieldConfig } from "../../../collections/fields/types";

import { perLanguageFieldNames } from "./live-shared-single";

const translated = new Set(["banner"]);
const isComponentLocalized = (slug: string) =>
  Promise.resolve(translated.has(slug));

function fields(...defs: Record<string, unknown>[]): FieldConfig[] {
  return defs as unknown as FieldConfig[];
}

describe("perLanguageFieldNames", () => {
  it("counts a field whose component is translated, under every spelling", async () => {
    const names = await perLanguageFieldNames(
      fields(
        { name: "title", type: "text" },
        { name: "current", type: "component", component: "banner" },
        // A definition stored before the keys were renamed.
        { name: "migrated", type: "component", fieldGroup: "banner" },
        { name: "zone", type: "component", fieldGroups: ["card", "banner"] },
        { name: "shared", type: "component", component: "card" }
      ),
      new Set(["title"]),
      isComponentLocalized
    );
    expect([...names].sort()).toEqual(["current", "migrated", "title", "zone"]);
  });

  // A group with no name only lays fields out: a field group in one is stored where it sits.
  it("counts a field whose untranslated component holds a translated one inside a group with no name", async () => {
    const definitions = new Map<string, FieldConfig[]>([
      [
        "card",
        fields(
          { name: "tone", type: "text" },
          {
            type: "group",
            fields: [{ name: "badge", type: "component", component: "banner" }],
          }
        ),
      ],
    ]);
    const names = await perLanguageFieldNames(
      fields({ name: "panel", type: "component", component: "card" }),
      new Set(),
      isComponentLocalized,
      slug => Promise.resolve(definitions.get(slug) ?? null)
    );
    expect([...names]).toEqual(["panel"]);
  });

  it("counts a field with a translated component inside a group with no name", async () => {
    const names = await perLanguageFieldNames(
      fields({
        type: "group",
        fields: [{ name: "hero", type: "component", component: "banner" }],
      }),
      new Set(),
      isComponentLocalized
    );
    expect([...names]).toEqual(["hero"]);
  });
});
