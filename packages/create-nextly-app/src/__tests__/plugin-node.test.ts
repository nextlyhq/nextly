import { describe, expect, it } from "vitest";

import {
  PLUGIN_NODE_ENGINES,
  pluginNodeRefusal,
  satisfiesNodeRange,
} from "../utils/plugin-node";

describe("the plugin template's Node floor", () => {
  it.each(["20.19.0", "22.12.0", "22.17.1", "23.11.0", "24.10.0", "25.2.0"])(
    "refuses Node %s, naming the floor and how to get past it",
    version => {
      const refusal = pluginNodeRefusal(version);
      expect(refusal).toContain(PLUGIN_NODE_ENGINES);
      expect(refusal).toContain(version);
      expect(refusal).toContain("nvm install 24");
    }
  );

  it.each(["22.18.0", "22.22.2", "24.11.0", "24.22.1", "26.0.0", "27.1.0"])(
    "scaffolds on Node %s",
    version => {
      expect(pluginNodeRefusal(version)).toBeUndefined();
    }
  );

  it("reads a leading v, as process.version writes it", () => {
    expect(satisfiesNodeRange("v24.22.1", PLUGIN_NODE_ENGINES)).toBe(true);
  });

  it("refuses a comparator it does not understand rather than misreading it", () => {
    expect(() => satisfiesNodeRange("24.0.0", "~24.0.0")).toThrow(
      /unsupported/
    );
    expect(() => satisfiesNodeRange("24.0.0", "24.x")).toThrow(/unsupported/);
  });
});
