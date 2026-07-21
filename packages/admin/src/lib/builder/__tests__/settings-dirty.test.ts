// Why: a settings key that reaches the API but not the dirty check leaves Save
// permanently disabled, which reads as the builder ignoring the change rather
// than as a bug. These lock every key, so the failure mode is a red test.
import { describe, expect, it } from "vitest";

import type { BuilderSettingsValues } from "@admin/components/features/schema-builder/BuilderSettingsModal";

import { settingsAreDirty } from "../settings-dirty";

const base: BuilderSettingsValues = {
  singularName: "Post",
  pluralName: "Posts",
  slug: "posts",
  description: "",
  icon: "FileText",
  category: undefined,
  status: true,
  i18n: false,
  versions: false,
};

describe("settingsAreDirty", () => {
  it("reports nothing dirty for an unchanged copy", () => {
    expect(settingsAreDirty(base, { ...base })).toBe(false);
  });

  it("reports nothing dirty before a baseline has loaded", () => {
    expect(settingsAreDirty(null, base)).toBe(false);
    expect(settingsAreDirty(base, null)).toBe(false);
  });

  // Driven off the value shape rather than a hand-written list, so a key added
  // to BuilderSettingsValues without a matching comparison fails here too.
  const changed: Record<keyof BuilderSettingsValues, BuilderSettingsValues> = {
    singularName: { ...base, singularName: "Article" },
    pluralName: { ...base, pluralName: "Articles" },
    slug: { ...base, slug: "articles" },
    description: { ...base, description: "Now described" },
    icon: { ...base, icon: "Database" },
    category: { ...base, category: "Layout" },
    status: { ...base, status: false },
    i18n: { ...base, i18n: true },
    versions: { ...base, versions: true },
  };

  for (const [key, next] of Object.entries(changed)) {
    it(`reports dirty when ${key} changes`, () => {
      expect(settingsAreDirty(base, next)).toBe(true);
    });
  }
});
