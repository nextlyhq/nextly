import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const css = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../densities.css"),
  "utf8"
);

describe("density variations", () => {
  it.each(["compact", "default", "comfortable"])("%s has a block", id => {
    expect(css).toContain(`[data-density="${id}"]`);
  });

  it("drives control size from the single height knob", () => {
    expect(css).toContain("--nx-control-height");
  });
});
