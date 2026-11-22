/**
 * The site's code section is fetched when the Site tab draws it, not with the
 * editor: loading the settings dialog's module loads none of the section's
 * code. Observed through the module loader, as in
 * `../entry-loads-registration-only.test.ts`; the control shows the recording
 * works by recording a module the dialog does import.
 *
 * @module admin/editor/site-code-on-demand.test
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

const imported = vi.hoisted(() => new Set<string>());

vi.mock("./site-code-settings", async importOriginal => {
  imported.add("site-code-settings");
  return importOriginal();
});
vi.mock("../site-code-client", async importOriginal => {
  imported.add("site-code-client");
  return importOriginal();
});
vi.mock("./breakpoint-removal-step", async importOriginal => {
  imported.add("breakpoint-removal-step");
  return importOriginal();
});

// One import for the file: a module imported once is not imported again.
beforeAll(async () => {
  await import("./settings-dialog");
});

describe("the settings dialog", () => {
  it("loads none of the site's code section until it is drawn", () => {
    expect(
      ["site-code-settings", "site-code-client"].filter(name =>
        imported.has(name)
      )
    ).toEqual([]);
  });

  it("CONTROL: a module the dialog imports is recorded", () => {
    expect(imported.has("breakpoint-removal-step")).toBe(true);
  });
});
