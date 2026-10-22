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
});
