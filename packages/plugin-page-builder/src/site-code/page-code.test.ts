/**
 * The site's origin page code is judged from on a write: the configured
 * address's origin, whatever path or slash it carries, so a write judges
 * `'self'` as the editor's check (from the request's origin) does.
 */
import { describe, expect, it } from "vitest";

import { appOrigin } from "./page-code";

describe("the site's origin for page code", () => {
  it("is the configured address's origin", () => {
    expect(appOrigin("https://example.com/")).toBe("https://example.com");
    expect(appOrigin("https://example.com/site/")).toBe("https://example.com");
    expect(appOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("is the local address where none, or none readable, is configured", () => {
    expect(appOrigin(undefined)).toBe("http://localhost");
    expect(appOrigin("not an address")).toBe("http://localhost");
  });
});
