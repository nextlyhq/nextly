import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const css = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../layouts.css"),
  "utf8"
);

const LAYOUTS = [
  "rail-panel",
  "single-sidebar",
  "topbar-sidebar",
  "right-panel",
  "rail-only",
];

describe("layout variations", () => {
  it.each(LAYOUTS)("%s has a scoped block", id => {
    expect(css).toContain(`[data-layout="${id}"]`);
  });

  it("scopes every rule to the admin root", () => {
    const selectors = css.match(/^[^@\s][^{]*\{/gm) ?? [];
    for (const selector of selectors) {
      expect(selector).toContain(".nextly-admin");
    }
  });
});
