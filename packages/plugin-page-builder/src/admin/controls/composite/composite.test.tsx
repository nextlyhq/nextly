import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BackgroundControl } from "./BackgroundControl";
import { BoxShadowControl, buildShadow } from "./BoxShadowControl";
import { PositionControl } from "./PositionControl";
import { SliderControl } from "./SliderControl";

describe("buildShadow", () => {
  it("serializes a drop shadow", () => {
    expect(
      buildShadow({
        x: "0",
        y: "4",
        blur: "8",
        spread: "0",
        color: "#000",
        inset: false,
      })
    ).toBe("0px 4px 8px 0px #000");
  });

  it("prefixes inset", () => {
    expect(
      buildShadow({
        x: "1",
        y: "1",
        blur: "2",
        spread: "3",
        color: "#111",
        inset: true,
      })
    ).toBe("inset 1px 1px 2px 3px #111");
  });
});

describe("composite controls render (SSR smoke)", () => {
  it("PositionControl renders type options + offset inputs", () => {
    const html = renderToStaticMarkup(
      <PositionControl label="Position" value={undefined} onChange={() => {}} />
    );
    expect(html).toContain('aria-label="Position type"');
    expect(html).toContain("absolute");
    expect(html).toContain('aria-label="Offset top"');
    expect(html).toContain('aria-label="z-index"');
  });

  it("BackgroundControl renders a url input + size/repeat/position selects", () => {
    const html = renderToStaticMarkup(
      <BackgroundControl
        label="Background"
        value={{ url: "/x.jpg" }}
        onChange={() => {}}
      />
    );
    expect(html).toContain('aria-label="Background image URL"');
    expect(html).toContain("/x.jpg");
    expect(html).toContain('aria-label="Background size"');
    expect(html).toContain('aria-label="Background repeat"');
  });

  it("SliderControl renders a range input", () => {
    const html = renderToStaticMarkup(
      <SliderControl label="Opacity" value={"0.5"} onChange={() => {}} />
    );
    expect(html).toContain('type="range"');
    expect(html).toContain('aria-label="Opacity"');
  });

  it("BoxShadowControl renders x/y/blur/spread + color + inset", () => {
    const html = renderToStaticMarkup(
      <BoxShadowControl label="Shadow" value={undefined} onChange={() => {}} />
    );
    expect(html).toContain('aria-label="Shadow x"');
    expect(html).toContain('aria-label="Shadow color"');
    expect(html).toContain('aria-label="Shadow inset"');
  });
});
