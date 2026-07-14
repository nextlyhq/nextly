import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BorderControl } from "./BorderControl";

describe("BorderControl", () => {
  it("renders style options, a color input, and four per-side width inputs", () => {
    const html = renderToStaticMarkup(
      <BorderControl label="Border" value={undefined} onChange={() => {}} />
    );
    expect(html).toContain("Border style");
    expect(html).toContain("solid");
    expect(html).toContain("dashed");
    expect(html).toContain('aria-label="Border top width"');
    expect(html).toContain('aria-label="Border color"');
  });

  it("reflects an existing border value, preserving the width unit", () => {
    const html = renderToStaticMarkup(
      <BorderControl
        label="Border"
        value={{ style: "dashed", width: { top: "3px" } }}
        onChange={() => {}}
      />
    );
    // The width is shown verbatim (unit preserved) rather than px-stripped.
    expect(html).toContain('value="3px"');
  });

  it("preserves a non-pixel / token width value", () => {
    const html = renderToStaticMarkup(
      <BorderControl
        label="Border"
        value={{ width: { top: "1rem" }, color: "var(--nx-color-border)" }}
        onChange={() => {}}
      />
    );
    expect(html).toContain('value="1rem"');
    expect(html).toContain('value="var(--nx-color-border)"');
  });
});
