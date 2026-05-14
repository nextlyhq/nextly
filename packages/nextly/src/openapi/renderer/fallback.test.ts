import { describe, expect, it } from "vitest";

import { fallbackRenderer } from "./fallback";

describe("fallbackRenderer", () => {
  it("is named 'fallback'", () => {
    expect(fallbackRenderer.name).toBe("fallback");
  });

  it("renders a doctype HTML page with the supplied title", () => {
    const { html } = fallbackRenderer.render({
      specUrl: "https://example.com/admin/api/openapi/openapi.json",
      title: "My App",
    });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>My App</title>");
  });

  it("includes the install instructions and `defineOpenApi` hint", () => {
    const { html } = fallbackRenderer.render({
      specUrl: "https://example.com/admin/api/openapi/openapi.json",
      title: "Nextly API",
    });
    expect(html).toContain("@scalar/api-reference");
    expect(html).toContain("pnpm add @scalar/api-reference");
    expect(html).toContain('defineOpenApi({ ui: "swagger-ui" })');
  });

  it("links both the JSON and YAML spec URLs", () => {
    const { html } = fallbackRenderer.render({
      specUrl: "https://example.com/admin/api/openapi/openapi.json",
      title: "Nextly API",
    });
    expect(html).toContain(
      'href="https://example.com/admin/api/openapi/openapi.json"'
    );
    expect(html).toContain(
      'href="https://example.com/admin/api/openapi/openapi.yaml"'
    );
  });

  it("escapes special characters in the title to prevent XSS", () => {
    const { html } = fallbackRenderer.render({
      specUrl: "https://example.com/spec.json",
      title: "<script>alert(1)</script>",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("escapes spec URLs (defense in depth — they should already be URL-safe)", () => {
    const { html } = fallbackRenderer.render({
      specUrl: 'https://example.com/spec.json"><script>x</script>',
      title: "App",
    });
    expect(html).not.toMatch(/<script>x<\/script>/);
  });

  it("declares no static assets (self-contained)", () => {
    expect(fallbackRenderer.assets()).toEqual(new Map());
  });

  it("emits no <script> tags so the strictest CSP works without a nonce", () => {
    const { html } = fallbackRenderer.render({
      specUrl: "https://example.com/spec.json",
      title: "App",
    });
    expect(html).not.toMatch(/<script\b/i);
  });

  it("returns the original URL as both links when caller passes a non-.json suffix", () => {
    const { html } = fallbackRenderer.render({
      specUrl: "https://example.com/openapi.yaml",
      title: "App",
    });
    // No transformation possible — both links point to the same URL.
    const matches = html.match(/openapi\.yaml/g);
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
