/**
 * What the prebuilt admin page carries of the configured branding.
 *
 * The JSON the admin reads before any request answers holds the logo, name
 * and favicon set in the config, and nothing a value could use to end its
 * element early; the metadata carries the favicon's link, so the first HTML
 * already has it.
 */
import { describe, expect, it } from "vitest";

import {
  ADMIN_ROBOTS,
  adminBrandingJson,
  adminMetadataFor,
} from "../admin-metadata";

describe("adminBrandingJson", () => {
  it("carries the configured logo, name and favicon, and nothing unset or blank", () => {
    const json = adminBrandingJson({
      logoUrl: "/logo.svg",
      logoText: "Acme",
      favicon: "/favicon.ico",
      logoUrlDark: "  ",
    });

    expect(JSON.parse(json ?? "")).toEqual({
      logoUrl: "/logo.svg",
      logoText: "Acme",
      favicon: "/favicon.ico",
    });
  });

  it("is nothing when no branding is configured", () => {
    expect(adminBrandingJson(undefined)).toBeNull();
    expect(adminBrandingJson({ logoText: "" })).toBeNull();
  });

  it("cannot end its script element early, and still parses to the same text", () => {
    const logoText = "</script><script>alert(1)</script>";
    const json = adminBrandingJson({ logoText }) ?? "";

    expect(json).not.toContain("</script");
    expect(JSON.parse(json)).toEqual({ logoText });
  });
});

describe("adminMetadataFor", () => {
  it("adds the configured favicon's link beside the robots directives", () => {
    expect(adminMetadataFor({ favicon: "/favicon.ico" })).toEqual({
      robots: ADMIN_ROBOTS,
      icons: { icon: "/favicon.ico" },
    });
  });

  it("is the robots directives alone without a favicon", () => {
    expect(adminMetadataFor(undefined)).toEqual({ robots: ADMIN_ROBOTS });
    expect(adminMetadataFor({ favicon: " " })).toEqual({
      robots: ADMIN_ROBOTS,
    });
  });
});
