import { describe, expect, it } from "vitest";

import { resolveFontOptions } from "./options";

describe("resolveFontOptions", () => {
  it("reaches Fontsource and jsDelivr by default, and nothing else", () => {
    const fonts = resolveFontOptions(undefined);
    expect(fonts).not.toBe(false);
    if (fonts === false) return;
    expect(fonts.api.origin).toBe("https://api.fontsource.org");
    expect(fonts.files.origin).toBe("https://cdn.jsdelivr.net");
    expect(fonts.outbound).toEqual(["api.fontsource.org", "cdn.jsdelivr.net"]);
  });

  it("turns the catalogue off", () => {
    expect(resolveFontOptions({ catalogue: false })).toBe(false);
  });

  it("declares a test catalogue's host with its port", () => {
    const fonts = resolveFontOptions({
      catalogue: {
        api: "http://localhost:4567",
        files: "http://localhost:4567",
      },
    });
    expect(fonts !== false && fonts.outbound).toEqual(["localhost:4567"]);
  });

  it.each([
    ["plain http", "http://fonts.example.com"],
    ["a path", "https://fonts.example.com/v1"],
    ["a query", "https://fonts.example.com?x=1"],
    ["a name and password", "https://me:pw@fonts.example.com"],
    ["no scheme", "fonts.example.com"],
    ["a fragment", "https://fonts.example.com#x"],
    ["an empty query", "https://fonts.example.com/?"],
  ])("refuses a host given as %s", (_case, api) => {
    expect(() => resolveFontOptions({ catalogue: { api } })).toThrow(
      "Server configuration error."
    );
  });

  it("lowers a cap and never raises one", () => {
    const fonts = resolveFontOptions({
      limits: { filesPerAdd: 4, bytesPerFile: 50 * 1024 * 1024 },
    });
    expect(fonts !== false && fonts.limits).toMatchObject({
      filesPerAdd: 4,
      bytesPerFile: 2 * 1024 * 1024,
    });
  });
});
