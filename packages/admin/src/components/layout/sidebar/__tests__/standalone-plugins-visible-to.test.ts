/**
 * Which standalone plugins the rail offers: those naming a collection the
 * server's answer lets the reader read, and those naming none to a reader who
 * may see the settings.
 *
 * The property that separates it from the slug reading it replaced is a role
 * holding `read-posts` while the collection's code rule refuses the read: the
 * slug says yes, the answer says no, and the plugin's section must follow the
 * answer, as the collection's own navigation and route do.
 */
import { describe, expect, it } from "vitest";

import { buildCapabilities } from "@admin/hooks/useCurrentUserPermissions";
import type { CapabilitiesResponse } from "@admin/types/permissions";

import { standalonePluginsVisibleTo } from "../lib/standalone-plugins-visible-to";

const answering = (
  read: boolean,
  isSuperAdmin = false
): CapabilitiesResponse => ({
  isSuperAdmin,
  validUntil: null,
  entities: {
    posts: {
      kind: "collection",
      read,
      create: false,
      update: false,
      delete: false,
      publish: false,
      unpublish: false,
    },
  },
});

/** A standalone plugin as the branding payload declares one. */
interface Plugin {
  name: string;
  collections?: string[];
}

const NAMING_POSTS: Plugin = { name: "blog", collections: ["posts"] };
const NAMING_NONE: Plugin = { name: "tools" };

describe("standalonePluginsVisibleTo", () => {
  it("hides a plugin whose collections the answer refuses, though the slug is held", () => {
    const capabilities = buildCapabilities(
      ["read-posts"],
      false,
      answering(false)
    );
    expect(standalonePluginsVisibleTo([NAMING_POSTS], capabilities)).toEqual(
      []
    );
  });

  it("shows a plugin whose collection the answer lets the reader read", () => {
    const capabilities = buildCapabilities([], false, answering(true));
    expect(standalonePluginsVisibleTo([NAMING_POSTS], capabilities)).toEqual([
      NAMING_POSTS,
    ]);
  });

  it("shows any collection plugin to a super-admin's answer", () => {
    const capabilities = buildCapabilities([], true, answering(false, true));
    expect(standalonePluginsVisibleTo([NAMING_POSTS], capabilities)).toEqual([
      NAMING_POSTS,
    ]);
  });

  it("shows a plugin naming no collection with the settings", () => {
    const withSettings = buildCapabilities(
      ["manage-settings"],
      false,
      undefined
    );
    const without = buildCapabilities([], false, undefined);
    expect(standalonePluginsVisibleTo([NAMING_NONE], withSettings)).toEqual([
      NAMING_NONE,
    ]);
    expect(standalonePluginsVisibleTo([NAMING_NONE], without)).toEqual([]);
  });
});
