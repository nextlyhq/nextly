import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { MAX_SVG_BYTES, sanitizeSvg, SvgTooLargeError } from "./sanitize-svg";

const loadFixture = (name: string): Buffer =>
  readFileSync(join(__dirname, "__tests__/fixtures/svg", name));

function assertNoDangerous(output: string): void {
  expect(output).not.toMatch(/<script\b/i);
  expect(output).not.toMatch(/<foreignObject\b/i);
  expect(output).not.toMatch(/<iframe\b/i);
  expect(output).not.toMatch(/<object\b/i);
  expect(output).not.toMatch(/<embed\b/i);
  expect(output).not.toMatch(/<animate\b/i);
  expect(output).not.toMatch(/<animateMotion\b/i);
  expect(output).not.toMatch(/<image\b/i);
  // No event handlers.
  expect(output).not.toMatch(/\bon[a-z]+\s*=/i);
  // No external href.
  expect(output).not.toMatch(/href\s*=\s*["']https?:/i);
  expect(output).not.toMatch(/href\s*=\s*["']data:/i);
  expect(output).not.toMatch(/href\s*=\s*["']javascript:/i);
  expect(output).not.toMatch(/xlink:href\s*=\s*["']https?:/i);
  expect(output).not.toMatch(/xlink:href\s*=\s*["']data:/i);
}

describe("sanitizeSvg — adversarial fixtures", () => {
  it("strips onload and onmouseover", async () => {
    const dirty = loadFixture("xss-onload.svg");
    const clean = (await sanitizeSvg(dirty)).toString("utf8");
    assertNoDangerous(clean);
    expect(clean).toMatch(/<rect/);
  });

  it("strips <script> tags", async () => {
    const dirty = loadFixture("xss-script-tag.svg");
    const clean = (await sanitizeSvg(dirty)).toString("utf8");
    assertNoDangerous(clean);
    expect(clean).toMatch(/<rect/);
  });

  it("strips <foreignObject>", async () => {
    const dirty = loadFixture("xss-foreign-object.svg");
    const clean = (await sanitizeSvg(dirty)).toString("utf8");
    assertNoDangerous(clean);
  });

  it("strips external <use href>", async () => {
    const dirty = loadFixture("xss-use-external.svg");
    const clean = (await sanitizeSvg(dirty)).toString("utf8");
    assertNoDangerous(clean);
  });

  it("strips external <image href>", async () => {
    const dirty = loadFixture("xss-image-external.svg");
    const clean = (await sanitizeSvg(dirty)).toString("utf8");
    assertNoDangerous(clean);
  });

  it("strips <animate> elements", async () => {
    const dirty = loadFixture("xss-animate.svg");
    const clean = (await sanitizeSvg(dirty)).toString("utf8");
    assertNoDangerous(clean);
  });

  it("strips data: URIs in href", async () => {
    const dirty = loadFixture("xss-data-uri.svg");
    const clean = (await sanitizeSvg(dirty)).toString("utf8");
    assertNoDangerous(clean);
  });

  it("strips DOCTYPE and external CSS @import url()", async () => {
    const dirty = loadFixture("xss-css-expression.svg");
    const clean = (await sanitizeSvg(dirty)).toString("utf8");
    expect(clean).not.toMatch(/<!DOCTYPE/i);
    expect(clean).not.toMatch(/@import\s+url/i);
  });

  it("strips DOCTYPE billion-laughs entity declarations", async () => {
    const dirty = loadFixture("xml-billion-laughs.svg");
    const clean = (await sanitizeSvg(dirty)).toString("utf8");
    expect(clean).not.toMatch(/<!DOCTYPE/i);
    expect(clean).not.toMatch(/<!ENTITY/i);
  });
});

describe("sanitizeSvg — legitimate fixtures round-trip", () => {
  it("preserves the legitimate logo path", async () => {
    const dirty = loadFixture("legitimate-logo.svg");
    const clean = (await sanitizeSvg(dirty)).toString("utf8");
    assertNoDangerous(clean);
    expect(clean).toMatch(/<path/);
    // Distinctive path data survives.
    expect(clean).toMatch(/M12 1\.5a5\.25/);
  });

  it("preserves gradients, filters, and internal <use> refs", async () => {
    const dirty = loadFixture("legitimate-gradient.svg");
    const clean = (await sanitizeSvg(dirty)).toString("utf8");
    assertNoDangerous(clean);
    expect(clean).toMatch(/<linearGradient/);
    expect(clean).toMatch(/<stop/);
    expect(clean).toMatch(/<feGaussianBlur/);
    // Internal #fragment <use> survives.
    expect(clean).toMatch(/<use[^>]*href=["']#grad["']/);
  });
});

describe("sanitizeSvg — invariants", () => {
  it("is idempotent", async () => {
    const dirty = loadFixture("xss-script-tag.svg");
    const once = await sanitizeSvg(dirty);
    const twice = await sanitizeSvg(once);
    expect(twice.toString("utf8")).toBe(once.toString("utf8"));
  });

  it("rejects oversize SVG with SvgTooLargeError", async () => {
    const huge = Buffer.alloc(MAX_SVG_BYTES + 1, "x");
    await expect(sanitizeSvg(huge)).rejects.toBeInstanceOf(SvgTooLargeError);
  });

  it("returns a non-empty buffer for SVG that contains only a script", async () => {
    // DOMPurify keeps the empty <svg> wrapper after stripping <script>,
    // so this isn't actually "empty after sanitize". Verify we don't
    // throw and we return some bytes.
    const onlyScript = Buffer.from(
      `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>`,
      "utf8"
    );
    const out = await sanitizeSvg(onlyScript);
    expect(out.length).toBeGreaterThan(0);
    expect(out.toString("utf8")).not.toMatch(/<script/i);
  });
});
