/**
 * The site's fonts panel is fetched when the Design panel's Fonts tab draws
 * it, not with the editor: loading the editor's panels loads none of the
 * fonts panel's code. Observed through the module loader, as in
 * `site-code-on-demand.test.ts`; the control shows the recording works by
 * recording a studio the panels do import.
 *
 * @module admin/editor/fonts-on-demand.test
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

const imported = vi.hoisted(() => new Set<string>());

vi.mock("./site-style-fonts", async importOriginal => {
  imported.add("site-style-fonts");
  return importOriginal();
});
vi.mock("./site-style-tokens-studio", async importOriginal => {
  imported.add("site-style-tokens-studio");
  return importOriginal();
});

// One import for the file: a module imported once is not imported again.
beforeAll(async () => {
  await import("./editor-panels");
});

describe("the editor's panels", () => {
  it("load none of the fonts panel until it is drawn", () => {
    expect(imported.has("site-style-fonts")).toBe(false);
  });

  it("CONTROL: a studio the panels import is recorded", () => {
    expect(imported.has("site-style-tokens-studio")).toBe(true);
  });
});
