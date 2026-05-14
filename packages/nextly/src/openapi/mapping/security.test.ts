import { describe, expect, it } from "vitest";

import { buildSecuritySchemes } from "./security";

describe("buildSecuritySchemes", () => {
  const { securitySchemes } = buildSecuritySchemes();

  it("declares exactly the three auth schemes Nextly supports", () => {
    expect(Object.keys(securitySchemes).sort()).toEqual([
      "apiKeyAuth",
      "bearerAuth",
      "cookieAuth",
    ]);
  });

  it("bearerAuth is http/bearer/JWT", () => {
    expect(securitySchemes.bearerAuth).toMatchObject({
      type: "http",
      scheme: "bearer",
      bearerFormat: "JWT",
    });
  });

  it("cookieAuth points at the nextly_access_token cookie", () => {
    expect(securitySchemes.cookieAuth).toMatchObject({
      type: "apiKey",
      in: "cookie",
      name: "nextly_access_token",
    });
  });

  it("apiKeyAuth uses the X-API-Key header", () => {
    expect(securitySchemes.apiKeyAuth).toMatchObject({
      type: "apiKey",
      in: "header",
      name: "X-API-Key",
    });
  });

  it("each scheme has a non-empty description", () => {
    for (const [name, scheme] of Object.entries(securitySchemes)) {
      expect(
        (scheme as { description?: string }).description,
        `${name} missing description`
      ).toBeTruthy();
    }
  });
});
