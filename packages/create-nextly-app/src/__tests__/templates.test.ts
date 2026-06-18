import { describe, expect, it } from "vitest";

import {
  getAvailableTemplateNames,
  getTemplate,
  templateHasApproaches,
  templateHasDemoData,
} from "../lib/templates";

describe("plugin template registration (D44)", () => {
  it("is listed among available templates", () => {
    expect(getAvailableTemplateNames()).toContain("plugin");
  });

  it("has the plugin-specific manifest shape", () => {
    const plugin = getTemplate("plugin");
    expect(plugin).toBeDefined();
    expect(plugin?.name).toBe("plugin");
    // Plugins don't ask code-first vs visual, ship no app frontend, no demo data,
    // and bring their own collections.
    expect(plugin?.approaches).toEqual([]);
    expect(plugin?.defaultApproach).toBeNull();
    expect(plugin?.hasFrontendPages).toBe(false);
    expect(plugin?.hasDemoData).toBe(false);
    expect(plugin?.collections).toEqual([]);
  });

  it("skips approach + demo-data prompts", () => {
    expect(templateHasApproaches("plugin")).toBe(false);
    expect(templateHasDemoData("plugin")).toBe(false);
  });
});
