/**
 * Which built-in roles the three AI permissions go to: Admin all three,
 * Editor and Author "Use AI" only, Viewer none. Asked of the preset rules over
 * a permission list holding the AI permissions beside ordinary ones, so a rule
 * that grants too much, or too little, shows here.
 */
import { describe, expect, it } from "vitest";

import {
  ROLE_PRESETS,
  resolvePreset,
  type PresetPermission,
  type PresetReach,
} from "../../../auth/role-presets";
import { isSystemResource } from "../../../schemas/_zod/rbac";
import { AI_PERMISSIONS } from "../../ai/ai-contract";

const OPEN_TO_EVERY_PRESET: PresetReach = { presetsFor: () => undefined };

const AI_ROWS: PresetPermission[] = Object.values(AI_PERMISSIONS).map(
  ({ action, resource }) => ({ action, resource, owner: null })
);

const PERMISSIONS: PresetPermission[] = [
  ...AI_ROWS,
  { action: "update", resource: "posts", owner: null },
  { action: "manage", resource: "background-jobs", owner: null },
  // A plugin's permission that happens to share the spelling: not core's.
  { action: "use", resource: "ai", owner: "some-plugin" },
];

function aiSlugsFor(presetSlug: string): string[] {
  const preset = ROLE_PRESETS.find(p => p.slug === presetSlug);
  if (preset === undefined) throw new Error(`no preset ${presetSlug}`);
  return resolvePreset(preset, PERMISSIONS, OPEN_TO_EVERY_PRESET)
    .filter(p => p.owner === null && AI_ROWS.some(ai => ai.resource === p.resource))
    .map(p => `${p.action}-${p.resource}`)
    .sort();
}

describe("the AI permissions' preset grants", () => {
  it("gives Admin all three", () => {
    expect(aiSlugsFor("admin")).toEqual(
      [
        AI_PERMISSIONS.manage.slug,
        AI_PERMISSIONS.bulk.slug,
        AI_PERMISSIONS.use.slug,
      ].sort()
    );
  });

  it.each(["editor", "author"])("gives %s Use AI and nothing else of AI", slug => {
    expect(aiSlugsFor(slug)).toEqual([AI_PERMISSIONS.use.slug]);
  });

  it("gives Viewer none", () => {
    expect(aiSlugsFor("viewer")).toEqual([]);
  });

  it("never gives Editor or Author a plugin's permission spelled like Use AI", () => {
    for (const slug of ["editor", "author"]) {
      const preset = ROLE_PRESETS.find(p => p.slug === slug);
      if (preset === undefined) throw new Error(`no preset ${slug}`);
      const granted = resolvePreset(preset, PERMISSIONS, OPEN_TO_EVERY_PRESET);
      expect(granted.some(p => p.owner === "some-plugin")).toBe(false);
    }
  });

  it("keeps Editor's and Author's other grants as they were", () => {
    for (const slug of ["editor", "author"]) {
      const preset = ROLE_PRESETS.find(p => p.slug === slug);
      if (preset === undefined) throw new Error(`no preset ${slug}`);
      const granted = resolvePreset(preset, PERMISSIONS, OPEN_TO_EVERY_PRESET);
      expect(granted.map(p => `${p.action}-${p.resource}`).sort()).toEqual(
        ["update-posts", AI_PERMISSIONS.use.slug].sort()
      );
    }
  });

  it("sits every AI permission on a system resource, so no preset reads it as content", () => {
    for (const { resource } of AI_ROWS) {
      expect(isSystemResource(resource)).toBe(true);
    }
  });
});
