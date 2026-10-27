/**
 * The sidebar's collection and Single filters follow the server's answer about
 * each entity, and only that answer.
 *
 * The permission list is a separate request with a super-admin flag of its
 * own. A filter that let that flag through would show, from an older list,
 * every entity a newer answer refuses, while the routes behind them refuse.
 */
import { describe, expect, it } from "vitest";

import { buildCapabilities } from "@admin/hooks/useCurrentUserPermissions";
import type { CapabilitiesResponse } from "@admin/types/permissions";

import { filterCollectionItems, filterSingleItems } from "./authorization";

const answer = (
  isSuperAdmin: boolean,
  postsRead: boolean
): CapabilitiesResponse => ({
  isSuperAdmin,
  validUntil: null,
  entities: {
    posts: {
      kind: "collection",
      read: postsRead,
      create: false,
      update: false,
      delete: false,
      publish: false,
      unpublish: false,
    },
    home: {
      kind: "single",
      read: postsRead,
      update: false,
      publish: false,
      unpublish: false,
    },
  },
});

const COLLECTIONS = [{ name: "posts" }];
const SINGLES = [{ slug: "home" }];

describe("the sidebar's entity filters", () => {
  it("hide what the answer refuses, though the permission list says super-admin", () => {
    const capabilities = buildCapabilities([], true, answer(false, false));
    // POPULATION CONTROL: the permission list's super-admin flag is set.
    expect(capabilities.isSuperAdmin).toBe(true);

    expect(filterCollectionItems(COLLECTIONS, capabilities)).toEqual([]);
    expect(filterSingleItems(SINGLES, capabilities)).toEqual([]);
  });

  it("show every entity to a super-admin's answer, one it does not list included", () => {
    const capabilities = buildCapabilities([], true, answer(true, false));
    const added = [...COLLECTIONS, { name: "added-since" }];

    expect(filterCollectionItems(added, capabilities)).toEqual(added);
    expect(filterSingleItems(SINGLES, capabilities)).toEqual(SINGLES);
  });

  it("show what the answer allows", () => {
    const capabilities = buildCapabilities([], false, answer(false, true));

    expect(filterCollectionItems(COLLECTIONS, capabilities)).toEqual(
      COLLECTIONS
    );
    expect(filterSingleItems(SINGLES, capabilities)).toEqual(SINGLES);
  });
});
