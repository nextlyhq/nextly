import { describe, expect, it } from "vitest";

import { scalarRenderer } from "./scalar";

describe("scalarRenderer", () => {
  it("is named 'scalar'", () => {
    expect(scalarRenderer.name).toBe("scalar");
  });

  it("renders a doctype HTML page with the supplied title", () => {
    const { html } = scalarRenderer.render({
      specUrl: "https://example.com/admin/api/openapi/openapi.json",
      title: "Acme API",
    });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>Acme API</title>");
  });

  it("embeds the spec URL as the api-reference data-url", () => {
    const { html } = scalarRenderer.render({
      specUrl: "https://example.com/admin/api/openapi/openapi.json",
      title: "Acme API",
    });
    expect(html).toContain(
      'data-url="https://example.com/admin/api/openapi/openapi.json"'
    );
    expect(html).toContain('id="api-reference"');
  });

  it("disables Scalar's Agent chat via data-configuration", () => {
    const { html } = scalarRenderer.render({
      specUrl: "https://example.com/spec.json",
      title: "API",
    });
    expect(html).toContain("&quot;agent&quot;:{&quot;disabled&quot;:true}");
  });

  it("hides Scalar's vendor surfaces (sidebar integrations + top toolbar) via customCss", () => {
    const { html } = scalarRenderer.render({
      specUrl: "https://example.com/spec.json",
      title: "API",
    });
    // `.scalar-mcp-layer` = sidebar VS Code / Cursor / Generate MCP panel.
    // `.api-reference-toolbar` = top Developer Tools / Configure / Share /
    // Deploy bar. Both in @scalar/api-reference@1.55.
    expect(html).toContain(
      ".scalar-mcp-layer, .api-reference-toolbar { display: none !important; }"
    );
  });

  it("loads the Scalar bundle from jsdelivr CDN", () => {
    const { html } = scalarRenderer.render({
      specUrl: "https://example.com/spec.json",
      title: "API",
    });
    expect(html).toMatch(
      /<script[^>]+src="https:\/\/cdn\.jsdelivr\.net\/npm\/@scalar\/api-reference"/
    );
  });

  it("applies the theme attribute (defaulting to 'auto')", () => {
    const defaulted = scalarRenderer.render({
      specUrl: "https://example.com/spec.json",
      title: "API",
    });
    expect(defaulted.html).toContain('data-theme="auto"');

    const dark = scalarRenderer.render({
      specUrl: "https://example.com/spec.json",
      title: "API",
      theme: "dark",
    });
    expect(dark.html).toContain('data-theme="dark"');
  });

  it("threads a CSP nonce onto both inline and CDN script tags when supplied", () => {
    const { html } = scalarRenderer.render({
      specUrl: "https://example.com/spec.json",
      title: "API",
      cspNonce: "abc123",
    });
    // Both <script> tags carry the nonce.
    const nonceTagCount = (html.match(/nonce="abc123"/g) ?? []).length;
    expect(nonceTagCount).toBe(2);
  });

  it("omits the nonce attribute entirely when not supplied", () => {
    const { html } = scalarRenderer.render({
      specUrl: "https://example.com/spec.json",
      title: "API",
    });
    expect(html).not.toContain("nonce=");
  });

  it("escapes special characters in title and URL to prevent XSS", () => {
    const { html } = scalarRenderer.render({
      specUrl: 'https://example.com/spec.json"><script>x</script>',
      title: "<script>alert(1)</script>",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    // The URL is attribute-encoded so the closing-quote payload can't break out.
    expect(html).not.toMatch(/<script>x<\/script>/);
  });

  it("declares no static assets (CDN-served)", () => {
    expect(scalarRenderer.assets()).toEqual(new Map());
  });
});
