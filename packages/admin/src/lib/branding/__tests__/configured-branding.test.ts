// @vitest-environment jsdom
/**
 * The configured branding the page's first HTML carries, as JSON in
 * `#nextly-admin-branding`. Anything that is not that object, and any key that
 * is not a non-empty string, reads as not configured, so a malformed value
 * never reaches a logo's `src` and a page built without the element still
 * works.
 */
import { afterEach, describe, expect, it } from "vitest";

import { readConfiguredBranding } from "../configured-branding";

function carry(json: string): void {
  const element = document.createElement("script");
  element.type = "application/json";
  element.id = "nextly-admin-branding";
  element.textContent = json;
  document.body.append(element);
}

afterEach(() => {
  document.getElementById("nextly-admin-branding")?.remove();
});

describe("reading the configured branding", () => {
  it("reads every key the configuration set", () => {
    carry(
      JSON.stringify({
        logoUrl: "/a.svg",
        logoUrlLight: "/l.svg",
        logoUrlDark: "/d.svg",
        logoText: "Acme",
        favicon: "/i.svg",
      })
    );
    expect(readConfiguredBranding()).toEqual({
      logoUrl: "/a.svg",
      logoUrlLight: "/l.svg",
      logoUrlDark: "/d.svg",
      logoText: "Acme",
      favicon: "/i.svg",
    });
  });

  it("leaves out keys that are not set: empty, blank, or not text", () => {
    carry(
      JSON.stringify({
        logoUrl: "  ",
        logoText: 7,
        favicon: "",
        logoUrlDark: " /d.svg ",
      })
    );
    expect(readConfiguredBranding()).toEqual({ logoUrlDark: "/d.svg" });
  });

  it("ignores keys it does not know, such as colours", () => {
    carry(JSON.stringify({ colors: { primary: "#000" }, logoText: "Acme" }));
    expect(readConfiguredBranding()).toEqual({ logoText: "Acme" });
  });

  it.each([
    ["no element", null],
    ["an empty object", "{}"],
    ["broken JSON", "{logoUrl:"],
    ["an array", '["/a.svg"]'],
    ["a string", '"/a.svg"'],
  ])("reads nothing configured from %s", (_case, json) => {
    if (json !== null) carry(json);
    expect(readConfiguredBranding()).toEqual({});
  });
});
