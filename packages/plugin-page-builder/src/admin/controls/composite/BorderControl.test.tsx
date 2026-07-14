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
    expect(html).toContain('aria-label="Border top"');
    expect(html).toContain('aria-label="Border color"');
  });

  it("reflects an existing border value", () => {
    const html = renderToStaticMarkup(
      <BorderControl
        label="Border"
        value={{ style: "dashed", width: { top: "3px" } }}
        onChange={() => {}}
      />
    );
    // selected style option + top width reflected (as the number, px stripped)
    expect(html).toContain('value="3"');
  });
});
