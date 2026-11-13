/**
 * The shapes the device memory accepts, case by case, at their edges.
 *
 * What is kept is drawn on the next visit before any request, so each shape is
 * held exactly: a name of 1 to 200 characters, a link inside the admin, lists
 * no longer than their limits, a schema tag of 1 to 200 characters, and
 * branding text trimmed, non-empty and at most 2,048 characters, where a value
 * that fails is left out rather than refusing the rest. Each refused case sits
 * beside the accepted case at the same edge, so a check that refused
 * everything would fail too. Read through the public calls, as the shell uses
 * them, and once more as a page later reads what an earlier one wrote.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  buildLabel,
  confirmLabels,
  DEVICE_MEMORY_PREFIX,
  recallBranding,
  recallMenu,
  recallSchema,
  rememberBranding,
  rememberMenu,
  rememberSchema,
  REMEMBERED_BRANDING_KEY,
  resetDeviceMemoryForTests,
  type RememberedMenu,
  type ServerLabels,
} from "../device-memory";

const LABELS: ServerLabels = {
  user: "user-1",
  schemaVersion: "7",
  permissionVersion: "perm-a",
};

const MENU: RememberedMenu = {
  rail: [{ id: "dashboard", label: "Dashboard", href: "/admin" }],
  parts: { collections: true, singles: false },
  collections: [
    {
      slug: "posts",
      label: "Posts",
      icon: "FileText",
      group: { slug: "blog", label: "Blog" },
    },
  ],
  singles: [],
};

const name = (length: number): string => "n".repeat(length);

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  resetDeviceMemoryForTests();
  confirmLabels(LABELS);
});

/** The menu with one rail entry's field replaced. */
function withRail(field: string, value: unknown): unknown {
  return { ...MENU, rail: [{ ...MENU.rail[0], [field]: value }] };
}

describe("the menu", () => {
  it.each([
    ["a name of 200 characters", withRail("label", name(200)), true],
    ["a name of 201 characters", withRail("label", name(201)), false],
    ["an empty name", withRail("label", ""), false],
    ["a name that is not text", withRail("id", 7), false],
    ["no icon", withRail("icon", undefined), true],
    ["an empty icon", withRail("icon", ""), false],
    ["a link to `#`", withRail("href", "#"), true],
    ["a link inside the admin", withRail("href", "/admin/media"), true],
    ["a link to another origin", withRail("href", "//evil.example"), false],
    ["an absolute URL", withRail("href", "https://evil.example"), false],
    ["a relative link", withRail("href", "admin/media"), false],
    ["a link of 500 characters", withRail("href", `/${name(499)}`), true],
    ["a link of 501 characters", withRail("href", `/${name(500)}`), false],
    ["no link", withRail("href", undefined), false],
    [
      "64 rail entries",
      { ...MENU, rail: Array.from({ length: 64 }, () => MENU.rail[0]) },
      true,
    ],
    [
      "65 rail entries",
      { ...MENU, rail: Array.from({ length: 65 }, () => MENU.rail[0]) },
      false,
    ],
    [
      "1,000 collections",
      {
        ...MENU,
        collections: Array.from({ length: 1000 }, () => MENU.collections[0]),
      },
      true,
    ],
    [
      "1,001 collections",
      {
        ...MENU,
        collections: Array.from({ length: 1001 }, () => MENU.collections[0]),
      },
      false,
    ],
    [
      "a group with no label",
      {
        ...MENU,
        singles: [{ slug: "home", label: "Home", group: { slug: "g" } }],
      },
      false,
    ],
    ["no parts", { ...MENU, parts: undefined }, false],
    [
      "parts that are not yes or no",
      { ...MENU, parts: { collections: "yes", singles: false } },
      false,
    ],
    ["a list that is not a list", { ...MENU, singles: {} }, false],
  ])("with %s", (_case, menu, kept) => {
    expect(rememberMenu(menu as RememberedMenu)).toBe(kept);
    if (kept) {
      // A later page reads it back, checked again on the way out.
      resetDeviceMemoryForTests();
      confirmLabels(LABELS);
      expect(recallMenu()).toEqual(
        JSON.parse(JSON.stringify(menu)) as RememberedMenu
      );
    } else {
      expect(
        window.localStorage.getItem(`${DEVICE_MEMORY_PREFIX}menu`)
      ).toBeNull();
    }
  });

  it.each([
    ["reads back a stored menu whose shape holds", MENU, MENU],
    [
      "drops a stored menu whose shape no longer holds",
      withRail("href", "//evil.example"),
      undefined,
    ],
  ])("%s", (_case, data, recalled) => {
    window.localStorage.setItem(
      `${DEVICE_MEMORY_PREFIX}menu`,
      JSON.stringify({ labels: { build: buildLabel(), ...LABELS }, data })
    );
    resetDeviceMemoryForTests();
    confirmLabels(LABELS);
    expect(recallMenu()).toEqual(recalled);
  });
});

describe("a schema", () => {
  const PATH = "/collections/posts";

  it.each([
    ["a tag of 200 characters", name(200), { fields: [] }, true],
    ["a tag of 201 characters", name(201), { fields: [] }, false],
    ["an empty tag", "", { fields: [] }, false],
    ["a body that is a list", "tag", [{ name: "title" }], false],
    ["a body that is text", "tag", "fields", false],
    ["no body", "tag", undefined, false],
  ])("with %s", (_case, etag, body, kept) => {
    expect(rememberSchema(PATH, etag, body)).toBe(kept);
    expect(recallSchema(PATH)).toEqual(
      kept ? JSON.parse(JSON.stringify({ etag, body })) : undefined
    );
  });
});

describe("the branding", () => {
  it.each([
    ["trimmed text", { logoText: "  Acme  " }, { logoText: "Acme" }],
    [
      "blank text, left out",
      { logoText: "   ", logoUrl: "/a.svg" },
      { logoUrl: "/a.svg" },
    ],
    ["empty text, left out", { favicon: "" }, {}],
    [
      "text that is not text, left out",
      { logoUrl: 7, logoText: "Acme" },
      { logoText: "Acme" },
    ],
    [
      "text of 2,048 characters",
      { logoText: name(2048) },
      { logoText: name(2048) },
    ],
    ["text of 2,049 characters, left out", { logoText: name(2049) }, {}],
    [
      "text of 2,048 characters once trimmed",
      { logoText: ` ${name(2048)} ` },
      { logoText: name(2048) },
    ],
    ["keys it does not know, left out", { colors: { primary: "#000" } }, {}],
  ])("with %s", (_case, branding, recalled) => {
    expect(rememberBranding(branding as Record<string, unknown>)).toBe(true);
    expect(recallBranding()).toEqual(recalled);
  });

  it("reads a stored value that no longer holds as not set, and keeps the rest", () => {
    window.localStorage.setItem(
      REMEMBERED_BRANDING_KEY,
      JSON.stringify({
        labels: { build: buildLabel() },
        data: { logoText: "", logoUrl: "/a.svg", favicon: 7 },
      })
    );
    resetDeviceMemoryForTests();
    expect(recallBranding()).toEqual({ logoUrl: "/a.svg" });
  });
});
