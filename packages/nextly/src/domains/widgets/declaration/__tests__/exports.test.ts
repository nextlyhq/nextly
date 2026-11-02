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
  it("publishes defineWidget, the setting builders and the collections' option", () => {
    expect(typeof root.defineWidget).toBe("function");
    expect(
      root.setting.select({
        label: "Currency",
        options: [root.option("US dollar", "usd")],
        defaultValue: "usd",
      })
    ).toEqual({
      type: "select",
      label: "Currency",
      defaultValue: "usd",
      options: [{ label: "US dollar", value: "usd" }],
    });
    // The old name is gone rather than kept beside the new one.
    expect("widgetSettings" in root).toBe(false);
  });

  it("does not publish the startup and server-side internals", () => {
    // Checked at startup and run on the server; neither is an author's to call.
    for (const internal of [
      "registerDashboardWidgets",
      "CORE_OWNER",
      "resolveCardSettings",
      "unsetSetting",
      "assertWidgetDeclarations",
    ]) {
      expect(internal in root, internal).toBe(false);
    }
  });
});
