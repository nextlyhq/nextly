/**
 * The package root publishes the widget declaration under the names its
 * authors import.
 *
 * Read through the root, never through the declaration modules: there is no
 * widgets subpath, so the root is the only door, and a name that stops being
 * re-exported there is exactly what this exists to catch.
 */
import { describe, expect, it } from "vitest";

import * as root from "../../../../index";

describe("the widget declaration, from the package root", () => {
  it("publishes defineWidget and the setting builders as widgetSettings", () => {
    expect(typeof root.defineWidget).toBe("function");
    expect(root.widgetSettings.items()).toEqual({
      type: "number",
      defaultValue: 5,
      min: 1,
      max: 10,
    });
  });

  it("does not publish the startup and server-side internals", () => {
    // Checked at startup and run on the server; neither is an author's to call.
    for (const internal of [
      "registerDashboardWidgets",
      "CORE_OWNER",
      "buildCardQuery",
      "resolveCardSettings",
      "assertWidgetDeclarations",
    ]) {
      expect(internal in root, internal).toBe(false);
    }
  });
});
