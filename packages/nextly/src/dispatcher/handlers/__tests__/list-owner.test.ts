/**
 * Which slugs a list of collections, Singles or field groups is limited to
 * when it asks for the site's own entities or for the plugins'.
 *
 * The properties: the plugins' slugs are the ones they are REGISTERED under
 * (the host's renames applied, as the admin's plugin metadata names them);
 * asking for the plugins' entities narrows the reader's allowlist and never
 * replaces it; asking for the site's leaves the allowlist as it was and denies
 * the plugins' slugs.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors";
import type { PluginDefinition } from "../../../plugins/plugin-context";
import { ownerSlugLists, pluginOwnedSlugs, readListOwner } from "../list-owner";

const forms = {
  name: "@acme/plugin-forms",
  version: "1.0.0",
  contributes: {
    collections: [{ slug: "forms" }, { slug: "submissions" }],
    singles: [{ slug: "settings" }],
    fieldGroups: [{ slug: "address" }],
  },
  renameMap: { forms: "contact-forms", settings: "form-settings" },
} as unknown as PluginDefinition;

const pages = {
  name: "@acme/plugin-pages",
  version: "1.0.0",
  contributes: { collections: [{ slug: "pages" }] },
} as unknown as PluginDefinition;

describe("pluginOwnedSlugs", () => {
  it("names each plugin entity by the slug it is registered under", () => {
    expect(pluginOwnedSlugs("collections", [forms, pages])).toEqual([
      "contact-forms",
      "submissions",
      "pages",
    ]);
    expect(pluginOwnedSlugs("singles", [forms, pages])).toEqual([
      "form-settings",
    ]);
    expect(pluginOwnedSlugs("fieldGroups", [forms, pages])).toEqual([
      "address",
    ]);
  });

  it("names none without plugins", () => {
    expect(pluginOwnedSlugs("collections", [])).toEqual([]);
  });
});

describe("ownerSlugLists", () => {
  const owned = ["contact-forms", "pages"];

  it("for the plugins' entities, keeps only the plugin slugs the reader may read", () => {
    expect(
      ownerSlugLists("plugins", owned, ["posts", "contact-forms"])
    ).toEqual({ slugAllowlist: ["contact-forms"] });
  });

  it("for the plugins' entities, gives a reader allowed none of them nothing", () => {
    // 🔴 Never every plugin row: the intersection with an allowlist that
    // names no plugin entity is empty, and an empty allowlist lists nothing.
    expect(ownerSlugLists("plugins", owned, ["posts"])).toEqual({
      slugAllowlist: [],
    });
    expect(ownerSlugLists("plugins", owned, [])).toEqual({ slugAllowlist: [] });
  });

  it("for the plugins' entities, an unscoped reader gets the plugin slugs", () => {
    expect(ownerSlugLists("plugins", owned, undefined)).toEqual({
      slugAllowlist: owned,
    });
  });

  it("for the plugins' entities with no plugin installed, lists nothing", () => {
    expect(ownerSlugLists("plugins", [], undefined)).toEqual({
      slugAllowlist: [],
    });
  });

  it("for the site's entities, keeps the allowlist as it is and denies the plugin slugs", () => {
    expect(ownerSlugLists("site", owned, ["posts"])).toEqual({
      slugAllowlist: ["posts"],
      slugDenylist: owned,
    });
    expect(ownerSlugLists("site", owned, undefined)).toEqual({
      slugAllowlist: undefined,
      slugDenylist: owned,
    });
    expect(ownerSlugLists("site", owned, [])).toEqual({
      slugAllowlist: [],
      slugDenylist: owned,
    });
  });

  it("without an owner, passes the allowlist through and denies nothing", () => {
    expect(ownerSlugLists(undefined, owned, ["posts"])).toEqual({
      slugAllowlist: ["posts"],
    });
  });
});

describe("readListOwner", () => {
  it("reads the two owners and treats absence as none", () => {
    expect(readListOwner("site")).toBe("site");
    expect(readListOwner("plugins")).toBe("plugins");
    expect(readListOwner(undefined)).toBeUndefined();
    expect(readListOwner("")).toBeUndefined();
  });

  it("refuses any other owner as a validation error", () => {
    expect(() => readListOwner("everyone")).toThrow(
      expect.objectContaining({ code: "VALIDATION_ERROR" })
    );
    try {
      readListOwner("everyone");
    } catch (error) {
      expect(NextlyError.is(error)).toBe(true);
    }
  });
});
